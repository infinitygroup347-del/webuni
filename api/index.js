const express = require('express');
const multer = require('multer');
const { initializeApp, getApps } = require('firebase/app');
const {
  getStorage, ref,
  uploadBytes, getDownloadURL,
  listAll, deleteObject, getMetadata,
} = require('firebase/storage');

// ===== FIREBASE =====
const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
};

const firebaseApp = getApps().length
  ? getApps()[0]
  : initializeApp(firebaseConfig);

const storage = getStorage(firebaseApp);

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
    bucket: process.env.FIREBASE_STORAGE_BUCKET,
    hasKey: !!process.env.FIREBASE_API_KEY,
  });
});

app.post('/api/upload/:week', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });
    const week = req.params.week;
    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._\-\s]/g, '_');
    const path = `semana-${week}/${Date.now()}-${safeName}`;

    const fileRef = ref(storage, path);
    await uploadBytes(fileRef, req.file.buffer, { contentType: req.file.mimetype });
    const url = await getDownloadURL(fileRef);

    res.json({ success: true, filename: path, originalname: req.file.originalname, size: req.file.size, week, url });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/files/:week', async (req, res) => {
  try {
    const weekRef = ref(storage, `semana-${req.params.week}`);
    const result = await listAll(weekRef);

    const files = await Promise.all(
      result.items.map(async item => {
        const [url, meta] = await Promise.all([getDownloadURL(item), getMetadata(item)]);
        return {
          filename: item.fullPath,
          originalname: item.name.replace(/^\d+-/, ''),
          size: meta.size,
          date: meta.timeCreated,
          url,
        };
      })
    );
    res.json({ files });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/files/:week', async (req, res) => {
  try {
    const path = decodeURIComponent(req.query.path || '');
    if (!path) return res.status(400).json({ error: 'Falta el path' });
    await deleteObject(ref(storage, path));
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/weeks', async (req, res) => {
  try {
    const counts = {};
    const weeks = Array.from({ length: 16 }, (_, i) => i + 1);
    await Promise.all(weeks.map(async w => {
      const result = await listAll(ref(storage, `semana-${w}`));
      if (result.items.length > 0) counts[w] = result.items.length;
    }));
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
