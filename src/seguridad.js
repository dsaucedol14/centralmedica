const crypto = require('crypto');
const { q } = require('./db');

/** Encabezados básicos de seguridad para todas las respuestas. */
function encabezados(req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'SAMEORIGIN',
    'Referrer-Policy': 'same-origin',
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; frame-src 'self'; object-src 'self'",
  });
  next();
}

/** Mensajes de una sola vez entre redirecciones (?flash). */
function flash(req, res, next) {
  res.locals.mensajes = req.session.flash || {};
  delete req.session.flash;
  req.flash = (tipo, texto) => {
    req.session.flash = req.session.flash || {};
    req.session.flash[tipo] = texto;
  };
  next();
}

/** Token CSRF por sesión; se exige en todo POST (campo _csrf, o ?_csrf= en formularios con archivos). */
function csrf(req, res, next) {
  if (!req.session.csrf) req.session.csrf = crypto.randomBytes(24).toString('hex');
  res.locals.csrf = req.session.csrf;
  next();
}

function validarCsrf(req, res, next) {
  if (req.method !== 'POST') return next();
  const token = (req.body && req.body._csrf) || req.query._csrf || req.get('x-csrf-token');
  const esperado = req.session.csrf;
  if (!token || !esperado || token.length !== esperado.length
      || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(esperado))) {
    return res.status(403).render('error', { titulo: 'Sesión vencida', mensaje: 'El formulario caducó. Regresa, recarga la página e inténtalo de nuevo.' });
  }
  next();
}

/** Carga el usuario de la sesión (siempre desde la base, para que una baja o cambio de rol aplique al momento). */
async function cargarUsuario(req, res, next) {
  res.locals.usuario = null;
  if (req.session.usuarioId) {
    const u = (await q('SELECT id, usuario, nombre, rol, es_admin, cedula, especialidad, cedula_especialidad, universidad FROM usuario WHERE id = ? AND activo = 1', [req.session.usuarioId]))[0];
    if (u) {
      u.esMedico = u.rol === 'MEDICO';
      u.esRecepcion = u.rol === 'RECEPCION';
      u.esAdmin = !!u.es_admin;
      req.usuario = u;
      res.locals.usuario = u;
    } else {
      delete req.session.usuarioId;
    }
  }
  next();
}

function requiereSesion(req, res, next) {
  if (req.usuario) return next();
  if (req.method === 'GET') req.session.volverA = req.originalUrl;
  res.redirect('/login');
}

/** La recepción solo ve su módulo: nunca expedientes, consultas ni documentos clínicos. */
const PERMITIDO_A_RECEPCION = /^\/(recepcion|cuenta|ayuda)(\/|$)/;
function limitarRecepcion(req, res, next) {
  if (!req.usuario.esRecepcion || PERMITIDO_A_RECEPCION.test(req.path)) return next();
  if (req.method === 'GET' && !req.path.startsWith('/api/')) return res.redirect('/recepcion');
  prohibido(res, 'Tu usuario es de recepción: solo tienes acceso al módulo de Recepción.');
}

/** Pacientes que esperan al médico en sesión (para el contador de la barra). */
async function salaDeEspera(req, res, next) {
  res.locals.enEspera = 0;
  if (req.usuario.esMedico) {
    const [r] = await q("SELECT COUNT(*) AS n FROM turno WHERE medico_id = ? AND estado = 'EN_ESPERA' AND llegada >= CURDATE()", [req.usuario.id]);
    res.locals.enEspera = r.n;
  }
  next();
}

function prohibido(res, mensaje) {
  return res.status(403).render('error', { titulo: 'Sin permiso', mensaje });
}

function requiereMedico(req, res, next) {
  if (req.usuario && req.usuario.esMedico) return next();
  prohibido(res, 'Solo un médico puede hacer esto.');
}

function requiereAdmin(req, res, next) {
  if (req.usuario && req.usuario.esAdmin) return next();
  prohibido(res, 'Solo un administrador puede entrar aquí.');
}

/** Registro de quién hizo qué en los expedientes. Nunca interrumpe la operación si falla. */
async function bitacora(req, accion, entidad, entidadId, pacienteId, detalle) {
  try {
    await q('INSERT INTO bitacora (usuario_id, accion, entidad, entidad_id, paciente_id, detalle) VALUES (?, ?, ?, ?, ?, ?)',
      [req.usuario ? req.usuario.id : null, accion, entidad, entidadId || null, pacienteId || null,
        detalle ? String(detalle).slice(0, 300) : null]);
  } catch (e) {
    console.error('No se pudo escribir en la bitácora:', e.message);
  }
}

module.exports = {
  encabezados, flash, csrf, validarCsrf, cargarUsuario,
  requiereSesion, requiereMedico, requiereAdmin, prohibido, bitacora, limitarRecepcion, salaDeEspera,
};
