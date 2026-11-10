/** Administración > Respaldos: generar, descargar, importar y restaurar. Solo administradores. */
const fs = require('fs');
const express = require('express');
const multer = require('multer');
const bcrypt = require('bcryptjs');
const config = require('../config');
const { uno } = require('../db');
const { validarCsrf, bitacora } = require('../seguridad');
const respaldo = require('../respaldo');

const router = express.Router();

const subir = multer({
  storage: multer.diskStorage({ destination: (req, file, cb) => respaldo.carpetaTemporal().then((d) => cb(null, d), cb) }),
  limits: { fileSize: config.respaldoMaxMb * 1024 * 1024, files: 1 },
});

function avisarError(req, res, e) {
  if (!(e instanceof respaldo.ErrorRespaldo)) console.error(e);
  req.flash('error', e instanceof respaldo.ErrorRespaldo ? e.message : `No se pudo completar: ${e.message}`);
  res.redirect('/admin/respaldos');
}

router.get('/', async (req, res) => {
  res.render('admin/respaldos', { titulo: 'Respaldos', respaldos: await respaldo.listar(), maxMb: config.respaldoMaxMb });
});

router.post('/', async (req, res) => {
  try {
    const incluirArchivos = req.body.incluir_archivos === '1';
    const r = await respaldo.generar({ incluirArchivos, usuario: req.usuario.nombre });
    await bitacora(req, 'RESPALDAR', 'sistema', null, null, r.nombre);
    req.flash('ok', `Respaldo generado: ${r.nombre}. Descárgalo y guárdalo fuera de esta computadora.`);
    res.redirect('/admin/respaldos');
  } catch (e) {
    avisarError(req, res, e);
  }
});

router.post('/importar', validarCsrf, subir.single('archivo'), async (req, res) => {
  if (!req.file) {
    req.flash('error', 'Elige el archivo del respaldo (.zip).');
    return res.redirect('/admin/respaldos');
  }
  try {
    const original = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const nombre = await respaldo.importar(req.file.path, original);
    await bitacora(req, 'IMPORTAR', 'respaldo', null, null, `${original} → ${nombre}`);
    req.flash('ok', `Respaldo importado: ${nombre}. Ahora puedes revisarlo y restaurarlo desde la lista.`);
    res.redirect('/admin/respaldos');
  } catch (e) {
    fs.rm(req.file.path, { force: true }, () => {});
    avisarError(req, res, e);
  }
});

router.get('/:nombre/descargar', async (req, res) => {
  try {
    const ruta = respaldo.rutaDe(req.params.nombre);
    if (!fs.existsSync(ruta)) throw new respaldo.ErrorRespaldo('Ese respaldo ya no existe.');
    await bitacora(req, 'DESCARGAR', 'respaldo', null, null, req.params.nombre);
    res.set('Cache-Control', 'private, no-store');
    res.download(ruta, req.params.nombre);
  } catch (e) {
    avisarError(req, res, e);
  }
});

/** Solo la base de datos (.sql), extraída del respaldo. */
router.get('/:nombre/base-de-datos', async (req, res) => {
  try {
    const ruta = respaldo.rutaDe(req.params.nombre);
    if (!fs.existsSync(ruta)) throw new respaldo.ErrorRespaldo('Ese respaldo ya no existe.');
    await bitacora(req, 'DESCARGAR', 'respaldo', null, null, `${req.params.nombre} (solo base de datos)`);
    await respaldo.flujoSql(ruta, (flujo) => new Promise((ok, mal) => {
      res.set('Cache-Control', 'private, no-store');
      res.attachment(req.params.nombre.replace(/\.(zip|sql)$/, '') + '_base-de-datos.sql');
      res.type('application/sql');
      flujo.on('error', mal);
      res.on('finish', ok);
      res.on('close', ok);
      flujo.pipe(res);
    }));
  } catch (e) {
    if (res.headersSent) return res.destroy(e);
    avisarError(req, res, e);
  }
});

router.get('/:nombre/restaurar', async (req, res) => {
  try {
    const ruta = respaldo.rutaDe(req.params.nombre);
    const info = fs.existsSync(ruta) ? await respaldo.inspeccionar(ruta) : null;
    if (!info) throw new respaldo.ErrorRespaldo('Ese respaldo no existe o no es válido.');
    res.render('admin/respaldo-restaurar', { titulo: 'Restaurar respaldo', nombre: req.params.nombre, info, error: null });
  } catch (e) {
    avisarError(req, res, e);
  }
});

router.post('/:nombre/restaurar', async (req, res) => {
  const nombre = req.params.nombre;
  let info;
  try {
    info = await respaldo.inspeccionar(respaldo.rutaDe(nombre));
    if (!info) throw new respaldo.ErrorRespaldo('Ese respaldo no existe o no es válido.');
  } catch (e) {
    return avisarError(req, res, e);
  }
  const fallo = (error) => res.status(400).render('admin/respaldo-restaurar', { titulo: 'Restaurar respaldo', nombre, info, error });
  if (String(req.body.confirmacion || '').trim().toUpperCase() !== 'RESTAURAR') return fallo('Escribe la palabra RESTAURAR para confirmar.');
  const yo = await uno('SELECT password_hash FROM usuario WHERE id = ?', [req.usuario.id]);
  if (!yo || !(await bcrypt.compare(String(req.body.password || ''), yo.password_hash))) return fallo('Tu contraseña no es correcta.');
  try {
    const r = await respaldo.restaurar(nombre, { conArchivos: req.body.con_archivos === '1', usuario: req.usuario.nombre });
    await bitacora(req, 'RESTAURAR', 'sistema', null, null, `${nombre}${r.archivosRestaurados ? ' (con archivos)' : ''} · respaldo previo: ${r.seguridad}`);
    // La sesión se borró con la restauración: se avisa en la pantalla de inicio de sesión
    req.session.regenerate(() => {
      req.session.flash = { ok: `Restauración terminada. Inicia sesión de nuevo. Si necesitas deshacerla, usa el respaldo «${r.seguridad}».` };
      res.redirect('/login');
    });
  } catch (e) {
    avisarError(req, res, e);
  }
});

router.post('/:nombre/eliminar', async (req, res) => {
  try {
    await respaldo.eliminar(req.params.nombre);
    await bitacora(req, 'ELIMINAR', 'respaldo', null, null, req.params.nombre);
    req.flash('ok', `Respaldo ${req.params.nombre} eliminado.`);
    res.redirect('/admin/respaldos');
  } catch (e) {
    avisarError(req, res, e);
  }
});

module.exports = router;
