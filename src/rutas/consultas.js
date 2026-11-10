const express = require('express');
const { q, uno } = require('../db');
const { requiereMedico, prohibido, bitacora } = require('../seguridad');
const { texto, numero, ahoraLocal, imc } = require('../util');

const router = express.Router();

const CAMPOS = ['fecha', 'motivo', 'padecimiento_actual', 'peso', 'talla', 'ta_sistolica', 'ta_diastolica', 'fc', 'fr',
  'temperatura', 'spo2', 'glucosa', 'exploracion', 'diagnostico', 'cie10', 'plan', 'pronostico'];

/** Rangos fisiológicamente posibles: atrapan errores de dedo (talla en cm, peso en gramos). */
const RANGOS = {
  peso: [0.3, 400, 'El peso va en kg (0.3 a 400).'],
  talla: [0.2, 2.5, 'La talla va en metros (por ejemplo 1.65).'],
  ta_sistolica: [40, 300, 'La presión sistólica debe estar entre 40 y 300 mmHg.'],
  ta_diastolica: [20, 200, 'La presión diastólica debe estar entre 20 y 200 mmHg.'],
  fc: [20, 250, 'La frecuencia cardiaca debe estar entre 20 y 250 lpm.'],
  fr: [4, 80, 'La frecuencia respiratoria debe estar entre 4 y 80 rpm.'],
  temperatura: [30, 45, 'La temperatura debe estar entre 30 y 45 °C.'],
  spo2: [40, 100, 'La saturación debe estar entre 40 y 100 %.'],
  glucosa: [10, 1000, 'La glucosa debe estar entre 10 y 1000 mg/dL.'],
};

function leer(body) {
  const c = {};
  for (const k of ['motivo', 'pronostico']) c[k] = texto(body[k], 300);
  for (const k of ['padecimiento_actual', 'exploracion', 'diagnostico', 'plan']) c[k] = texto(body[k], 10000);
  c.cie10 = texto(body.cie10, 60);
  for (const k of Object.keys(RANGOS)) c[k] = numero(body[k]);
  // Talla escrita en centímetros: 165 → 1.65
  if (c.talla && c.talla > 3 && c.talla <= 250) c.talla = Math.round(c.talla) / 100;
  const f = texto(body.fecha);
  c.fecha = f && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(f) ? f.replace('T', ' ') + ':00' : null;
  return c;
}

function validar(c) {
  if (!c.fecha) return 'Indica la fecha y hora de la consulta.';
  if (!c.motivo) return 'Escribe el motivo de la consulta.';
  if (!c.diagnostico) return 'Escribe el diagnóstico (impresión diagnóstica).';
  for (const [k, [min, max, msg]] of Object.entries(RANGOS)) {
    if (c[k] !== null && (c[k] < min || c[k] > max)) return msg;
  }
  return null;
}

async function cargarPaciente(req, res) {
  const p = await uno('SELECT * FROM paciente WHERE id = ?', [req.params.id]);
  if (!p) res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'Ese paciente no existe.' });
  return p;
}

async function cargarConsulta(id) {
  return uno(`SELECT c.*, u.nombre AS medico, u.cedula, u.especialidad
                FROM consulta c JOIN usuario u ON u.id = c.medico_id WHERE c.id = ?`, [id]);
}

router.get('/pacientes/:id/consultas/nueva', requiereMedico, async (req, res) => {
  const p = await cargarPaciente(req, res);
  if (!p) return;
  const c = { fecha: ahoraLocal().replace('T', ' ') };
  const turno = req.query.turno ? await uno("SELECT * FROM turno WHERE id = ? AND paciente_id = ? AND estado IN ('EN_ESPERA','EN_CONSULTA')", [req.query.turno, p.id]) : null;
  const citaId = req.query.cita || (turno && turno.cita_id);
  const cita = citaId ? await uno('SELECT * FROM cita WHERE id = ? AND paciente_id = ?', [citaId, p.id]) : null;
  if (cita && cita.motivo) c.motivo = cita.motivo;
  if (turno && turno.motivo) c.motivo = turno.motivo;
  const anterior = await uno('SELECT talla FROM consulta WHERE paciente_id = ? AND talla IS NOT NULL ORDER BY fecha DESC LIMIT 1', [p.id]);
  if (anterior) c.talla = anterior.talla; // la talla de un adulto casi no cambia: se propone la última
  res.render('consultas/form', { titulo: 'Nueva consulta', p, c, citaId: cita ? cita.id : null, turnoId: turno ? turno.id : null, error: null });
});

router.post('/pacientes/:id/consultas', requiereMedico, async (req, res) => {
  const p = await cargarPaciente(req, res);
  if (!p) return;
  const c = leer(req.body);
  const error = validar(c);
  const citaId = Number(req.body.cita_id) || null;
  const turnoId = Number(req.body.turno_id) || null;
  if (error) return res.status(400).render('consultas/form', { titulo: 'Nueva consulta', p, c, citaId, turnoId, error });
  const r = await q(`INSERT INTO consulta (paciente_id, medico_id, ${CAMPOS.join(', ')}) VALUES (?, ?, ${CAMPOS.map(() => '?').join(', ')})`,
    [p.id, req.usuario.id, ...CAMPOS.map((k) => c[k])]);
  if (citaId) await q("UPDATE cita SET estado = 'ATENDIDA' WHERE id = ? AND paciente_id = ?", [citaId, p.id]);
  if (turnoId) {
    await q(`UPDATE turno SET estado = 'ATENDIDO', consulta_id = ?, atendido_en = NOW(), pasa_en = COALESCE(pasa_en, NOW())
              WHERE id = ? AND paciente_id = ? AND estado IN ('EN_ESPERA','EN_CONSULTA')`, [r.insertId, turnoId, p.id]);
  }
  await bitacora(req, 'CREAR', 'consulta', r.insertId, p.id, c.motivo);
  req.flash('ok', 'Consulta guardada. Desde aquí puedes emitir la receta, la orden de estudios o un certificado.');
  res.redirect(`/consultas/${r.insertId}`);
});

router.get('/consultas/:id', async (req, res) => {
  const c = await cargarConsulta(req.params.id);
  if (!c) return res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'Esa consulta no existe.' });
  const p = await uno('SELECT * FROM paciente WHERE id = ?', [c.paciente_id]);
  const [recetas, ordenes] = await Promise.all([
    q('SELECT id, folio FROM receta WHERE consulta_id = ?', [c.id]),
    q('SELECT id, folio, tipo FROM orden_estudio WHERE consulta_id = ?', [c.id]),
  ]);
  const consultorio = await uno('SELECT * FROM consultorio WHERE id = 1');
  res.render('consultas/ver', { titulo: 'Nota de consulta', c, p, recetas, ordenes, consultorio, imc: imc(c.peso, c.talla) });
});

router.get('/consultas/:id/editar', requiereMedico, async (req, res) => {
  const c = await cargarConsulta(req.params.id);
  if (!c) return res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'Esa consulta no existe.' });
  if (c.medico_id !== req.usuario.id) return prohibido(res, 'Solo el médico que hizo la consulta puede corregirla.');
  const p = await uno('SELECT * FROM paciente WHERE id = ?', [c.paciente_id]);
  res.render('consultas/form', { titulo: 'Editar consulta', p, c, citaId: null, turnoId: null, error: null });
});

router.post('/consultas/:id', requiereMedico, async (req, res) => {
  const actual = await cargarConsulta(req.params.id);
  if (!actual) return res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'Esa consulta no existe.' });
  if (actual.medico_id !== req.usuario.id) return prohibido(res, 'Solo el médico que hizo la consulta puede corregirla.');
  const c = leer(req.body);
  const error = validar(c);
  if (error) {
    const p = await uno('SELECT * FROM paciente WHERE id = ?', [actual.paciente_id]);
    return res.status(400).render('consultas/form', { titulo: 'Editar consulta', p, c: { ...c, id: actual.id }, citaId: null, turnoId: null, error });
  }
  await q(`UPDATE consulta SET ${CAMPOS.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`, [...CAMPOS.map((k) => c[k]), actual.id]);
  await bitacora(req, 'EDITAR', 'consulta', actual.id, actual.paciente_id);
  req.flash('ok', 'Consulta actualizada.');
  res.redirect(`/consultas/${actual.id}`);
});

module.exports = router;
