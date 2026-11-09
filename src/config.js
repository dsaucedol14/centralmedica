const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const raiz = path.join(__dirname, '..');

module.exports = {
  puerto: Number(process.env.PORT || 3100),
  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'consultorio',
  },
  secretoSesion: process.env.SESSION_SECRET || 'solo-para-desarrollo-cambiar',
  admin: {
    usuario: process.env.ADMIN_USUARIO || 'admin',
    password: process.env.ADMIN_PASSWORD || 'consultorio-dev',
  },
  uploads: path.resolve(raiz, process.env.UPLOADS_DIR || './uploads'),
  uploadMaxMb: Number(process.env.UPLOAD_MAX_MB || 20),
  produccion: process.env.NODE_ENV === 'production',
};
