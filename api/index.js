const express = require('express');
const multer = require('multer');
const { put, list, del } = require('@vercel/blob');

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
  res.json({ ok: true, storage: 'vercel-blob', hasToken: !!process.env.BLOB_READ_WRITE_TOKEN });
});

app.post('/api/upload/:week', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });
    const week = req.params.week;
    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._\-\s]/g, '_');
    const pathname = `semana-${week}/${Date.now()}-${safeName}`;

    const blob = await put(pathname, req.file.buffer, {
      access: 'public',
      contentType: req.file.mimetype,
    });

    res.json({ success: true, filename: blob.pathname, originalname: req.file.originalname, size: req.file.size, week, url: blob.url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/files/:week', async (req, res) => {
  try {
    const { blobs } = await list({ prefix: `semana-${req.params.week}/` });
    const files = blobs.map(b => ({
      filename: b.pathname,
      originalname: b.pathname.split('/').pop().replace(/^\d+-/, ''),
      size: b.size,
      date: b.uploadedAt,
      url: b.url,
    }));
    res.json({ files });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/files/:week', async (req, res) => {
  try {
    const url = decodeURIComponent(req.query.path || '');
    if (!url) return res.status(400).json({ error: 'Falta la URL del archivo' });
    await del(url);
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/weeks', async (req, res) => {
  try {
    const counts = {};
    await Promise.all(
      Array.from({ length: 16 }, (_, i) => i + 1).map(async w => {
        const { blobs } = await list({ prefix: `semana-${w}/` });
        if (blobs.length > 0) counts[w] = blobs.length;
      })
    );
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
