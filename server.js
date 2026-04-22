require('dotenv').config();
const express = require('express');
const multer = require('multer');
const admin = require('firebase-admin');

// ===== FIREBASE INIT =====
admin.initializeApp({
  credential: admin.credential.cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  }),
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
});

const bucket = admin.storage().bucket();

// ===== EXPRESS =====
const app = express();
app.use(express.static('public'));
app.use(express.json());

// Multer en memoria (no disco) para pasar a Firebase
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
function weekPrefix(week) {
  return `semana-${week}/`;
}

async function makePublic(file) {
  await file.makePublic();
  return `https://storage.googleapis.com/${bucket.name}/${file.name}`;
}

// ===== ROUTES =====

// Subir archivo a una semana
app.post('/api/upload/:week', upload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No se subió ningún archivo' });

  const week = req.params.week;
  const safeName = req.file.originalname.replace(/[^a-zA-Z0-9._\-\s]/g, '_');
  const destName = `${weekPrefix(week)}${Date.now()}-${safeName}`;

  const fileRef = bucket.file(destName);
  await fileRef.save(req.file.buffer, { contentType: req.file.mimetype });
  const publicUrl = await makePublic(fileRef);

  res.json({
    success: true,
    filename: destName,
    originalname: req.file.originalname,
    size: req.file.size,
    week,
    url: publicUrl,
  });
});

// Obtener archivos de una semana
app.get('/api/files/:week', async (req, res) => {
  const [firebaseFiles] = await bucket.getFiles({ prefix: weekPrefix(req.params.week) });

  const files = await Promise.all(
    firebaseFiles.map(async f => {
      const [meta] = await f.getMetadata();
      const parts = f.name.split('/');
      const rawName = parts[parts.length - 1];
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
});

// Eliminar archivo
app.delete('/api/files/:week/*', async (req, res) => {
  const filePath = req.params[0]
    ? `${weekPrefix(req.params.week)}${req.params[0]}`
    : req.query.path;

  if (!filePath) return res.status(400).json({ error: 'Falta el path del archivo' });

  await bucket.file(filePath).delete();
  res.json({ success: true });
});

// Resumen de todas las semanas
app.get('/api/weeks', async (req, res) => {
  const [allFiles] = await bucket.getFiles();
  const counts = {};

  allFiles.forEach(f => {
    const match = f.name.match(/^semana-(\d+)\//);
    if (match) {
      const w = match[1];
      counts[w] = (counts[w] || 0) + 1;
    }
  });

  const weeks = Object.entries(counts).map(([week, fileCount]) => ({ week, fileCount }));
  res.json({ weeks });
});

// ===== ERROR HANDLER =====
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'El archivo supera 50MB' });
  res.status(400).json({ error: err.message });
});

// ===== START =====
// En Vercel exportamos el app; localmente levantamos el servidor
if (process.env.NODE_ENV !== 'production') {
  const PORT = process.env.PORT || 3000;
  app.listen(PORT, () => console.log(`Servidor en http://localhost:${PORT}`));
}

module.exports = app;
