/* progress.js — OKF pipeline progress polling */

var API = window.VIVA_API || '';
const params = new URLSearchParams(location.search);
const uploadId  = params.get('upload_id')  || sessionStorage.getItem('upload_id');
const studentId = params.get('student_id') || sessionStorage.getItem('student_id');
const filename  = decodeURIComponent(params.get('filename') || sessionStorage.getItem('filename') || 'your document');

if (!uploadId) window.location.href = 'index.html';

document.getElementById('fileNameLabel').textContent = filename;

const facts = [
  'The OKF format organises your document into a graph of connected concepts.',
  'Your viva questions come directly from your own uploaded content.',
  'The knowledge graph determines the order and depth of examination questions.',
  'The AI examiner has read your entire document before the viva begins.',
  'All processing happens locally — your data never leaves your machine.',
];
let factIdx = 0;
setInterval(() => {
  factIdx = (factIdx + 1) % facts.length;
  document.getElementById('factText').textContent = facts[factIdx];
}, 10000);

const STEP_NAMES = ['', 'Reading content', 'Identifying concepts', 'Building OKF bundle', 'Building knowledge graph', 'Preparing viva'];
let lastStep = 0;
let pollInterval;

function setStepActive(step, msg) {
  for (let i = 1; i <= 5; i++) {
    const iconEl = document.getElementById(`sicon-${i}`);
    const siEl   = document.getElementById(`si-${i}`);
    const ssEl   = document.getElementById(`ss-${i}`);
    if (!iconEl) continue;
    if (i < step) {
      iconEl.innerHTML = '<span class="check-icon">✓</span>';
      if (ssEl) ssEl.textContent = 'Done';
    } else if (i === step) {
      iconEl.innerHTML = '<div class="spinner" id="si-' + i + '"></div>';
      if (ssEl) ssEl.textContent = msg || 'Processing…';
    } else {
      iconEl.textContent = '⏳';
      if (ssEl) ssEl.textContent = 'Pending';
    }
  }
}

async function poll() {
  try {
    const res = await fetch(`${API}/student/pipeline/status/${uploadId}`);
    const data = await res.json();

    const step = data.step || 0;
    const pct  = data.percentage || 0;
    const msg  = data.message || '';

    document.getElementById('progressBar').style.width = pct + '%';
    document.getElementById('pctText').textContent = pct + '%';
    document.getElementById('progressMsg').textContent = msg;

    if (step > 0) setStepActive(step, msg);

    if (data.okf_ready) {
      clearInterval(pollInterval);
      document.getElementById('progressBar').classList.add('success');
      for (let i = 1; i <= 5; i++) {
        const iconEl = document.getElementById(`sicon-${i}`);
        if (iconEl) iconEl.innerHTML = '<span class="check-icon">✓</span>';
        const ssEl = document.getElementById(`ss-${i}`);
        if (ssEl) ssEl.textContent = 'Done';
      }
      document.getElementById('progressBar').style.width = '100%';
      document.getElementById('pctText').textContent = '100%';
      document.getElementById('progressMsg').textContent = 'Complete!';
      document.getElementById('readyWrap').style.display = 'block';
    }
  } catch(e) { /* retry next poll */ }
}

function startViva() {
  window.location.href = `viva.html?student_id=${studentId}&upload_id=${uploadId}`;
}

poll();
pollInterval = setInterval(poll, 3000);
