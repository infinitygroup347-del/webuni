const express = require('express');
const multer = require('multer');
const { GoogleAuth } = require('google-auth-library');

// ===== GOOGLE AUTH =====
const BUCKET = process.env.FIREBASE_STORAGE_BUCKET;
const GCS = 'https://storage.googleapis.com/storage/v1';
const GCS_UP = 'https://storage.googleapis.com/upload/storage/v1';

let authClient = null;

function getAuth() {
  if (!authClient) {
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '')
      .replace(/\\n/g, '\n')
      .replace(/^"|"$/g, '');

    authClient = new GoogleAuth({
      credentials: {
        type: 'service_account',
        project_id: process.env.FIREBASE_PROJECT_ID,
        client_email: process.env.FIREBASE_CLIENT_EMAIL,
        private_key: privateKey,
      },
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });
  }
  return authClient;
}

async function getToken() {
  const client = await getAuth().getClient();
  const { token } = await client.getAccessToken();
  return token;
}

// ===== STORAGE HELPERS =====
async function gcsUpload(buffer, path, contentType) {
  const token = await getToken();
  const url = `${GCS_UP}/b/${encodeURIComponent(BUCKET)}/o?uploadType=media&name=${encodeURIComponent(path)}&predefinedAcl=publicRead`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': contentType },
    body: buffer,
  });
  if (!res.ok) throw new Error(`Upload failed: ${await res.text()}`);
  return `https://storage.googleapis.com/${BUCKET}/${path}`;
}

async function gcsList(prefix) {
  const token = await getToken();
  const url = `${GCS}/b/${encodeURIComponent(BUCKET)}/o?prefix=${encodeURIComponent(prefix)}`;
  const res = await fetch(url, { headers: { 'Authorization': `Bearer ${token}` } });
  const data = await res.json();
  return data.items || [];
}

async function gcsDelete(path) {
  const token = await getToken();
  const url = `${GCS}/b/${encodeURIComponent(BUCKET)}/o/${encodeURIComponent(path)}`;
  await fetch(url, { method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` } });
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

app.get('/api/health', async (req, res) => {
  try {
    await getToken();
    res.json({ ok: true, bucket: BUCKET });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e.message,
      env: {
        project: !!process.env.FIREBASE_PROJECT_ID,
        email: !!process.env.FIREBASE_CLIENT_EMAIL,
        key: !!process.env.FIREBASE_PRIVATE_KEY,
        bucket: !!process.env.FIREBASE_STORAGE_BUCKET,
      }
    });
  }
});

app.post('/api/upload/:week', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });
    const week = req.params.week;
    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._\-\s]/g, '_');
    const path = `semana-${week}/${Date.now()}-${safeName}`;
    const url = await gcsUpload(req.file.buffer, path, req.file.mimetype);
    res.json({ success: true, filename: path, originalname: req.file.originalname, size: req.file.size, week, url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/files/:week', async (req, res) => {
  try {
    const items = await gcsList(`semana-${req.params.week}/`);
    const files = items.map(item => ({
      filename: item.name,
      originalname: item.name.split('/').pop().replace(/^\d+-/, ''),
      size: parseInt(item.size, 10),
      date: item.updated,
      url: `https://storage.googleapis.com/${BUCKET}/${item.name}`,
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
    await gcsDelete(path);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/weeks', async (req, res) => {
  try {
    const items = await gcsList('semana-');
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
