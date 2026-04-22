const express = require('express');
const multer = require('multer');

const BUCKET = process.env.FIREBASE_STORAGE_BUCKET; // webuni-96ff7.firebasestorage.app
const API_KEY = process.env.FIREBASE_API_KEY;        // AIzaSy...
const BASE = `https://firebasestorage.googleapis.com/v0/b/${encodeURIComponent(BUCKET)}/o`;

// ===== STORAGE HELPERS =====
async function uploadFile(buffer, path, contentType) {
  const url = `${BASE}?name=${encodeURIComponent(path)}&key=${API_KEY}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': contentType },
    body: buffer,
  });
  if (!res.ok) throw new Error(`Firebase upload error: ${await res.text()}`);
  return publicUrl(path);
}

async function listFiles(prefix) {
  const url = `${BASE}?prefix=${encodeURIComponent(prefix)}&key=${API_KEY}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Firebase list error: ${await res.text()}`);
  const data = await res.json();
  return data.items || [];
}

async function deleteFile(path) {
  const url = `${BASE}/${encodeURIComponent(path)}?key=${API_KEY}`;
  const res = await fetch(url, { method: 'DELETE' });
  if (!res.ok) throw new Error(`Firebase delete error: ${await res.text()}`);
}

function publicUrl(path) {
  return `https://firebasestorage.googleapis.com/v0/b/${BUCKET}/o/${encodeURIComponent(path)}?alt=media`;
}

// ===== EXPRESS =====
const app = express();
app.use(express.json());

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/pdf', 'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/zip', 'image/jpeg', 'image/png', 'image/gif',
      'text/plain', 'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Tipo de archivo no permitido'), false);
  }
});

// ===== ROUTES =====

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    bucket: BUCKET,
    hasKey: !!API_KEY,
  });
});

app.post('/api/upload/:week', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });
    const week = req.params.week;
    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._\-\s]/g, '_');
    const path = `semana-${week}/${Date.now()}-${safeName}`;
    const url = await uploadFile(req.file.buffer, path, req.file.mimetype);
    res.json({ success: true, filename: path, originalname: req.file.originalname, size: req.file.size, week, url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/files/:week', async (req, res) => {
  try {
    const items = await listFiles(`semana-${req.params.week}/`);
    const files = items.map(item => ({
      filename: item.name,
      originalname: item.name.split('/').pop().replace(/^\d+-/, ''),
      size: parseInt(item.size, 10),
      date: item.timeCreated,
      url: publicUrl(item.name),
    }));
    res.json({ files });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/files/:week', async (req, res) => {
  try {
    const path = decodeURIComponent(req.query.path || '');
    if (!path) return res.status(400).json({ error: 'Falta el path' });
    await deleteFile(path);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/weeks', async (req, res) => {
  try {
    const items = await listFiles('semana-');
    const counts = {};
    items.forEach(item => {
      const match = item.name.match(/^semana-(\d+)\//);
      if (match) counts[match[1]] = (counts[match[1]] || 0) + 1;
    });
    res.json({ weeks: Object.entries(counts).map(([week, fileCount]) => ({ week, fileCount })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Archivo supera 50MB' });
  res.status(500).json({ error: err.message });
});

module.exports = app;
