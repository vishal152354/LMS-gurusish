/* audio.js — TTS audio playback */

let currentAudio = null;
let isSpeaking = false;

function playAudio(base64mp3, onEnd) {
  stopAudio();
  const blob    = b64ToBlob(base64mp3, 'audio/mpeg');
  const url     = URL.createObjectURL(blob);
  currentAudio  = new Audio(url);
  isSpeaking    = true;

  setStatus('speaking');
  setWaveform('speaking');

  currentAudio.onended = () => {
    isSpeaking = false;
    URL.revokeObjectURL(url);
    setStatus('listening');
    setWaveform('idle');
    if (onEnd) onEnd();
  };
  currentAudio.onerror = (e) => {
    console.error('Audio playback error:', e);
    isSpeaking = false;
    setStatus('listening');
    setWaveform('idle');
    if (onEnd) onEnd();
  };
  currentAudio.play().catch(err => {
    console.warn('Audio play failed:', err);
    isSpeaking = false;
    if (onEnd) onEnd();
  });
}

function stopAudio() {
  if (currentAudio) {
    try { currentAudio.pause(); currentAudio.currentTime = 0; } catch(e) {}
    currentAudio = null;
  }
  isSpeaking = false;
}

function b64ToBlob(b64, mime) {
  const binary = atob(b64);
  const arr = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) arr[i] = binary.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

function setStatus(state) {
  const dot  = document.getElementById('statusDot');
  const text = document.getElementById('statusText');
  if (!dot || !text) return;
  dot.className = 'status-dot';
  if (state === 'speaking') { dot.classList.add('blue');  text.textContent = '🔵 Speaking'; }
  else if (state === 'thinking') { dot.classList.add('amber'); text.textContent = '⏳ Thinking'; }
  else { dot.classList.add('green'); text.textContent = '🟢 Listening'; }
}
