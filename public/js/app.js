// ===== NAV TOGGLE =====
document.getElementById('navToggle').addEventListener('click', () => {
  document.querySelector('.nav-links').classList.toggle('open');
});

document.querySelectorAll('.nav-links a').forEach(link => {
  link.addEventListener('click', () => document.querySelector('.nav-links').classList.remove('open'));
});

// ===== FILE ICONS =====
function getFileIcon(filename) {
  const ext = filename.split('.').pop().toLowerCase();
  const icons = {
    pdf: '📕', doc: '📘', docx: '📘',
    ppt: '📙', pptx: '📙',
    xls: '📗', xlsx: '📗',
    zip: '🗜️', rar: '🗜️',
    jpg: '🖼️', jpeg: '🖼️', png: '🖼️', gif: '🖼️',
    txt: '📄',
  };
  return icons[ext] || '📄';
}

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('es-PE', {
    day: '2-digit', month: 'short', year: 'numeric'
  });
}

// ===== STATS =====
async function loadStats() {
  try {
    const res = await fetch('/api/weeks');
    const data = await res.json();
    const totalFiles = data.weeks.reduce((acc, w) => acc + w.fileCount, 0);
    document.getElementById('totalWeeks').textContent = data.weeks.length;
    document.getElementById('totalFiles').textContent = totalFiles;
  } catch { /* silently ignore */ }
}

// ===== WEEK TABS =====
let activeWeek = null;
const weekTabsEl = document.getElementById('weekTabs');

function buildWeekTabs() {
  weekTabsEl.innerHTML = '';
  for (let i = 1; i <= 16; i++) {
    const btn = document.createElement('button');
    btn.className = 'week-tab';
    btn.dataset.week = i;
    btn.innerHTML = `Semana ${i} <span class="badge-count">0</span>`;
    btn.addEventListener('click', () => selectWeek(i));
    weekTabsEl.appendChild(btn);
  }
}

async function loadWeekFileCounts() {
  try {
    const res = await fetch('/api/weeks');
    const data = await res.json();
    data.weeks.forEach(w => {
      const tab = weekTabsEl.querySelector(`[data-week="${w.week}"]`);
      if (tab) tab.querySelector('.badge-count').textContent = w.fileCount;
    });
  } catch { /* silently ignore */ }
}

async function selectWeek(week) {
  activeWeek = week;
  weekTabsEl.querySelectorAll('.week-tab').forEach(t => t.classList.remove('active'));
  const activeTab = weekTabsEl.querySelector(`[data-week="${week}"]`);
  if (activeTab) activeTab.classList.add('active');
  await renderWeekFiles(week);
}

async function renderWeekFiles(week) {
  const container = document.getElementById('weekContent');
  container.innerHTML = '<div class="empty-state"><div class="empty-icon">⏳</div><p>Cargando archivos...</p></div>';

  try {
    const res = await fetch(`/api/files/${week}`);
    const data = await res.json();

    if (!data.files.length) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📂</div>
          <p>No hay archivos en la Semana ${week} todavía.</p>
        </div>`;
      return;
    }

    container.innerHTML = `
      <div class="week-header">
        <h3 class="week-title">📅 Semana ${week}</h3>
        <span style="font-size:13px;color:var(--text-muted)">${data.files.length} archivo(s)</span>
      </div>
      <div class="files-grid" id="filesGrid"></div>`;

    const grid = document.getElementById('filesGrid');
    data.files.forEach(file => {
      const card = document.createElement('div');
      card.className = 'file-card';
      card.innerHTML = `
        <div class="file-icon">${getFileIcon(file.originalname)}</div>
        <div class="file-info">
          <div class="file-name">${file.originalname}</div>
          <div class="file-meta">${formatBytes(file.size)} · ${formatDate(file.date)}</div>
        </div>
        <div class="file-actions">
          <a href="${file.url}" download="${file.originalname}" class="btn-icon" title="Descargar">⬇️</a>
          <button class="btn-icon danger" title="Eliminar" onclick="deleteFile(${week}, '${encodeURIComponent(file.url)}', this)">🗑️</button>
        </div>`;
      grid.appendChild(card);
    });
  } catch {
    container.innerHTML = '<div class="empty-state"><div class="empty-icon">⚠️</div><p>Error al cargar archivos.</p></div>';
  }
}

async function deleteFile(week, filename, btn) {
  if (!confirm('¿Eliminar este archivo?')) return;
  try {
    const res = await fetch(`/api/files/${week}?path=${filename}`, { method: 'DELETE' });
    if (res.ok) {
      btn.closest('.file-card').remove();
      loadStats();
      loadWeekFileCounts();
      const grid = document.getElementById('filesGrid');
      if (grid && !grid.children.length) {
        document.getElementById('weekContent').innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">📂</div>
            <p>No hay archivos en la Semana ${week} todavía.</p>
          </div>`;
      }
    }
  } catch { alert('No se pudo eliminar el archivo.'); }
}

// ===== FILE UPLOAD =====
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const filePreview = document.getElementById('filePreview');
const uploadAlert = document.getElementById('uploadAlert');
let selectedFile = null;

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
dropZone.addEventListener('drop', e => {
  e.preventDefault();
  dropZone.classList.remove('drag-over');
  if (e.dataTransfer.files.length) handleFile(e.dataTransfer.files[0]);
});
fileInput.addEventListener('change', e => { if (e.target.files.length) handleFile(e.target.files[0]); });

document.getElementById('removeFile').addEventListener('click', () => {
  selectedFile = null;
  fileInput.value = '';
  filePreview.hidden = true;
  dropZone.hidden = false;
});

function handleFile(file) {
  selectedFile = file;
  document.getElementById('previewIcon').textContent = getFileIcon(file.name);
  document.getElementById('previewName').textContent = file.name;
  document.getElementById('previewSize').textContent = formatBytes(file.size);
  dropZone.hidden = true;
  filePreview.hidden = false;
}

document.getElementById('uploadForm').addEventListener('submit', async e => {
  e.preventDefault();
  const week = document.getElementById('weekSelect').value;
  if (!week) return showAlert('Selecciona una semana.', 'error');
  if (!selectedFile) return showAlert('Selecciona un archivo.', 'error');

  const submitBtn = document.getElementById('submitBtn');
  const submitText = document.getElementById('submitText');
  const spinner = document.getElementById('spinner');
  submitBtn.disabled = true;
  submitText.hidden = true;
  spinner.hidden = false;

  try {
    const formData = new FormData();
    formData.append('file', selectedFile);
    const res = await fetch(`/api/upload/${week}`, { method: 'POST', body: formData });
    const data = await res.json();

    if (res.ok) {
      showAlert(`✅ Archivo "${data.originalname}" subido a la Semana ${week}.`, 'success');
      selectedFile = null;
      fileInput.value = '';
      filePreview.hidden = true;
      dropZone.hidden = false;
      loadStats();
      loadWeekFileCounts();
      if (activeWeek == week) renderWeekFiles(week);
    } else {
      showAlert(`❌ Error: ${data.error}`, 'error');
    }
  } catch {
    showAlert('❌ Error de conexión al subir el archivo.', 'error');
  } finally {
    submitBtn.disabled = false;
    submitText.hidden = false;
    spinner.hidden = true;
  }
});

function showAlert(msg, type) {
  uploadAlert.textContent = msg;
  uploadAlert.className = `upload-alert ${type}`;
  uploadAlert.hidden = false;
  setTimeout(() => { uploadAlert.hidden = true; }, 5000);
}

// ===== INIT =====
buildWeekTabs();
loadStats();
loadWeekFileCounts();
