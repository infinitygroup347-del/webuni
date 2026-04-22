const express = require('express');
const multer = require('multer');
const admin = require('firebase-admin');

// ===== FIREBASE INIT (una sola vez) =====
let bucket = null;
let firebaseError = null;

if (!admin.apps.length) {
  try {
    const privateKey = (process.env.FIREBASE_PRIVATE_KEY || '')
      .replace(/\\n/g, '\n')
      .replace(/^"|"$/g, '');

    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID,
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey,
      }),
      storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
    });

    bucket = admin.storage().bucket();
  } catch (e) {
    firebaseError = e.message;
    console.error('Firebase init FAILED:', e.message);
  }
} else {
  try {
    bucket = admin.storage().bucket();
  } catch (e) {
    firebaseError = e.message;
  }
}

// ===== EXPRESS =====
const app = express();
app.use(express.json());

// ===== MULTER =====
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/zip',
      'image/jpeg', 'image/png', 'image/gif',
      'text/plain',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ];
    if (allowed.includes(file.mimetype)) cb(null, true);
    else cb(new Error('Tipo de archivo no permitido'), false);
  }
});

// ===== HELPERS =====
function weekPrefix(week) { return `semana-${week}/`; }

async function makePublic(file) {
  await file.makePublic();
  return `https://storage.googleapis.com/${bucket.name}/${file.name}`;
}

function checkBucket(res) {
  if (!bucket) {
    res.status(500).json({ error: 'Firebase no inicializado', detail: firebaseError });
    return false;
  }
  return true;
}

// ===== ROUTES =====

app.get('/api/health', async (req, res) => {
  if (!bucket) {
    return res.status(500).json({
      ok: false,
      error: firebaseError,
      env: {
        project: !!process.env.FIREBASE_PROJECT_ID,
        email: !!process.env.FIREBASE_CLIENT_EMAIL,
        key: !!process.env.FIREBASE_PRIVATE_KEY,
        bucket: !!process.env.FIREBASE_STORAGE_BUCKET,
      }
    });
  }
  try {
    await bucket.exists();
    res.json({ ok: true, bucket: bucket.name });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message });
  }
});

app.post('/api/upload/:week', upload.single('file'), async (req, res) => {
  try {
    if (!checkBucket(res)) return;
    if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });

    const week = req.params.week;
    const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._\-\s]/g, '_');
    const destName = `${weekPrefix(week)}${Date.now()}-${safeName}`;

    const fileRef = bucket.file(destName);
    await fileRef.save(req.file.buffer, { contentType: req.file.mimetype });
    const publicUrl = await makePublic(fileRef);

    res.json({ success: true, filename: destName, originalname: req.file.originalname, size: req.file.size, week, url: publicUrl });
  } catch (e) {
    console.error('upload error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/files/:week', async (req, res) => {
  try {
    if (!checkBucket(res)) return;
    const [firebaseFiles] = await bucket.getFiles({ prefix: weekPrefix(req.params.week) });

    const files = await Promise.all(
      firebaseFiles.map(async f => {
        const [meta] = await f.getMetadata();
        const rawName = f.name.split('/').pop();
        return {
          filename: f.name,
          originalname: rawName.replace(/^\d+-/, ''),
          size: parseInt(meta.size, 10),
          date: meta.updated,
          url: `https://storage.googleapis.com/${bucket.name}/${f.name}`,
        };
      })
    );
    res.json({ files });
  } catch (e) {
    console.error('files error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/files/:week', async (req, res) => {
  try {
    if (!checkBucket(res)) return;
    const filePath = decodeURIComponent(req.query.path || '');
    if (!filePath) return res.status(400).json({ error: 'Falta el path' });
    await bucket.file(filePath).delete();
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/weeks', async (req, res) => {
  try {
    if (!checkBucket(res)) return;
    const [allFiles] = await bucket.getFiles();
    const counts = {};
    allFiles.forEach(f => {
      const match = f.name.match(/^semana-(\d+)\//);
      if (match) counts[match[1]] = (counts[match[1]] || 0) + 1;
    });
    res.json({ weeks: Object.entries(counts).map(([week, fileCount]) => ({ week, fileCount })) });
  } catch (e) {
    console.error('weeks error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'Archivo supera 50MB' });
  res.status(500).json({ error: err.message });
});

module.exports = app;
