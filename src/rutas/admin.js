const express = require('express');
const bcrypt = require('bcryptjs');
const { q, uno } = require('../db');
const { bitacora } = require('../seguridad');
const { texto, fechaISO, hoy } = require('../util');

const router = express.Router();

/* ----------------------------- Usuarios ----------------------------- */

router.get('/usuarios', async (req, res) => {
  const usuarios = await q('SELECT * FROM usuario ORDER BY activo DESC, rol, nombre');
  res.render('admin/usuarios', { titulo: 'Usuarios', usuarios });
});

router.get('/usuarios/nuevo', (req, res) => {
  res.render('admin/usuario-form', { titulo: 'Nuevo usuario', u: { rol: 'MEDICO', activo: 1 }, error: null });
});

function leer(body) {
  return {
    usuario: (texto(body.usuario, 50) || '').toLowerCase(),
    nombre: texto(body.nombre, 150),
    rol: body.rol === 'MEDICO' ? 'MEDICO' : 'ASISTENTE',
    es_admin: body.es_admin === '1' ? 1 : 0,
    activo: body.activo === '1' ? 1 : 0,
    cedula: texto(body.cedula, 30),
    especialidad: texto(body.especialidad, 120),
    cedula_especialidad: texto(body.cedula_especialidad, 30),
    universidad: texto(body.universidad, 200),
  };
}

async function quedaAdmin(excluirId) {
  const r = await uno('SELECT COUNT(*) AS n FROM usuario WHERE es_admin = 1 AND activo = 1 AND id <> ?', [excluirId]);
  return r.n > 0;
}

router.post('/usuarios', async (req, res) => {
  const u = leer(req.body);
  const password = String(req.body.password || '');
  let error = null;
  if (!/^[a-z0-9._-]{3,50}$/.test(u.usuario)) error = 'El usuario debe tener de 3 a 50 caracteres: letras, números, punto o guion.';
  else if (!u.nombre) error = 'Escribe el nombre completo.';
  else if (password.length < 8) error = 'La contraseña debe tener al menos 8 caracteres.';
  else if (await uno('SELECT id FROM usuario WHERE usuario = ?', [u.usuario])) error = `Ya existe el usuario ${u.usuario}.`;
  if (error) return res.status(400).render('admin/usuario-form', { titulo: 'Nuevo usuario', u, error });
  const r = await q(
    `INSERT INTO usuario (usuario, nombre, password_hash, rol, es_admin, activo, cedula, especialidad, cedula_especialidad, universidad)
     VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?)`,
    [u.usuario, u.nombre, await bcrypt.hash(password, 10), u.rol, u.es_admin, u.cedula, u.especialidad, u.cedula_especialidad, u.universidad]);
  await bitacora(req, 'CREAR', 'usuario', r.insertId, null, u.usuario);
  req.flash('ok', `Usuario ${u.usuario} creado.`);
  res.redirect('/admin/usuarios');
});

router.get('/usuarios/:id', async (req, res) => {
  const u = await uno('SELECT * FROM usuario WHERE id = ?', [req.params.id]);
  if (!u) return res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'Ese usuario no existe.' });
  res.render('admin/usuario-form', { titulo: 'Editar usuario', u, error: null });
});

router.post('/usuarios/:id', async (req, res) => {
  const actual = await uno('SELECT * FROM usuario WHERE id = ?', [req.params.id]);
  if (!actual) return res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'Ese usuario no existe.' });
  const u = { ...leer(req.body), id: actual.id, usuario: actual.usuario };
  const password = String(req.body.password || '');
  let error = null;
  if (!u.nombre) error = 'Escribe el nombre completo.';
  else if (password && password.length < 8) error = 'La nueva contraseña debe tener al menos 8 caracteres.';
  else if ((!u.es_admin || !u.activo) && actual.es_admin && actual.activo && !(await quedaAdmin(actual.id))) {
    error = 'Debe quedar al menos un administrador activo.';
  }
  if (error) return res.status(400).render('admin/usuario-form', { titulo: 'Editar usuario', u, error });
  await q(`UPDATE usuario SET nombre = ?, rol = ?, es_admin = ?, activo = ?, cedula = ?, especialidad = ?, cedula_especialidad = ?, universidad = ?
            WHERE id = ?`,
  [u.nombre, u.rol, u.es_admin, u.activo, u.cedula, u.especialidad, u.cedula_especialidad, u.universidad, actual.id]);
  if (password) await q('UPDATE usuario SET password_hash = ? WHERE id = ?', [await bcrypt.hash(password, 10), actual.id]);
  await bitacora(req, 'EDITAR', 'usuario', actual.id, null, password ? `${actual.usuario} (contraseña restablecida)` : actual.usuario);
  req.flash('ok', `Usuario ${actual.usuario} actualizado.`);
  res.redirect('/admin/usuarios');
});

/* ----------------------------- Consultorio ----------------------------- */

router.get('/consultorio', async (req, res) => {
  res.render('admin/consultorio', { titulo: 'Datos del consultorio', c: await uno('SELECT * FROM consultorio WHERE id = 1') });
});

router.post('/consultorio', async (req, res) => {
  const b = req.body;
  const nombre = texto(b.nombre, 150);
  if (!nombre) {
    req.flash('error', 'El nombre del consultorio es obligatorio.');
    return res.redirect('/admin/consultorio');
  }
  await q('UPDATE consultorio SET nombre = ?, direccion = ?, ciudad = ?, telefono = ?, email = ?, horario = ?, leyenda_receta = ? WHERE id = 1',
    [nombre, texto(b.direccion, 250), texto(b.ciudad, 100), texto(b.telefono, 60), texto(b.email, 120), texto(b.horario, 150), texto(b.leyenda_receta, 300)]);
  await bitacora(req, 'EDITAR', 'consultorio', 1);
  req.flash('ok', 'Datos del consultorio guardados. Salen en el encabezado de recetas, órdenes y certificados.');
  res.redirect('/admin/consultorio');
});

/* ----------------------------- Bitácora ----------------------------- */

router.get('/bitacora', async (req, res) => {
  const desde = fechaISO(req.query.desde) || hoy(new Date(Date.now() - 7 * 86400000));
  const hasta = fechaISO(req.query.hasta) || hoy();
  const usuarioId = Number(req.query.usuario) || null;
  const pacienteId = Number(req.query.paciente) || null;
  const params = [desde, hasta];
  let filtro = 'b.fecha >= ? AND b.fecha < ? + INTERVAL 1 DAY';
  if (usuarioId) { filtro += ' AND b.usuario_id = ?'; params.push(usuarioId); }
  if (pacienteId) { filtro += ' AND b.paciente_id = ?'; params.push(pacienteId); }
  const registros = await q(
    `SELECT b.*, u.usuario, u.nombre AS usuario_nombre, p.nombre, p.apellido_paterno, p.apellido_materno, p.expediente
       FROM bitacora b LEFT JOIN usuario u ON u.id = b.usuario_id LEFT JOIN paciente p ON p.id = b.paciente_id
      WHERE ${filtro} ORDER BY b.fecha DESC, b.id DESC LIMIT 1000`, params);
  const usuarios = await q('SELECT id, usuario, nombre FROM usuario ORDER BY nombre');
  const paciente = pacienteId ? await uno('SELECT * FROM paciente WHERE id = ?', [pacienteId]) : null;
  res.render('admin/bitacora', { titulo: 'Bitácora', registros, usuarios, desde, hasta, usuarioId, paciente });
});

module.exports = router;
