/**
 * Recepción: recibe al paciente, lo busca o registra con sus datos generales y lo envía a consulta con un médico.
 * Solo maneja datos generales; nunca muestra información clínica.
 */
const express = require('express');
const { q, uno } = require('../db');
const { bitacora } = require('../seguridad');
const { texto, nombreCompleto } = require('../util');
const { leerPaciente, validarPaciente } = require('./pacientes');

const router = express.Router();

// Lo que captura recepción; tipo de sangre y notas administrativas quedan para el expediente
const GENERALES = ['nombre', 'apellido_paterno', 'apellido_materno', 'fecha_nacimiento', 'sexo', 'curp', 'telefono', 'email',
  'domicilio', 'ocupacion', 'estado_civil', 'contacto_emergencia', 'telefono_emergencia', 'alergias'];
const COLUMNAS_PACIENTE = 'p.id, p.expediente, p.nombre, p.apellido_paterno, p.apellido_materno, p.fecha_nacimiento, p.sexo, p.curp, p.telefono, p.alergias';

async function medicosDeHoy() {
  return q(
    `SELECT u.id, u.nombre, u.especialidad,
            (SELECT motivo FROM dia_bloqueado b WHERE b.medico_id = u.id AND b.fecha = CURDATE()) AS bloqueo,
            (SELECT COUNT(*) FROM dia_bloqueado b WHERE b.medico_id = u.id AND b.fecha = CURDATE()) AS bloqueado,
            (SELECT COUNT(*) FROM turno t WHERE t.medico_id = u.id AND t.estado = 'EN_ESPERA' AND t.llegada >= CURDATE()) AS esperando
       FROM usuario u WHERE u.rol = 'MEDICO' AND u.activo = 1 ORDER BY u.nombre`);
}

async function salaDeHoy() {
  return q(
    `SELECT t.*, u.nombre AS medico, ${COLUMNAS_PACIENTE}, t.id AS id
       FROM turno t JOIN paciente p ON p.id = t.paciente_id JOIN usuario u ON u.id = t.medico_id
      WHERE t.llegada >= CURDATE() ORDER BY FIELD(t.estado, 'EN_ESPERA', 'EN_CONSULTA', 'ATENDIDO', 'CANCELADO'), t.llegada`);
}

router.get('/recepcion', async (req, res) => {
  const busqueda = texto(req.query.q, 100);
  let pacientes = null;
  if (busqueda) {
    const palabras = busqueda.split(/\s+/).slice(0, 5);
    pacientes = await q(
      `SELECT ${COLUMNAS_PACIENTE},
              (SELECT t.estado FROM turno t WHERE t.paciente_id = p.id AND t.llegada >= CURDATE() AND t.estado IN ('EN_ESPERA','EN_CONSULTA') LIMIT 1) AS en_sala
         FROM paciente p
        WHERE p.activo = 1 AND ((${palabras.map(() => "CONCAT_WS(' ', p.nombre, p.apellido_paterno, p.apellido_materno) LIKE ?").join(' AND ')})
              OR p.expediente = ? OR p.curp = ? OR REPLACE(p.telefono, ' ', '') LIKE ?)
        ORDER BY p.apellido_paterno, p.apellido_materno, p.nombre LIMIT 50`,
      [...palabras.map((w) => `%${w}%`), busqueda.padStart(6, '0'), busqueda.toUpperCase(), `%${busqueda.replace(/\s+/g, '')}%`]);
  }
  res.render('recepcion/inicio', { titulo: 'Recepción', busqueda, pacientes, sala: await salaDeHoy() });
});

/** Solo la sala de espera, para que la pantalla de recepción se actualice sola sin recargarse. */
router.get('/recepcion/sala', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.render('recepcion/_sala', { sala: await salaDeHoy() });
});

/* ----------------------------- Datos generales ----------------------------- */

function soloGenerales(body) {
  const p = leerPaciente(body);
  const g = {};
  for (const c of GENERALES) g[c] = p[c];
  return g;
}

router.get('/recepcion/pacientes/nuevo', (req, res) => {
  const nombre = texto(req.query.nombre, 80);
  res.render('recepcion/paciente', { titulo: 'Registrar paciente', p: { nombre }, error: null });
});

router.post('/recepcion/pacientes', async (req, res) => {
  const p = soloGenerales(req.body);
  const error = await validarPaciente(p);
  if (error) return res.status(400).render('recepcion/paciente', { titulo: 'Registrar paciente', p, error });
  const r = await q(`INSERT INTO paciente (${GENERALES.join(', ')}, creado_por) VALUES (${GENERALES.map(() => '?').join(', ')}, ?)`,
    [...GENERALES.map((c) => p[c]), req.usuario.id]);
  await q("UPDATE paciente SET expediente = LPAD(id, 6, '0') WHERE id = ?", [r.insertId]);
  await bitacora(req, 'CREAR', 'paciente', r.insertId, r.insertId, `${nombreCompleto(p)} (recepción)`);
  req.flash('ok', `Paciente registrado con el expediente ${String(r.insertId).padStart(6, '0')}. Ahora elige con qué médico pasa.`);
  res.redirect(`/recepcion/pacientes/${r.insertId}/enviar`);
});

async function pacienteActivo(id) {
  return uno('SELECT * FROM paciente WHERE id = ? AND activo = 1', [id]);
}

router.get('/recepcion/pacientes/:id/editar', async (req, res) => {
  const p = await pacienteActivo(req.params.id);
  if (!p) return res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'Ese paciente no existe.' });
  res.render('recepcion/paciente', { titulo: 'Actualizar datos', p, error: null });
});

router.post('/recepcion/pacientes/:id', async (req, res) => {
  const actual = await pacienteActivo(req.params.id);
  if (!actual) return res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'Ese paciente no existe.' });
  const p = soloGenerales(req.body);
  const error = await validarPaciente(p, actual.id);
  if (error) return res.status(400).render('recepcion/paciente', { titulo: 'Actualizar datos', p: { ...p, id: actual.id, expediente: actual.expediente }, error });
  await q(`UPDATE paciente SET ${GENERALES.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...GENERALES.map((c) => p[c]), actual.id]);
  await bitacora(req, 'EDITAR', 'paciente', actual.id, actual.id, 'datos generales (recepción)');
  req.flash('ok', 'Datos actualizados.');
  res.redirect(`/recepcion/pacientes/${actual.id}/enviar`);
});

/* ----------------------------- Enviar a consulta ----------------------------- */

async function formularioEnvio(res, p, t, error) {
  const [medicos, cita, enSala] = await Promise.all([
    medicosDeHoy(),
    uno(`SELECT c.id, c.medico_id, c.inicio, c.motivo FROM cita c
          WHERE c.paciente_id = ? AND DATE(c.inicio) = CURDATE() AND c.estado IN ('PROGRAMADA','CONFIRMADA') ORDER BY c.inicio LIMIT 1`, [p.id]),
    uno(`SELECT t.estado, u.nombre AS medico FROM turno t JOIN usuario u ON u.id = t.medico_id
          WHERE t.paciente_id = ? AND t.llegada >= CURDATE() AND t.estado IN ('EN_ESPERA','EN_CONSULTA') LIMIT 1`, [p.id]),
  ]);
  const envio = { medico_id: cita ? cita.medico_id : null, motivo: cita ? cita.motivo : null, ...t };
  res.status(error ? 400 : 200).render('recepcion/enviar', { titulo: 'Enviar a consulta', p, medicos, cita, enSala, t: envio, error });
}

router.get('/recepcion/pacientes/:id/enviar', async (req, res) => {
  const p = await pacienteActivo(req.params.id);
  if (!p) return res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'Ese paciente no existe.' });
  await formularioEnvio(res, p, {}, null);
});

router.post('/recepcion/pacientes/:id/enviar', async (req, res) => {
  const p = await pacienteActivo(req.params.id);
  if (!p) return res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'Ese paciente no existe.' });
  const t = { medico_id: Number(req.body.medico_id) || null, motivo: texto(req.body.motivo, 300), notas: texto(req.body.notas, 500) };
  const medico = t.medico_id && (await medicosDeHoy()).find((m) => m.id === t.medico_id);
  if (!medico) return formularioEnvio(res, p, t, 'Elige el médico con el que pasará el paciente.');
  if (medico.bloqueado) return formularioEnvio(res, p, t, `${medico.nombre} no da consultas hoy${medico.bloqueo ? ` (${medico.bloqueo})` : ''}. Elige otro médico.`);
  const yaEnSala = await uno("SELECT id FROM turno WHERE paciente_id = ? AND llegada >= CURDATE() AND estado IN ('EN_ESPERA','EN_CONSULTA')", [p.id]);
  if (yaEnSala) return formularioEnvio(res, p, t, 'Este paciente ya está en la sala de espera. Si cambió de médico, cancela primero el envío anterior.');
  const cita = await uno(`SELECT id FROM cita WHERE paciente_id = ? AND medico_id = ? AND DATE(inicio) = CURDATE()
                           AND estado IN ('PROGRAMADA','CONFIRMADA') ORDER BY inicio LIMIT 1`, [p.id, medico.id]);
  const r = await q('INSERT INTO turno (paciente_id, medico_id, cita_id, motivo, notas, creado_por) VALUES (?, ?, ?, ?, ?, ?)',
    [p.id, medico.id, cita ? cita.id : null, t.motivo, t.notas, req.usuario.id]);
  if (cita) await q("UPDATE cita SET estado = 'CONFIRMADA' WHERE id = ? AND estado = 'PROGRAMADA'", [cita.id]);
  await bitacora(req, 'ENVIAR', 'turno', r.insertId, p.id, `a ${medico.nombre}`);
  req.flash('ok', `${nombreCompleto(p)} fue enviado a consulta con ${medico.nombre}. Ya le llegó el aviso.`);
  res.redirect('/recepcion');
});

router.post('/recepcion/turnos/:id/cancelar', async (req, res) => {
  const t = await uno("SELECT * FROM turno WHERE id = ? AND estado = 'EN_ESPERA'", [req.params.id]);
  if (t) {
    await q("UPDATE turno SET estado = 'CANCELADO' WHERE id = ?", [t.id]);
    await bitacora(req, 'CANCELAR', 'turno', t.id, t.paciente_id);
    req.flash('ok', 'Envío cancelado: el paciente salió de la sala de espera.');
  } else {
    req.flash('error', 'Ese paciente ya no está en espera (puede que el médico ya lo haya pasado).');
  }
  res.redirect('/recepcion');
});

module.exports = router;
