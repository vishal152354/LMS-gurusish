/* prep-service.js — single data + progress layer for Viva Prep (flashcards & MCQs).
   All content comes from /student/prep/*; pages never fetch it directly. */

var API = window.API || '';

const PrepService = (() => {
  const student = {
    id:   sessionStorage.getItem('student_id'),
    roll: sessionStorage.getItem('roll_number'),
    name: sessionStorage.getItem('student_name') || 'Student',
  };

  async function _json(res) {
    let data = {};
    try { data = await res.json(); } catch (e) {}
    if (!res.ok) throw new Error(data.detail || `Request failed (${res.status})`);
    return data;
  }

  function subjects() {
    return fetch(`${API}/student/prep/subjects?student_id=${encodeURIComponent(student.id)}&t=${Date.now()}`).then(_json);
  }

  function load(uploadId) {
    return fetch(`${API}/student/prep/${encodeURIComponent(uploadId)}?student_id=${encodeURIComponent(student.id)}&t=${Date.now()}`).then(_json);
  }

  function generate(uploadId) {
    return fetch(`${API}/student/prep/${encodeURIComponent(uploadId)}/generate?student_id=${encodeURIComponent(student.id)}`,
                 { method: 'POST' }).then(_json);
  }

  // ── progress (debounced save, flushed on page hide) ──
  const _pending = {};
  const _timers  = {};

  function saveProgress(uploadId, kind, state, immediate = false) {
    const key = `${uploadId}::${kind}`;
    _pending[key] = { uploadId, kind, state };
    clearTimeout(_timers[key]);
    if (immediate) return _flush(key);
    _timers[key] = setTimeout(() => _flush(key), 800);
  }

  function _flush(key, keepalive = false) {
    const p = _pending[key];
    if (!p) return Promise.resolve();
    delete _pending[key];
    return fetch(`${API}/student/prep/${encodeURIComponent(p.uploadId)}/progress/${p.kind}`, {
      method: 'PUT', keepalive,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ student_id: student.id, state: p.state }),
    }).catch(() => { toast('Could not save progress — check your connection.'); });
  }

  window.addEventListener('pagehide', () => Object.keys(_pending).forEach(k => _flush(k, true)));

  /* Reconcile a saved order with the current item ids (content may have been regenerated). */
  function reconcileOrder(savedOrder, ids) {
    const valid = new Set(ids);
    const order = (savedOrder || []).filter(id => valid.has(id));
    ids.forEach(id => { if (!order.includes(id)) order.push(id); });
    return order;
  }

  /* Accumulates visible time on the page; call .stop() to read. */
  function timer(startMs = 0) {
    let total = startMs, since = document.hidden ? null : Date.now();
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && since) { total += Date.now() - since; since = null; }
      else if (!document.hidden && !since) since = Date.now();
    });
    return {
      value: () => total + (since ? Date.now() - since : 0),
      reset: () => { total = 0; since = document.hidden ? null : Date.now(); },
    };
  }

  return { student, subjects, load, generate, saveProgress, reconcileOrder, timer };
})();

// ── small shared UI helpers ──
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${s % 60}s` : `${Math.floor(m / 60)}h ${m % 60}m`;
}

function shuffleArray(a) {
  const arr = a.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

let _toastTimer = null;
function toast(msg) {
  let el = document.querySelector('.prep-toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'prep-toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => { el.hidden = true; }, 3500);
}

function prepUrl(page, uploadId, extra = '') {
  return `${page}.html?upload_id=${encodeURIComponent(uploadId)}${extra}`;
}

function requireStudent() {
  if (!PrepService.student.id) { location.href = '/'; return false; }
  return true;
}
