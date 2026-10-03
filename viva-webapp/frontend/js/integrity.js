/* integrity.js — tab/fullscreen monitoring */

var API = window.VIVA_API || '';
var _intSid    = null;
var warnCount  = 0;
var isFlagged  = false;

function initIntegrity(sid) {
  _intSid = sid;

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) logEvent('visibility_hidden');
    else logEvent('visibility_visible');
  });

  window.addEventListener('blur', () => logEvent('blur'));

  document.addEventListener('fullscreenchange', () => {
    if (!document.fullscreenElement) logEvent('exit_fullscreen');
  });
}

function requestFullscreen() {
  try {
    const el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  } catch(e) { /* fullscreen requires user gesture — silently ignore */ }
}

async function logEvent(type) {
  if (!_intSid) return;
  if (type === 'blur' || type === 'visibility_hidden') {
    warnCount++;
    const tsEl = document.getElementById('tabSwitchCount');
    if (tsEl) {
      tsEl.textContent = warnCount;
      tsEl.className = `integrity-val ${warnCount >= 3 ? 'danger' : warnCount >= 1 ? 'warn' : ''}`;
    }
    showWarning();
  }

  try {
    const res = await fetch(`${API}/student/viva/integrity/${_intSid}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event_type: type, timestamp: new Date().toISOString() }),
    });
    const data = await res.json();
    isFlagged = data.flagged;
  } catch(e) {}
}

function showWarning() {
  const overlay = document.getElementById('integrityOverlay');
  const warnEl  = document.getElementById('warnCount');
  if (!overlay) return;
  overlay.classList.add('show');
  if (warnEl) warnEl.textContent = `Warning ${warnCount} of 3`;
}

function dismissWarning() {
  const overlay = document.getElementById('integrityOverlay');
  if (overlay) overlay.classList.remove('show');
}
