/* viva.js — main viva session logic */

var API = window.VIVA_API || '';
const params      = new URLSearchParams(location.search);
const studentId   = params.get('student_id')   || sessionStorage.getItem('student_id');
const uploadId    = params.get('upload_id')    || sessionStorage.getItem('upload_id');
const slotId      = params.get('slot_id')      || sessionStorage.getItem('slot_id');
const subAgentId  = params.get('sub_agent_id') || sessionStorage.getItem('sub_agent_id') || undefined;
const eventIdOrch = params.get('event_id')     || sessionStorage.getItem('event_id_orch') || undefined;

if (!studentId || (!uploadId && !slotId && !eventIdOrch)) window.location.href = 'index.html';

let sessionId       = null;
let questionNumber  = 0;
let scoreTotal      = 0;
let timerInterval   = null;
let secondsElapsed  = 0;
let vivaComplete    = false;
let waitingForReply = false;
let vivaStarting    = false;   // guard against double-start
let totalQuestions  = 10;
let lastAudioB64    = null;    // for the "Repeat question" button

// ── init speech (safe — never crash the page) ────────────────
try {
  initSpeech((transcript, isFinal) => {
    const inp = document.getElementById('answerInput');
    if (inp) inp.value = transcript;
  });
} catch(e) {
  console.warn('Speech API init failed (non-fatal):', e);
}

// ── start viva ───────────────────────────────────────────────
async function startViva() {
  if (vivaStarting || sessionId) return;   // already starting or already started
  vivaStarting = true;
  setStatus('thinking');

  try {
    const res = await fetch(`${API}/student/viva/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_id:   studentId,
        upload_id:    uploadId   || undefined,
        slot_id:      slotId     || undefined,
        sub_agent_id: subAgentId || undefined,
        event_id:     eventIdOrch|| undefined,
      }),
    });
    const data = await res.json();

    // Clear the welcome/loading panel
    removeManualStartButton();
    removeSystemMsg();

    if (!res.ok) {
      vivaStarting = false;
      showStartError(data.detail || 'Could not start viva. Please refresh and try again.');
      return;
    }

    sessionId      = data.session_id;
    questionNumber = data.question_number;

    initIntegrity(sessionId);
    requestFullscreen();
    startTimer();

    // populate sidebar
    const name     = sessionStorage.getItem('student_name') || studentId;
    const roll     = sessionStorage.getItem('roll_number')  || '';
    const filename = sessionStorage.getItem('filename')      || uploadId;

    const avatarEl = document.getElementById('avatarEl');
    if (avatarEl) avatarEl.textContent = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2);
    const sideNameEl = document.getElementById('sideStudentName');
    if (sideNameEl) sideNameEl.textContent = name;
    const sideRollEl = document.getElementById('sideRollNum');
    if (sideRollEl) sideRollEl.textContent = roll ? `Roll: ${roll}` : '';
    const sideFileEl = document.getElementById('sideFileName');
    if (sideFileEl) sideFileEl.textContent = filename;

    updateProgress(1, 0);
    updateTopic(data.current_node || 'Question 1 of ' + (totalQuestions||10));
    setInputDisabled(false);

    totalQuestions = data.total_questions || 10;
    const totLabel = document.getElementById('qTotalLabel');
    if (totLabel) totLabel.textContent = totalQuestions;
    const maxLabel = document.getElementById('maxMarksLabel');
    if (maxLabel) maxLabel.textContent = (data.total_marks != null ? data.total_marks : 30);
    appendMessage('agent', data.greeting_text);
    // Show the first question, then its clickable options
    appendCaseScenario(data.first_question_text);
    renderOptions(data.options);
    setStatus('listening');

  } catch(e) {
    removeSystemMsg();
    showStartError('Cannot reach the server. Make sure the backend is running on port 7860.');
    console.error('startViva error:', e);
  }
}

// ── send answer ──────────────────────────────────────────────
async function sendAnswer() {
  if (vivaComplete || waitingForReply) return;
  const inp = document.getElementById('answerInput');
  const text = inp ? inp.value.trim() : '';
  if (!text) return;
  if (!sessionId) {
    appendMessage('agent', 'The viva has not started yet. Please wait a moment or refresh the page.');
    return;
  }

  // quit keywords → conclude the session
  const quitPhrases = ['quit', 'exit', 'end session', 'conclude', 'stop viva', 'finish', 'end viva'];
  if (quitPhrases.some(p => text.toLowerCase() === p || text.toLowerCase().startsWith(p + ' '))) {
    if (inp) {
      inp.value = '';
      inp.style.height = 'auto';
    }
    sendCommand('quit');
    return;
  }

  stopRecognition();
  appendStudentAnswer(text);
  if (inp) {
    inp.value = '';
    inp.style.height = 'auto';
  }
  setInputDisabled(true);
  setStatus('thinking');
  waitingForReply = true;

  try {
    const res = await fetch(`${API}/student/viva/answer/${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer_text: text }),
    });
    const data = await res.json();
    if (!res.ok) {
      appendMessage('agent', `Error: ${data.detail || 'unknown error'}`);
      setInputDisabled(false);
      waitingForReply = false;
      return;
    }

    if (data.viva_complete) {
      handleCompletion(data);
      return;
    }

    questionNumber = data.question_number;
    scoreTotal     = data.score_so_far || 0;
    updateProgress(questionNumber, scoreTotal);
    if (data.current_node) updateTopic(data.current_node);
    updateLiveAnalysis(data);

    // Show feedback in green bubble, then next question in separate bold blue bubble
    if (data.feedback_text) appendFeedback(data.feedback_text);
    const nextQText = data.next_question_text || data.agent_response_text;
    if (data.is_followup) {
      appendFollowup(questionNumber, nextQText);
    } else {
      appendQuestion(questionNumber, nextQText);
    }

    if (data.audio_b64) {
      playAudio(data.audio_b64, () => {
        setInputDisabled(false);
        setStatus('listening');
        waitingForReply = false;
      });
    } else {
      setInputDisabled(false);
      waitingForReply = false;
    }

  } catch(e) {
    appendMessage('agent', 'Network error. Please check your connection.');
    setInputDisabled(false);
    waitingForReply = false;
    console.error(e);
  }
}

// ── send command ─────────────────────────────────────────────
async function sendCommand(cmd) {
  if (vivaComplete || !sessionId) return;
  setStatus('thinking');
  setInputDisabled(true);
  waitingForReply = true;
  try {
    const res = await fetch(`${API}/student/viva/command/${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: cmd }),
    });
    const data = await res.json();
    if (data.viva_complete) { handleCompletion(data); return; }

    if (cmd === 'hint') {
      // hint is just a helper message, not a new question
      appendFeedback(data.agent_response_text || '');
    } else if (cmd === 'repeat') {
      // re-show the current question
      appendQuestion(questionNumber, data.agent_response_text || '');
    } else if (cmd === 'skip') {
      // skip returns same shape as submit_answer
      if (data.feedback_text) appendFeedback(data.feedback_text);
      const qNum = data.question_number || questionNumber + 1;
      appendQuestion(qNum, data.next_question_text || data.agent_response_text || '');
      questionNumber = qNum;
      scoreTotal = data.score_so_far || scoreTotal;
      updateProgress(questionNumber, scoreTotal);
      if (data.current_node) updateTopic(data.current_node);
    }

    if (data.audio_b64) {
      playAudio(data.audio_b64, () => {
        setInputDisabled(false);
        setStatus('listening');
        waitingForReply = false;
      });
    } else {
      setInputDisabled(false);
      setStatus('listening');
      waitingForReply = false;
    }
  } catch(e) {
    console.error(e);
    setInputDisabled(false);
    waitingForReply = false;
  }
}

// ── completion ───────────────────────────────────────────────
function handleCompletion(data) {
  vivaComplete = true;
  clearInterval(timerInterval);
  updateProgress(totalQuestions, data.final_marks || 0);
  setStatus('listening');

  appendClosing(
    data.closing_text || 'Your test is complete.',
    data.final_marks, data.grade, data.max_marks
  );

  sessionStorage.setItem('viva_result', JSON.stringify(data));
  sessionStorage.setItem('student_id', studentId);
  sessionStorage.setItem('upload_id', uploadId);
  if (eventIdOrch) sessionStorage.setItem('viva_result_event_id', eventIdOrch);
  else sessionStorage.removeItem('viva_result_event_id');

  setTimeout(() => {
    const ev = eventIdOrch ? `&event_id=${encodeURIComponent(eventIdOrch)}` : '';
    window.location.href = `complete.html?student_id=${studentId}&upload_id=${uploadId}${ev}`;
  }, 3500);
}

// ── MCQ options (drag-and-drop, see mcq-dnd.js) ──────────────
function renderOptions(options) {
  const chat = document.getElementById('chatArea');
  if (!chat || !Array.isArray(options)) return;
  const wrap = document.createElement('div');
  wrap.className = 'mcq-options';
  chat.appendChild(wrap);
  wrap._dnd = MCQDnD.mount(wrap, options, idx => chooseOption(idx, wrap));
  chat.scrollTop = chat.scrollHeight;
}

async function chooseOption(idx, group) {
  if (vivaComplete || waitingForReply || !sessionId) return;
  const dnd = group && group._dnd;
  waitingForReply = true;
  if (dnd) dnd.lock();
  setStatus('thinking');

  try {
    const res = await fetch(`${API}/student/viva/answer/${sessionId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ answer_text: String.fromCharCode(65 + idx) }),
    });
    const data = await res.json();
    if (!res.ok) {
      appendMessage('agent', `Error: ${data.detail || 'unknown error'}`);
      if (dnd) dnd.unlock();
      waitingForReply = false;
      return;
    }

    setStatus('listening');

    // Answers are revealed only after the whole test is submitted, so there is
    // no per-question feedback: move straight on (or finish).
    const advance = () => {
      if (data.viva_complete) {
        updateProgress(totalQuestions, data.final_marks || 0);
        handleCompletion(data);
        return;
      }
      questionNumber = data.question_number;
      updateProgress(questionNumber, 0);
      if (data.current_node) updateTopic(data.current_node);

      appendQuestion(questionNumber, data.next_question_text);
      if (data.question && data.question.type && data.question.type !== 'mcq') {
        appendMessage('agent', 'This test includes fill-in-the-blank and match questions, which only the new Pariksha app can show. Please open the test there.');
        return;
      }
      renderOptions(data.options);
      waitingForReply = false;
    };
    if (data.flashcard) {
      if (dnd) dnd.reveal(data.correct_index, idx);
      showFlashcard(data.flashcard, data.was_correct, advance);
    } else {
      advance();
    }

  } catch (e) {
    appendMessage('agent', 'Network error. Please check your connection.');
    if (dnd) dnd.unlock();
    waitingForReply = false;
    console.error(e);
  }
}

// ── Flashcard shown after each answer ────────────────────────
function showFlashcard(card, wasCorrect, onNext) {
  card = card || {};
  const isLast = false;
  const overlay = document.createElement('div');
  overlay.className = 'flash-overlay';
  const verdictClass = wasCorrect ? 'fc-correct' : 'fc-wrong';
  const verdictText  = wasCorrect ? 'Correct' : 'Incorrect';
  overlay.innerHTML =
    `<div class="flash-card">
       <div class="fc-verdict ${verdictClass}">${verdictText}</div>
       <div class="fc-label">Correct answer</div>
       <div class="fc-answer"><span class="fc-letter">${escHtml(card.correct_letter || '')}</span>${escHtml(card.correct_option || '')}</div>
       ${card.explanation ? `<div class="fc-label">Why</div><div class="fc-expl">${escHtml(card.explanation)}</div>` : ''}
       <button class="fc-next">Next →</button>
     </div>`;
  document.body.appendChild(overlay);
  const close = () => { overlay.remove(); onNext(); };
  overlay.querySelector('.fc-next').onclick = close;
}

// ── UI helpers ───────────────────────────────────────────────
function appendMessage(role, text) {
  const chat = document.getElementById('chatArea');
  if (!chat) return;
  const row = document.createElement('div');
  row.className = `msg-row ${role}`;
  const time = new Date().toLocaleTimeString('en-US', {hour:'2-digit',minute:'2-digit'});
  const sender = role === 'agent' ? 'Examiner' : 'You';
  row.innerHTML = `
    <div class="msg-sender">${sender}</div>
    <div class="msg-bubble">${escHtml(text)}</div>
    <div class="msg-time">${time}</div>`;
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;
}

function appendStudentAnswer(text) {
  const chat = document.getElementById('chatArea');
  if (!chat) return;
  const row = document.createElement('div');
  row.className = 'msg-row student';
  const time = new Date().toLocaleTimeString('en-US', {hour:'2-digit',minute:'2-digit'});
  const wordCount = text.trim().split(/\s+/).length;
  row.innerHTML = `
    <div class="msg-sender" style="justify-content:flex-end;">You</div>
    <div class="msg-bubble student-answer-bubble">${escHtml(text)}</div>
    <div class="msg-time" style="text-align:right;">${wordCount} words &nbsp;·&nbsp; ${time}</div>`;
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;
}

function appendClosing(text, marks, grade, maxMarks) {
  const chat = document.getElementById('chatArea');
  if (!chat) return;
  const div = document.createElement('div');
  div.className = 'q-divider';
  div.textContent = 'Test Complete';
  chat.appendChild(div);
  const row = document.createElement('div');
  row.className = 'msg-row agent';
  const outOf = (maxMarks !== undefined && maxMarks !== null) ? maxMarks : 30;
  const scoreHtml = marks !== undefined
    ? `<div class="closing-score">Final Score: <strong>${marks}/${outOf}</strong>${grade ? ` &nbsp;·&nbsp; Grade <strong>${grade}</strong>` : ''}</div>`
    : '';
  row.innerHTML = `
    <div class="msg-sender">Examiner — Closing Remarks</div>
    <div class="msg-bubble closing-bubble">${scoreHtml}${escHtml(text)}</div>`;
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;
}

function appendFeedback(text) {
  const chat = document.getElementById('chatArea');
  if (!chat) return;
  const row = document.createElement('div');
  row.className = 'msg-row agent';
  const time = new Date().toLocaleTimeString('en-US', {hour:'2-digit',minute:'2-digit'});
  row.innerHTML = `
    <div class="msg-sender">Examiner — Feedback</div>
    <div class="msg-bubble feedback-bubble">${escHtml(text)}</div>
    <div class="msg-time">${time}</div>`;
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;
}

function appendCaseScenario(text) {
  const chat = document.getElementById('chatArea');
  if (!chat) return;
  const div = document.createElement('div');
  div.className = 'q-divider';
  div.textContent = `Question 1 of ${totalQuestions}`;
  chat.appendChild(div);
  const row = document.createElement('div');
  row.className = 'msg-row agent';
  const time = new Date().toLocaleTimeString('en-US', {hour:'2-digit',minute:'2-digit'});
  row.innerHTML = `
    <div class="msg-sender">Examiner</div>
    <div class="msg-bubble question-bubble">
      <div class="q-label">QUESTION 1 OF ${totalQuestions}</div>
      ${escHtml(text)}
    </div>
    <div class="msg-time">${time}</div>`;
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;
  _lastPhase = `Question 1 of ${totalQuestions}`;
}

// Track phase changes to insert phase dividers
let _lastPhase = '';

function appendQuestion(exchangeNum, text) {
  const chat = document.getElementById('chatArea');
  if (!chat) return;

  // Insert a divider when phase changes
  const phase = document.getElementById('topicChip') ? document.getElementById('topicChip').textContent : '';
  if (phase && phase !== _lastPhase) {
    const div = document.createElement('div');
    div.className = 'q-divider';
    div.textContent = phase;
    chat.appendChild(div);
    _lastPhase = phase;
  }

  const row = document.createElement('div');
  row.className = 'msg-row agent';
  const time = new Date().toLocaleTimeString('en-US', {hour:'2-digit',minute:'2-digit'});
  const label = exchangeNum ? `QUESTION ${exchangeNum} OF ${totalQuestions}` : 'QUESTION';
  row.innerHTML = `
    <div class="msg-sender">Examiner</div>
    <div class="msg-bubble question-bubble">
      <div class="q-label">${label}</div>
      ${escHtml(text)}
    </div>
    <div class="msg-time">${time}</div>`;
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;
}

function appendFollowup(exchangeNum, text) {
  const chat = document.getElementById('chatArea');
  if (!chat) return;
  const row = document.createElement('div');
  row.className = 'msg-row agent';
  const time = new Date().toLocaleTimeString('en-US', {hour:'2-digit',minute:'2-digit'});
  row.innerHTML = `
    <div class="msg-sender">Examiner</div>
    <div class="msg-bubble followup-bubble">${escHtml(text)}</div>
    <div class="msg-time">${time}</div>`;
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;
}

function appendSystemMsg(text) {
  const chat = document.getElementById('chatArea');
  if (!chat) return;
  const el = document.createElement('div');
  el.id = 'systemMsg';
  el.style.cssText = 'text-align:center;color:#94a3b8;font-size:13px;padding:12px;display:flex;align-items:center;justify-content:center;gap:8px;';
  el.innerHTML = `<div class="spinner" style="width:16px;height:16px;border-width:2px;"></div>${text}`;
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
}

function removeSystemMsg() {
  const el = document.getElementById('systemMsg');
  if (el) el.remove();
}

function showStartError(msg) {
  setStatus('listening');
  const chat = document.getElementById('chatArea');
  if (!chat) return;
  const el = document.createElement('div');
  el.style.cssText = 'background:var(--surface);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid var(--border);border-radius:16px;padding:22px;margin:8px auto;max-width:460px;text-align:center;box-shadow:var(--glow);';
  el.innerHTML = `
    <div style="color:var(--danger);font-weight:600;margin-bottom:14px;font-size:15px;">${msg}</div>
    <button onclick="location.reload()" style="background:var(--primary);color:#16181D;border:none;padding:10px 24px;border-radius:10px;cursor:pointer;font-size:14px;font-weight:600;">
      Retry
    </button>`;
  chat.appendChild(el);
  chat.scrollTop = chat.scrollHeight;
}

function appendTypingIndicator() {
  const chat = document.getElementById('chatArea');
  if (!chat) return null;
  const row = document.createElement('div');
  row.className = 'msg-row agent';
  row.id = 'typingIndicator';
  row.innerHTML = `
    <div class="msg-sender">Examiner</div>
    <div class="msg-bubble"><div class="typing-dots"><span></span><span></span><span></span></div></div>`;
  chat.appendChild(row);
  chat.scrollTop = chat.scrollHeight;
  return row;
}

function removeTypingIndicator() {
  const el = document.getElementById('typingIndicator');
  if (el) el.remove();
}

// Viva has 10 questions; progress bar fills as questions are answered
function updateProgress(questionNum, score) {
  const qEl = document.getElementById('qCurrent');
  if (qEl) qEl.textContent = questionNum;
  const bar = document.getElementById('qProgressBar');
  const denom = totalQuestions || 10;
  const pct = Math.min(100, Math.round(questionNum / denom * 100));
  if (bar) bar.style.width = pct + '%';
  const stEl = document.getElementById('scoreTotal');
  if (stEl) stEl.textContent = score;
}

function updateTopic(topic) {
  const el = document.getElementById('topicChip');
  if (el) el.textContent = topic;
}

function updateLiveAnalysis(data) {
  const toneEmoji = {
    confident: '😊 confident', clear: '🙂 clear',
    hesitant: '😐 hesitant', nervous: '😰 nervous', confused: '😕 confused'
  };
  const scoreColor = (v) => v >= 8 ? '#16a34a' : v >= 5 ? '#d97706' : '#dc2626';

  const fields = [
    ['live-content',    data.marks_this_question],   // Knowledge
    ['live-confidence', data.confidence_score],      // Understanding
    ['live-english',    data.english_score],         // Application
  ];
  fields.forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el && val !== undefined) {
      el.textContent = val + '/10';
      el.style.color = scoreColor(val);
    }
  });
}

function setInputDisabled(disabled) {
  const inp = document.getElementById('answerInput');
  const btn = document.getElementById('sendBtn');
  if (inp) inp.disabled = disabled;
  if (btn) btn.disabled = disabled;
}

function startTimer() {
  if (timerInterval) clearInterval(timerInterval);  // prevent stacking
  timerInterval = setInterval(() => {
    secondsElapsed++;
    const m = String(Math.floor(secondsElapsed / 60)).padStart(2, '0');
    const s = String(secondsElapsed % 60).padStart(2, '0');
    const el = document.getElementById('timerEl');
    if (el) el.textContent = `${m}:${s}`;
  }, 1000);
}

function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

// ── keyboard shortcut (Enter to send) ───────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const inp = document.getElementById('answerInput');
  if (inp) {
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (sessionId) sendAnswer();
      }
    });
    // Auto-resize on input
    inp.addEventListener('input', function() {
      this.style.height = 'auto';
      this.style.height = Math.min(this.scrollHeight, 200) + 'px';
    });
  }

  // Show manual start button in chat area while auto-connecting
  showManualStartButton();

  // Auto-start after a short pause
  setTimeout(startViva, 500);
});

function showManualStartButton() {
  const chat = document.getElementById('chatArea');
  if (!chat) return;
  const el = document.createElement('div');
  el.id = 'manualStartWrap';
  el.style.cssText = 'text-align:center;padding:40px 20px;';
  el.innerHTML = `
    <div style="font-family:var(--font-serif);font-weight:600;font-size:1.4rem;margin-bottom:8px;color:var(--text);">Pariksha</div>
    <div style="color:var(--text-secondary);font-size:14px;margin-bottom:22px;">Preparing your test, please wait…</div>
    <div id="startSpinner" style="display:flex;align-items:center;justify-content:center;gap:10px;color:var(--text-secondary);font-size:13px;">
      <div class="spinner" style="width:18px;height:18px;border-width:2px;"></div>
      Loading questions…
    </div>`;
  chat.appendChild(el);
}

function removeManualStartButton() {
  const el = document.getElementById('manualStartWrap');
  if (el) el.remove();
}

function manualStart() {
  if (vivaStarting || sessionId) return;
  removeManualStartButton();
  appendSystemMsg('Connecting to your interviewer, please wait…');
  startViva();
}
