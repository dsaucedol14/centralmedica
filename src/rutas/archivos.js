/** Estudios y documentos adjuntos al expediente. Se guardan fuera de la carpeta pública y solo se sirven con sesión. */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const config = require('../config');
const { q, uno } = require('../db');
const { validarCsrf, prohibido, bitacora } = require('../seguridad');
const { texto } = require('../util');

const router = express.Router();

const CATEGORIAS = ['Laboratorio', 'Imagen / gabinete', 'Interconsulta', 'Consentimiento informado', 'Identificación', 'Otro'];
const PERMITIDOS = {
  'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp',
  'image/heic': '.heic', 'text/plain': '.txt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/msword': '.doc',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
};

const subir = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, config.uploads),
    // Nombre aleatorio: el nombre original nunca toca el disco
    filename: (req, file, cb) => cb(null, crypto.randomBytes(16).toString('hex') + PERMITIDOS[file.mimetype]),
  }),
  limits: { fileSize: config.uploadMaxMb * 1024 * 1024, files: 10 },
  fileFilter: (req, file, cb) => cb(null, !!PERMITIDOS[file.mimetype]),
});

router.post('/pacientes/:id/archivos', validarCsrf, subir.array('archivos', 10), async (req, res) => {
  const p = await uno('SELECT id FROM paciente WHERE id = ?', [req.params.id]);
  const archivos = req.files || [];
  if (!p) {
    archivos.forEach((a) => fs.rm(a.path, () => {}));
    return res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'Ese paciente no existe.' });
  }
  if (!archivos.length) {
    req.flash('error', 'Elige al menos un archivo PDF, imagen o documento de Office.');
    return res.redirect(`/pacientes/${p.id}?tab=archivos`);
  }
  const categoria = CATEGORIAS.includes(req.body.categoria) ? req.body.categoria : 'Otro';
  const descripcion = texto(req.body.descripcion, 250);
  for (const a of archivos) {
    // multer entrega el nombre en latin1; se reinterpreta como UTF-8 para conservar acentos
    const original = Buffer.from(a.originalname, 'latin1').toString('utf8').slice(0, 255);
    const r = await q(
      `INSERT INTO archivo (paciente_id, categoria, descripcion, nombre_original, nombre_guardado, tipo_mime, tamano, subido_por)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [p.id, categoria, descripcion, original, a.filename, a.mimetype, a.size, req.usuario.id]);
    await bitacora(req, 'SUBIR', 'archivo', r.insertId, p.id, original);
  }
  req.flash('ok', archivos.length === 1 ? 'Archivo agregado al expediente.' : `${archivos.length} archivos agregados al expediente.`);
  res.redirect(`/pacientes/${p.id}?tab=archivos`);
});

router.get('/archivos/:id', async (req, res) => {
  const a = await uno('SELECT * FROM archivo WHERE id = ?', [req.params.id]);
  if (!a) return res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'Ese archivo no existe.' });
  const ruta = path.join(config.uploads, path.basename(a.nombre_guardado));
  if (!fs.existsSync(ruta)) return res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'El archivo ya no está en el servidor.' });
  await bitacora(req, 'VER', 'archivo', a.id, a.paciente_id, a.nombre_original);
  const enLinea = req.query.descargar !== '1' && (a.tipo_mime === 'application/pdf' || a.tipo_mime.startsWith('image/'));
  res.set('Cache-Control', 'private, no-store');
  res.attachment(a.nombre_original);
  if (enLinea) res.set('Content-Disposition', res.get('Content-Disposition').replace(/^attachment/, 'inline'));
  res.type(a.tipo_mime).sendFile(ruta);
});

router.post('/archivos/:id/eliminar', async (req, res) => {
  const a = await uno('SELECT * FROM archivo WHERE id = ?', [req.params.id]);
  if (!a) return res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'Ese archivo no existe.' });
  if (a.subido_por !== req.usuario.id && !req.usuario.esAdmin) return prohibido(res, 'Solo quien subió el archivo o un administrador puede eliminarlo.');
  await q('DELETE FROM archivo WHERE id = ?', [a.id]);
  fs.rm(path.join(config.uploads, path.basename(a.nombre_guardado)), { force: true }, () => {});
  await bitacora(req, 'ELIMINAR', 'archivo', a.id, a.paciente_id, a.nombre_original);
  req.flash('ok', 'Archivo eliminado.');
  res.redirect(`/pacientes/${a.paciente_id}?tab=archivos`);
});

module.exports = router;
module.exports.CATEGORIAS = CATEGORIAS;
