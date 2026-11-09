const express = require('express');
const bcrypt = require('bcryptjs');
const { q, uno } = require('../db');
const { requiereSesion, bitacora } = require('../seguridad');
const { texto } = require('../util');

const router = express.Router();

// Bloqueo temporal tras varios intentos fallidos, por usuario y dirección
const intentos = new Map();
const MAX_INTENTOS = 5;
const BLOQUEO_MS = 5 * 60 * 1000;

function bloqueado(clave) {
  const r = intentos.get(clave);
  return r && r.n >= MAX_INTENTOS && Date.now() - r.ultimo < BLOQUEO_MS;
}

function fallo(clave) {
  const r = intentos.get(clave);
  const vencido = !r || Date.now() - r.ultimo > BLOQUEO_MS;
  intentos.set(clave, { n: vencido ? 1 : r.n + 1, ultimo: Date.now() });
}

router.get('/login', (req, res) => {
  if (req.usuario) return res.redirect('/');
  res.render('login', { titulo: 'Iniciar sesión', usuarioEscrito: '' });
});

router.post('/login', async (req, res) => {
  const usuario = (texto(req.body.usuario, 50) || '').toLowerCase();
  const clave = `${usuario}|${req.ip}`;
  const volver = (mensaje) => res.status(401).render('login', { titulo: 'Iniciar sesión', usuarioEscrito: usuario, error: mensaje });

  if (bloqueado(clave)) return volver('Demasiados intentos. Espera 5 minutos e inténtalo de nuevo.');
  const u = await uno('SELECT id, password_hash FROM usuario WHERE usuario = ? AND activo = 1', [usuario]);
  if (!u || !(await bcrypt.compare(String(req.body.password || ''), u.password_hash))) {
    fallo(clave);
    return volver('Usuario o contraseña incorrectos.');
  }
  intentos.delete(clave);
  const destino = req.session.volverA && req.session.volverA.startsWith('/') ? req.session.volverA : '/';
  // Sesión nueva al entrar (evita fijación de sesión); la redirección espera a que quede guardada (server.js)
  await new Promise((ok, mal) => req.session.regenerate((e) => (e ? mal(e) : ok())));
  req.session.usuarioId = u.id;
  req.usuario = { id: u.id };
  await bitacora(req, 'ENTRAR', 'sesion', u.id);
  res.redirect(destino);
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

router.get('/cuenta', requiereSesion, (req, res) => {
  res.render('cuenta', { titulo: 'Mi cuenta' });
});

router.post('/cuenta/password', requiereSesion, async (req, res) => {
  const { actual, nueva, confirmacion } = req.body;
  const u = await uno('SELECT password_hash FROM usuario WHERE id = ?', [req.usuario.id]);
  if (!(await bcrypt.compare(String(actual || ''), u.password_hash))) {
    req.flash('error', 'La contraseña actual no es correcta.');
  } else if (!nueva || String(nueva).length < 8) {
    req.flash('error', 'La nueva contraseña debe tener al menos 8 caracteres.');
  } else if (nueva !== confirmacion) {
    req.flash('error', 'La confirmación no coincide.');
  } else {
    await q('UPDATE usuario SET password_hash = ? WHERE id = ?', [await bcrypt.hash(nueva, 10), req.usuario.id]);
    req.flash('ok', 'Contraseña actualizada.');
  }
  res.redirect('/cuenta');
});

/** El médico captura sus propios datos profesionales, que salen impresos en recetas y certificados. */
router.post('/cuenta/datos', requiereSesion, async (req, res) => {
  const nombre = texto(req.body.nombre, 150);
  if (!nombre) {
    req.flash('error', 'Escribe tu nombre.');
    return res.redirect('/cuenta');
  }
  if (req.usuario.esMedico) {
    await q(`UPDATE usuario SET nombre = ?, cedula = ?, especialidad = ?, cedula_especialidad = ?, universidad = ? WHERE id = ?`,
      [nombre, texto(req.body.cedula, 30), texto(req.body.especialidad, 120), texto(req.body.cedula_especialidad, 30),
        texto(req.body.universidad, 200), req.usuario.id]);
  } else {
    await q('UPDATE usuario SET nombre = ? WHERE id = ?', [nombre, req.usuario.id]);
  }
  req.flash('ok', 'Datos guardados.');
  res.redirect('/cuenta');
});

module.exports = router;
