// Solo para desarrollo local — Vercel usa api/index.js
require('dotenv').config();
const app = require('./api/index');
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor en http://localhost:${PORT}`));
