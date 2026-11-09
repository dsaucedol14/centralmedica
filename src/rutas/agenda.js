const express = require('express');
const { q, uno } = require('../db');
const { bitacora } = require('../seguridad');
const { texto, hoy, aFecha, nombreCompleto, fechaISO, diaLargo } = require('../util');

const router = express.Router();

const ESTADOS = {
  PROGRAMADA: 'Programada', CONFIRMADA: 'Confirmada', ATENDIDA: 'Atendida', CANCELADA: 'Cancelada', NO_ASISTIO: 'No asistió',
};

function lunesDe(fechaTexto) {
  const d = aFecha(fechaTexto) || new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

async function medicos() {
  return q("SELECT id, nombre FROM usuario WHERE rol = 'MEDICO' AND activo = 1 ORDER BY nombre");
}

router.get('/agenda', async (req, res) => {
  const lunes = lunesDe(req.query.semana);
  const dias = Array.from({ length: 7 }, (_, i) => { const d = new Date(lunes); d.setDate(d.getDate() + i); return hoy(d); });
  const lista = await medicos();
  // Por omisión el médico ve su agenda; el asistente ve la de todos
  let medicoId = req.query.medico !== undefined ? Number(req.query.medico) || 0 : (req.usuario.esMedico ? req.usuario.id : 0);
  if (medicoId && !lista.some((m) => m.id === medicoId)) medicoId = 0;
  const citas = await q(
    `SELECT c.*, u.nombre AS medico, p.nombre, p.apellido_paterno, p.apellido_materno, p.expediente
       FROM cita c JOIN usuario u ON u.id = c.medico_id LEFT JOIN paciente p ON p.id = c.paciente_id
      WHERE c.inicio >= ? AND c.inicio < ? + INTERVAL 7 DAY ${medicoId ? 'AND c.medico_id = ?' : ''}
      ORDER BY c.inicio`, medicoId ? [dias[0], dias[0], medicoId] : [dias[0], dias[0]]);
  const porDia = Object.fromEntries(dias.map((d) => [d, []]));
  for (const c of citas) porDia[c.inicio.slice(0, 10)]?.push(c);
  const bloqueos = await q(
    `SELECT b.*, u.nombre AS medico FROM dia_bloqueado b JOIN usuario u ON u.id = b.medico_id
      WHERE b.fecha BETWEEN ? AND ? ${medicoId ? 'AND b.medico_id = ?' : ''} ORDER BY u.nombre`,
    medicoId ? [dias[0], dias[6], medicoId] : [dias[0], dias[6]]);
  const bloqueosPorDia = Object.fromEntries(dias.map((d) => [d, []]));
  for (const b of bloqueos) bloqueosPorDia[b.fecha]?.push(b);
  const anterior = new Date(lunes); anterior.setDate(anterior.getDate() - 7);
  const siguiente = new Date(lunes); siguiente.setDate(siguiente.getDate() + 7);
  res.render('agenda/semana', {
    titulo: 'Agenda', dias, porDia, bloqueosPorDia, medicos: lista, medicoId, ESTADOS,
    puedeBloquear: medicoId && puedeBloquear(req.usuario, medicoId),
    anterior: hoy(anterior), siguiente: hoy(siguiente), hoyTexto: hoy(),
  });
});

/** Búsqueda rápida de pacientes para el formulario de citas (JSON). */
router.get('/api/pacientes', async (req, res) => {
  const t = texto(req.query.q, 60);
  if (!t || t.length < 2) return res.json([]);
  const palabras = t.split(/\s+/).slice(0, 4);
  const filas = await q(
    `SELECT id, expediente, nombre, apellido_paterno, apellido_materno, telefono FROM paciente
      WHERE activo = 1 AND (${palabras.map(() => "CONCAT_WS(' ', nombre, apellido_paterno, apellido_materno) LIKE ?").join(' AND ')} OR expediente = ?)
      ORDER BY apellido_paterno, nombre LIMIT 10`, [...palabras.map((w) => `%${w}%`), t.padStart(6, '0')]);
  res.json(filas.map((p) => ({ id: p.id, expediente: p.expediente, nombre: nombreCompleto(p), telefono: p.telefono })));
});

function leer(body) {
  const fecha = texto(body.fecha);
  const horaTexto = texto(body.hora);
  const valida = fecha && /^\d{4}-\d{2}-\d{2}$/.test(fecha) && horaTexto && /^\d{2}:\d{2}$/.test(horaTexto);
  return {
    paciente_id: Number(body.paciente_id) || null,
    nombre_paciente: texto(body.nombre_paciente, 200),
    telefono: texto(body.telefono, 30),
    medico_id: Number(body.medico_id) || null,
    inicio: valida ? `${fecha} ${horaTexto}:00` : null,
    duracion_min: Math.min(240, Math.max(5, Number(body.duracion_min) || 30)),
    motivo: texto(body.motivo, 300),
    notas: texto(body.notas, 500),
  };
}

function puedeBloquear(usuario, medicoId) {
  return usuario.esAdmin || (usuario.esMedico && usuario.id === medicoId);
}

async function validar(c, actual) {
  const id = actual && actual.id;
  if (!c.inicio) return 'Indica la fecha y la hora.';
  const medico = c.medico_id && await uno("SELECT id, nombre FROM usuario WHERE id = ? AND rol = 'MEDICO' AND activo = 1", [c.medico_id]);
  if (!medico) return 'Elige el médico.';
  const fecha = c.inicio.slice(0, 10);
  // Una cita que ya estaba en ese día puede seguir editándose (notas, estado) aunque el día se haya bloqueado después
  const mismoDia = actual && actual.medico_id === c.medico_id && actual.inicio.slice(0, 10) === fecha;
  const bloqueo = !mismoDia && await uno('SELECT motivo FROM dia_bloqueado WHERE medico_id = ? AND fecha = ?', [c.medico_id, fecha]);
  if (bloqueo) return `${medico.nombre} no da consultas el ${diaLargo(fecha)}${bloqueo.motivo ? ` (${bloqueo.motivo})` : ''}. Elige otro día u otro médico.`;
  if (!c.paciente_id && !c.nombre_paciente) return 'Elige un paciente o escribe el nombre de la persona.';
  if (c.paciente_id && !(await uno('SELECT id FROM paciente WHERE id = ?', [c.paciente_id]))) return 'Ese paciente no existe.';
  const choque = await uno(
    `SELECT c.inicio, p.nombre, p.apellido_paterno, c.nombre_paciente FROM cita c LEFT JOIN paciente p ON p.id = c.paciente_id
      WHERE c.medico_id = ? AND c.estado NOT IN ('CANCELADA','NO_ASISTIO') AND c.id <> ?
        AND c.inicio < ? + INTERVAL ? MINUTE AND c.inicio + INTERVAL c.duracion_min MINUTE > ?`,
    [c.medico_id, id || 0, c.inicio, c.duracion_min, c.inicio]);
  if (choque) {
    const quien = choque.nombre ? `${choque.nombre} ${choque.apellido_paterno}` : choque.nombre_paciente;
    return `El médico ya tiene una cita a las ${choque.inicio.slice(11, 16)} (${quien}) que se empalma con este horario.`;
  }
  return null;
}

async function formulario(res, titulo, c, error) {
  const paciente = c.paciente_id ? await uno('SELECT * FROM paciente WHERE id = ?', [c.paciente_id]) : null;
  res.status(error ? 400 : 200).render('agenda/form', { titulo, c, paciente, medicos: await medicos(), ESTADOS, error });
}

router.get('/citas/nueva', async (req, res) => {
  const lista = await medicos();
  const medico = Number(req.query.medico) || (req.usuario.esMedico ? req.usuario.id : (lista[0] && lista[0].id));
  const f = req.query.fecha && /^\d{4}-\d{2}-\d{2}$/.test(req.query.fecha) ? req.query.fecha : hoy();
  const h = req.query.hora && /^\d{2}:\d{2}$/.test(req.query.hora) ? req.query.hora : '09:00';
  await formulario(res, 'Nueva cita', { paciente_id: Number(req.query.paciente) || null, medico_id: medico, inicio: `${f} ${h}:00`, duracion_min: 30 }, null);
});

router.post('/citas', async (req, res) => {
  const c = leer(req.body);
  const error = await validar(c);
  if (error) return formulario(res, 'Nueva cita', c, error);
  const r = await q(
    `INSERT INTO cita (paciente_id, nombre_paciente, telefono, medico_id, inicio, duracion_min, motivo, notas, creado_por)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [c.paciente_id, c.paciente_id ? null : c.nombre_paciente, c.telefono, c.medico_id, c.inicio, c.duracion_min, c.motivo, c.notas, req.usuario.id]);
  await bitacora(req, 'CREAR', 'cita', r.insertId, c.paciente_id, c.inicio);
  req.flash('ok', 'Cita agendada.');
  res.redirect(`/agenda?semana=${c.inicio.slice(0, 10)}&medico=${c.medico_id}`);
});

router.get('/citas/:id/editar', async (req, res) => {
  const c = await uno('SELECT * FROM cita WHERE id = ?', [req.params.id]);
  if (!c) return res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'Esa cita no existe.' });
  await formulario(res, 'Editar cita', c, null);
});

router.post('/citas/:id', async (req, res) => {
  const actual = await uno('SELECT * FROM cita WHERE id = ?', [req.params.id]);
  if (!actual) return res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'Esa cita no existe.' });
  const c = { ...leer(req.body), id: actual.id, estado: actual.estado };
  const error = await validar(c, actual);
  if (error) return formulario(res, 'Editar cita', c, error);
  await q(`UPDATE cita SET paciente_id = ?, nombre_paciente = ?, telefono = ?, medico_id = ?, inicio = ?, duracion_min = ?, motivo = ?, notas = ?
            WHERE id = ?`,
  [c.paciente_id, c.paciente_id ? null : c.nombre_paciente, c.telefono, c.medico_id, c.inicio, c.duracion_min, c.motivo, c.notas, actual.id]);
  await bitacora(req, 'EDITAR', 'cita', actual.id, c.paciente_id);
  req.flash('ok', 'Cita actualizada.');
  res.redirect(`/agenda?semana=${c.inicio.slice(0, 10)}&medico=${c.medico_id}`);
});

router.post('/citas/:id/estado', async (req, res) => {
  const c = await uno('SELECT * FROM cita WHERE id = ?', [req.params.id]);
  if (!c) return res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'Esa cita no existe.' });
  const estado = ESTADOS[req.body.estado] ? req.body.estado : c.estado;
  await q('UPDATE cita SET estado = ? WHERE id = ?', [estado, c.id]);
  await bitacora(req, 'ESTADO', 'cita', c.id, c.paciente_id, estado);
  const volver = req.body.volver && String(req.body.volver).startsWith('/') ? req.body.volver : `/agenda?semana=${c.inicio.slice(0, 10)}`;
  res.redirect(volver);
});

function volverA(body, fecha, medicoId) {
  return body.volver && /^\/agenda(\?|$)/.test(String(body.volver)) ? body.volver : `/agenda?semana=${fecha}&medico=${medicoId}`;
}

router.post('/agenda/bloqueos', async (req, res) => {
  const medicoId = Number(req.body.medico_id) || 0;
  const fecha = fechaISO(req.body.fecha);
  const motivo = texto(req.body.motivo, 200);
  const volver = volverA(req.body, fecha || hoy(), medicoId);
  if (!medicoId || !(await uno("SELECT id FROM usuario WHERE id = ? AND rol = 'MEDICO' AND activo = 1", [medicoId]))) {
    req.flash('error', 'Elige el médico.');
    return res.redirect(volver);
  }
  if (!puedeBloquear(req.usuario, medicoId)) {
    req.flash('error', 'Solo el propio médico o un administrador puede bloquear días de su agenda.');
    return res.redirect(volver);
  }
  if (!fecha || fecha < hoy()) {
    req.flash('error', 'Elige un día de hoy en adelante.');
    return res.redirect(volver);
  }
  await q(`INSERT INTO dia_bloqueado (medico_id, fecha, motivo, creado_por) VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE motivo = VALUES(motivo)`, [medicoId, fecha, motivo, req.usuario.id]);
  await bitacora(req, 'BLOQUEAR', 'agenda', medicoId, null, `${fecha}${motivo ? ' · ' + motivo : ''}`);
  const { n } = await uno(
    `SELECT COUNT(*) AS n FROM cita WHERE medico_id = ? AND DATE(inicio) = ? AND estado IN ('PROGRAMADA','CONFIRMADA')`, [medicoId, fecha]);
  req.flash(n ? 'error' : 'ok', n
    ? `Día bloqueado. Ojo: ya hay ${n} cita${n === 1 ? '' : 's'} agendada${n === 1 ? '' : 's'} ese día; reprográmala${n === 1 ? '' : 's'} o cancéla${n === 1 ? 'la' : 'las'}.`
    : `El ${diaLargo(fecha)} quedó bloqueado: no se podrán agendar citas.`);
  res.redirect(volver);
});

router.post('/agenda/bloqueos/:id/eliminar', async (req, res) => {
  const b = await uno('SELECT * FROM dia_bloqueado WHERE id = ?', [req.params.id]);
  if (!b) return res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'Ese bloqueo no existe.' });
  const volver = volverA(req.body, b.fecha, b.medico_id);
  if (!puedeBloquear(req.usuario, b.medico_id)) {
    req.flash('error', 'Solo el propio médico o un administrador puede desbloquear días de su agenda.');
    return res.redirect(volver);
  }
  await q('DELETE FROM dia_bloqueado WHERE id = ?', [b.id]);
  await bitacora(req, 'DESBLOQUEAR', 'agenda', b.medico_id, null, b.fecha);
  req.flash('ok', `El ${diaLargo(b.fecha)} volvió a quedar disponible.`);
  res.redirect(volver);
});

module.exports = router;
