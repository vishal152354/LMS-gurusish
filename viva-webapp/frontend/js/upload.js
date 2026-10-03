/* upload.js — file upload handling */

var API = window.VIVA_API || '';
const params = new URLSearchParams(location.search);
const studentId = params.get('student_id') || sessionStorage.getItem('student_id');

if (!studentId) window.location.href = 'index.html';

const dropZone   = document.getElementById('dropZone');
const fileInput  = document.getElementById('fileInput');
const fileBox    = document.getElementById('fileSelectedBox');
const fileNameEl = document.getElementById('fileName');
const fileSizeEl = document.getElementById('fileSize');
const uploadBtn  = document.getElementById('uploadBtn');
const errorBox   = document.getElementById('errorBox');

let selectedFile = null;

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('dragover'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', e => {
  e.preventDefault(); dropZone.classList.remove('dragover');
  const file = e.dataTransfer.files[0];
  if (file) setFile(file);
});
fileInput.addEventListener('change', () => {
  if (fileInput.files[0]) setFile(fileInput.files[0]);
});

function setFile(file) {
  const allowed = ['.pdf', '.txt', '.docx'];
  const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
  if (!allowed.includes(ext)) {
    showError('Please upload a PDF, TXT, or DOCX file.');
    return;
  }
  if (file.size > 20 * 1024 * 1024) {
    showError('File is too large. Maximum size is 20 MB.');
    return;
  }
  selectedFile = file;
  fileNameEl.textContent = file.name;
  fileSizeEl.textContent = formatSize(file.size);
  fileBox.classList.add('show');
  uploadBtn.classList.add('show');
  errorBox.style.display = 'none';
}

function clearFile() {
  selectedFile = null;
  fileInput.value = '';
  fileBox.classList.remove('show');
  uploadBtn.classList.remove('show');
}

function formatSize(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

async function startUpload() {
  if (!selectedFile) { showError('Please select a file first.'); return; }
  uploadBtn.disabled = true;
  uploadBtn.textContent = 'Uploading…';

  const fd = new FormData();
  fd.append('student_id', studentId);
  fd.append('file', selectedFile);

  try {
    const res = await fetch(`${API}/student/upload`, { method: 'POST', body: fd });
    const data = await res.json();
    if (!res.ok) { showError(data.detail || 'Upload failed.'); return; }
    sessionStorage.setItem('upload_id', data.upload_id);
    sessionStorage.setItem('student_id', studentId);
    sessionStorage.setItem('filename', selectedFile.name);
    window.location.href = `progress.html?student_id=${studentId}&upload_id=${data.upload_id}&filename=${encodeURIComponent(selectedFile.name)}`;
  } catch(e) {
    showError('Upload failed. Is the server running?');
    uploadBtn.disabled = false;
    uploadBtn.textContent = 'Upload and Build Knowledge Base';
  }
}

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.style.display = 'block';
  uploadBtn.disabled = false;
  uploadBtn.textContent = 'Upload and Build Knowledge Base';
}
