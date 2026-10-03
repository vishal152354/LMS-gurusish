/* speech.js — MediaRecorder-based STT (works on HTTP, no HTTPS needed) */

var _mediaRecorder  = null;
var _audioChunks    = [];
var isRecognising   = false;

function initSpeech(onTranscript) {
  // MediaRecorder doesn't need init — it's created fresh each recording
  return !!navigator.mediaDevices;
}

function toggleMic() {
  if (isRecognising) stopRecognition();
  else startRecognition();
}

async function startRecognition() {
  if (isRecognising) return;

  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  } catch(e) {
    _showMicError('Microphone access denied. Please allow microphone in your browser settings.');
    return;
  }

  _audioChunks = [];
  _mediaRecorder = new MediaRecorder(stream);

  _mediaRecorder.ondataavailable = (e) => {
    if (e.data && e.data.size > 0) _audioChunks.push(e.data);
  };

  _mediaRecorder.onstop = async () => {
    // Stop all mic tracks
    stream.getTracks().forEach(t => t.stop());

    const blob = new Blob(_audioChunks, { type: 'audio/webm' });
    _audioChunks = [];

    if (blob.size < 2000) {
      _showMicStatus('No speech detected. Please try again.');
      return;
    }

    _showMicStatus('Transcribing…');

    try {
      const form = new FormData();
      form.append('audio', blob, 'recording.webm');
      const res  = await fetch('/student/viva/transcribe', { method: 'POST', body: form });
      const data = await res.json();

      if (!res.ok) {
        _showMicStatus(data.detail || 'Could not transcribe. Please type your answer.');
        return;
      }

      const inp = document.getElementById('answerInput');
      if (inp) {
        inp.value = data.transcript;
        inp.focus();
        inp.style.height = 'auto';
        inp.style.height = Math.min(inp.scrollHeight, 200) + 'px';
      }
      _showMicStatus('✅ Transcribed — review your answer, then press Send (➤) or Enter.');
      // Focus input so user can edit before submitting
      if (inp) inp.focus();

    } catch(err) {
      _showMicStatus('Transcription error. Please type your answer.');
      console.error('Transcribe error:', err);
    }
  };

  _mediaRecorder.start();
  isRecognising = true;
  _updateMicBtn(true);
  setWaveform('recording');
  _showMicStatus('🔴 Recording… click ⏹ to stop');
}

function stopRecognition() {
  if (!_mediaRecorder || !isRecognising) return;
  isRecognising = false;
  _mediaRecorder.stop();
  _updateMicBtn(false);
  setWaveform('idle');
}

function _updateMicBtn(recording) {
  const micBtn = document.getElementById('micBtn');
  if (!micBtn) return;
  if (recording) {
    micBtn.classList.add('recording', 'pulse');
    micBtn.textContent = '⏹';
    micBtn.title = 'Click to stop recording';
  } else {
    micBtn.classList.remove('recording', 'pulse');
    micBtn.textContent = '🎤';
    micBtn.title = 'Click to speak your answer';
  }
}

function _showMicStatus(msg) {
  let el = document.getElementById('micStatusMsg');
  if (!el) {
    el = document.createElement('div');
    el.id = 'micStatusMsg';
    el.style.cssText = 'font-size:12px;color:#64748b;padding:2px 4px;margin-top:2px;min-height:16px;';
    const bar = document.querySelector('.chat-input-bar');
    if (bar) bar.insertBefore(el, bar.firstChild);
  }
  el.textContent = msg;
}

function _showMicError(msg) {
  _showMicStatus('⚠️ ' + msg);
}

function setWaveform(state) {
  const wf = document.getElementById('waveform');
  if (!wf) return;
  wf.className = 'waveform ' + state;
}
