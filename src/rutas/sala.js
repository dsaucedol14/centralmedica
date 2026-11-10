/** Sala de espera del lado clínico: avisos al médico de los pacientes que envía recepción. */
const express = require('express');
const { q, uno } = require('../db');
const { requiereMedico, bitacora, validarCsrf } = require('../seguridad');
const { nombreCompleto, edad, hora } = require('../util');

const router = express.Router();

const SELECCION = `SELECT t.id, t.paciente_id, t.medico_id, t.motivo, t.notas, t.estado, t.llegada, t.avisado_en, t.pasa_en,
       u.nombre AS medico, r.nombre AS enviado_por,
       p.expediente, p.nombre, p.apellido_paterno, p.apellido_materno, p.fecha_nacimiento, p.sexo, p.telefono, p.curp, p.alergias,
       (SELECT COUNT(*) FROM consulta c WHERE c.paciente_id = p.id) AS consultas_previas
  FROM turno t JOIN paciente p ON p.id = t.paciente_id JOIN usuario u ON u.id = t.medico_id LEFT JOIN usuario r ON r.id = t.creado_por`;

router.get('/sala-espera', async (req, res) => {
  const todos = req.query.todos === '1' || !req.usuario.esMedico;
  const turnos = await q(
    `${SELECCION} WHERE t.llegada >= CURDATE() AND t.estado IN ('EN_ESPERA','EN_CONSULTA') ${todos ? '' : 'AND t.medico_id = ?'}
      ORDER BY FIELD(t.estado, 'EN_CONSULTA', 'EN_ESPERA'), t.llegada`, todos ? [] : [req.usuario.id]);
  // Al abrir la sala, el médico ya vio a sus pacientes nuevos
  if (req.usuario.esMedico) {
    await q("UPDATE turno SET avisado_en = NOW() WHERE medico_id = ? AND estado = 'EN_ESPERA' AND avisado_en IS NULL", [req.usuario.id]);
  }
  res.render('sala/espera', { titulo: 'Sala de espera', turnos, todos });
});

/** Avisos pendientes del médico en sesión (los consulta cada pantalla del sistema cada pocos segundos). */
router.get('/api/sala/avisos', async (req, res) => {
  res.set('Cache-Control', 'no-store');
  if (!req.usuario.esMedico) return res.json({ enEspera: 0, nuevos: [] });
  const [nuevos, [conteo]] = await Promise.all([
    q(`${SELECCION} WHERE t.medico_id = ? AND t.estado = 'EN_ESPERA' AND t.avisado_en IS NULL AND t.llegada >= CURDATE() ORDER BY t.llegada`,
      [req.usuario.id]),
    q("SELECT COUNT(*) AS n FROM turno WHERE medico_id = ? AND estado = 'EN_ESPERA' AND llegada >= CURDATE()", [req.usuario.id]),
  ]);
  res.json({
    enEspera: conteo.n,
    nuevos: nuevos.map((t) => ({
      id: t.id,
      paciente_id: t.paciente_id,
      nombre: nombreCompleto(t),
      expediente: t.expediente,
      edad: edad(t.fecha_nacimiento) || null,
      sexo: t.sexo === 'F' ? 'Mujer' : t.sexo === 'M' ? 'Hombre' : null,
      telefono: t.telefono,
      alergias: t.alergias,
      motivo: t.motivo,
      notas: t.notas,
      llegada: hora(t.llegada),
      enviado_por: t.enviado_por,
      primera_vez: t.consultas_previas === 0,
    })),
  });
});

router.post('/api/sala/avisos/:id/enterado', validarCsrf, async (req, res) => {
  await q('UPDATE turno SET avisado_en = COALESCE(avisado_en, NOW()) WHERE id = ? AND medico_id = ?', [req.params.id, req.usuario.id]);
  res.json({ ok: true });
});

/** El médico pasa al paciente: queda «en consulta» y se abre la nota médica ligada al turno. */
router.post('/sala-espera/:id/pasar', requiereMedico, async (req, res) => {
  const t = await uno("SELECT * FROM turno WHERE id = ? AND estado IN ('EN_ESPERA','EN_CONSULTA')", [req.params.id]);
  if (!t) {
    req.flash('error', 'Ese paciente ya no está en la sala de espera.');
    return res.redirect('/sala-espera');
  }
  // Si otro médico lo pasa (p. ej. cubre al asignado), el turno se le reasigna
  await q(`UPDATE turno SET estado = 'EN_CONSULTA', medico_id = ?, pasa_en = COALESCE(pasa_en, NOW()), avisado_en = COALESCE(avisado_en, NOW())
            WHERE id = ?`, [req.usuario.id, t.id]);
  await bitacora(req, 'PASAR', 'turno', t.id, t.paciente_id);
  res.redirect(`/pacientes/${t.paciente_id}/consultas/nueva?turno=${t.id}`);
});

/** Regresa al paciente a la espera (si se abrió la consulta por error). */
router.post('/sala-espera/:id/regresar', requiereMedico, async (req, res) => {
  await q("UPDATE turno SET estado = 'EN_ESPERA', pasa_en = NULL WHERE id = ? AND estado = 'EN_CONSULTA'", [req.params.id]);
  res.redirect('/sala-espera');
});

module.exports = router;
