const express = require('express');
const { q, uno } = require('../db');
const { requiereMedico, requiereAdmin, bitacora } = require('../seguridad');
const { texto, fechaISO, nombreCompleto } = require('../util');

const router = express.Router();

const CAMPOS = ['nombre', 'apellido_paterno', 'apellido_materno', 'fecha_nacimiento', 'sexo', 'curp', 'telefono', 'email',
  'domicilio', 'ocupacion', 'estado_civil', 'tipo_sangre', 'contacto_emergencia', 'telefono_emergencia', 'alergias', 'notas'];

const HISTORIA = [
  ['heredofamiliares', 'Antecedentes heredofamiliares', 'Diabetes, hipertensión, cáncer, cardiopatías… y en qué familiar'],
  ['personales_patologicos', 'Antecedentes personales patológicos', 'Enfermedades crónicas, hospitalizaciones, traumatismos, transfusiones'],
  ['personales_no_patologicos', 'Antecedentes personales no patológicos', 'Tabaquismo, alcohol, otras sustancias, actividad física, alimentación, vivienda'],
  ['gineco_obstetricos', 'Antecedentes gineco-obstétricos', 'Menarca, ritmo, FUM, gestas, partos, cesáreas, abortos, método anticonceptivo'],
  ['quirurgicos', 'Antecedentes quirúrgicos', 'Cirugías y fecha aproximada'],
  ['medicamentos_actuales', 'Medicamentos que toma actualmente', 'Nombre, dosis y desde cuándo'],
  ['vacunas', 'Inmunizaciones', 'Esquema y vacunas recientes'],
];

function leerPaciente(body) {
  const p = {};
  for (const c of CAMPOS) p[c] = texto(body[c], c === 'notas' ? 5000 : 250);
  p.fecha_nacimiento = fechaISO(body.fecha_nacimiento);
  p.sexo = ['F', 'M'].includes(body.sexo) ? body.sexo : null;
  if (p.curp) p.curp = p.curp.toUpperCase().replace(/\s+/g, '');
  for (const c of ['nombre', 'apellido_paterno', 'apellido_materno']) if (p[c]) p[c] = p[c].replace(/\s+/g, ' ');
  return p;
}

async function validarPaciente(p, id) {
  if (!p.nombre || !p.apellido_paterno) return 'El nombre y el primer apellido son obligatorios.';
  if (p.curp && !/^[A-Z][AEIOUX][A-Z]{2}\d{6}[HM][A-Z]{5}[A-Z0-9]\d$/.test(p.curp)) return 'La CURP no tiene un formato válido (18 caracteres).';
  if (p.fecha_nacimiento && p.fecha_nacimiento > new Date().toISOString().slice(0, 10)) return 'La fecha de nacimiento no puede ser futura.';
  if (p.curp) {
    const otro = await uno('SELECT id, expediente FROM paciente WHERE curp = ? AND id <> ?', [p.curp, id || 0]);
    if (otro) return `Ya existe un paciente con esa CURP (expediente ${otro.expediente}).`;
  }
  return null;
}

async function paciente(id) {
  return uno('SELECT * FROM paciente WHERE id = ?', [id]);
}

router.get('/pacientes', async (req, res) => {
  const busqueda = texto(req.query.q, 100);
  const inactivos = req.query.inactivos === '1';
  const params = [];
  let filtro = inactivos ? '1 = 1' : 'p.activo = 1';
  if (busqueda) {
    // Cada palabra debe aparecer en el nombre, o la búsqueda coincide con expediente, CURP o teléfono
    const palabras = busqueda.split(/\s+/).slice(0, 5);
    const porNombre = palabras.map(() => "CONCAT_WS(' ', p.nombre, p.apellido_paterno, p.apellido_materno) LIKE ?").join(' AND ');
    filtro += ` AND ((${porNombre}) OR p.expediente = ? OR p.curp = ? OR REPLACE(p.telefono, ' ', '') LIKE ?)`;
    params.push(...palabras.map((w) => `%${w}%`), busqueda.padStart(6, '0'), busqueda.toUpperCase(), `%${busqueda.replace(/\s+/g, '')}%`);
  }
  const pacientes = await q(
    `SELECT p.*, (SELECT MAX(fecha) FROM consulta WHERE paciente_id = p.id) AS ultima_consulta
       FROM paciente p WHERE ${filtro}
      ORDER BY p.apellido_paterno, p.apellido_materno, p.nombre LIMIT 200`, params);
  if (busqueda && pacientes.length === 1 && req.query.ir === '1') return res.redirect(`/pacientes/${pacientes[0].id}`);
  res.render('pacientes/lista', { titulo: 'Pacientes', pacientes, busqueda, inactivos });
});

router.get('/pacientes/nuevo', (req, res) => {
  res.render('pacientes/form', { titulo: 'Nuevo paciente', p: { nombre: texto(req.query.nombre, 80) }, error: null });
});

router.post('/pacientes', async (req, res) => {
  const p = leerPaciente(req.body);
  const error = await validarPaciente(p);
  if (error) return res.status(400).render('pacientes/form', { titulo: 'Nuevo paciente', p, error });
  const r = await q(`INSERT INTO paciente (${CAMPOS.join(', ')}, creado_por) VALUES (${CAMPOS.map(() => '?').join(', ')}, ?)`,
    [...CAMPOS.map((c) => p[c]), req.usuario.id]);
  await q("UPDATE paciente SET expediente = LPAD(id, 6, '0') WHERE id = ?", [r.insertId]);
  await bitacora(req, 'CREAR', 'paciente', r.insertId, r.insertId, nombreCompleto(p));
  req.flash('ok', `Expediente de ${nombreCompleto(p)} creado.`);
  res.redirect(`/pacientes/${r.insertId}`);
});

router.get('/pacientes/:id', async (req, res) => {
  const p = await paciente(req.params.id);
  if (!p) return res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'Ese paciente no existe.' });
  const id = p.id;
  const [historia, consultas, recetas, ordenes, certificados, archivos, citas] = await Promise.all([
    uno('SELECT h.*, u.nombre AS actualizado_por_nombre FROM historia_clinica h LEFT JOIN usuario u ON u.id = h.actualizado_por WHERE paciente_id = ?', [id]),
    q('SELECT c.*, u.nombre AS medico FROM consulta c JOIN usuario u ON u.id = c.medico_id WHERE paciente_id = ? ORDER BY fecha DESC', [id]),
    q(`SELECT r.*, u.nombre AS medico,
              (SELECT GROUP_CONCAT(medicamento ORDER BY orden SEPARATOR ' · ') FROM receta_medicamento WHERE receta_id = r.id) AS medicamentos
         FROM receta r JOIN usuario u ON u.id = r.medico_id WHERE paciente_id = ? ORDER BY fecha DESC, id DESC`, [id]),
    q('SELECT o.*, u.nombre AS medico FROM orden_estudio o JOIN usuario u ON u.id = o.medico_id WHERE paciente_id = ? ORDER BY fecha DESC, id DESC', [id]),
    q('SELECT c.*, u.nombre AS medico FROM certificado c JOIN usuario u ON u.id = c.medico_id WHERE paciente_id = ? ORDER BY fecha DESC, id DESC', [id]),
    q('SELECT a.*, u.nombre AS subido_por_nombre FROM archivo a LEFT JOIN usuario u ON u.id = a.subido_por WHERE paciente_id = ? ORDER BY subido_en DESC', [id]),
    q(`SELECT c.*, u.nombre AS medico FROM cita c JOIN usuario u ON u.id = c.medico_id
        WHERE paciente_id = ? ORDER BY inicio DESC LIMIT 30`, [id]),
  ]);
  const tab = ['resumen', 'historia', 'consultas', 'recetas', 'ordenes', 'certificados', 'archivos', 'citas'].includes(req.query.tab)
    ? req.query.tab : 'resumen';
  await bitacora(req, 'VER', 'expediente', id, id);
  res.render('pacientes/expediente', {
    titulo: nombreCompleto(p), p, historia, consultas, recetas, ordenes, certificados, archivos, citas, tab, HISTORIA,
    CATEGORIAS: require('./archivos').CATEGORIAS,
  });
});

router.get('/pacientes/:id/editar', async (req, res) => {
  const p = await paciente(req.params.id);
  if (!p) return res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'Ese paciente no existe.' });
  res.render('pacientes/form', { titulo: 'Editar paciente', p, error: null });
});

router.post('/pacientes/:id', async (req, res) => {
  const actual = await paciente(req.params.id);
  if (!actual) return res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'Ese paciente no existe.' });
  const p = leerPaciente(req.body);
  const error = await validarPaciente(p, actual.id);
  if (error) return res.status(400).render('pacientes/form', { titulo: 'Editar paciente', p: { ...p, id: actual.id, expediente: actual.expediente }, error });
  await q(`UPDATE paciente SET ${CAMPOS.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`, [...CAMPOS.map((c) => p[c]), actual.id]);
  await bitacora(req, 'EDITAR', 'paciente', actual.id, actual.id);
  req.flash('ok', 'Datos del paciente actualizados.');
  res.redirect(`/pacientes/${actual.id}`);
});

/** Baja lógica: el expediente se conserva (NOM-004 pide guardarlo al menos 5 años) pero sale de las búsquedas. */
router.post('/pacientes/:id/activo', requiereAdmin, async (req, res) => {
  const p = await paciente(req.params.id);
  if (!p) return res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'Ese paciente no existe.' });
  await q('UPDATE paciente SET activo = ? WHERE id = ?', [p.activo ? 0 : 1, p.id]);
  await bitacora(req, p.activo ? 'BAJA' : 'REACTIVAR', 'paciente', p.id, p.id);
  req.flash('ok', p.activo ? 'Expediente archivado: ya no aparece en la lista de pacientes activos.' : 'Expediente reactivado.');
  res.redirect(`/pacientes/${p.id}`);
});

router.get('/pacientes/:id/historia', requiereMedico, async (req, res) => {
  const p = await paciente(req.params.id);
  if (!p) return res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'Ese paciente no existe.' });
  const h = (await uno('SELECT * FROM historia_clinica WHERE paciente_id = ?', [p.id])) || {};
  res.render('pacientes/historia', { titulo: 'Historia clínica', p, h, HISTORIA });
});

router.post('/pacientes/:id/historia', requiereMedico, async (req, res) => {
  const p = await paciente(req.params.id);
  if (!p) return res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'Ese paciente no existe.' });
  const campos = HISTORIA.map(([c]) => c);
  const valores = campos.map((c) => texto(req.body[c], 5000));
  await q(
    `INSERT INTO historia_clinica (paciente_id, ${campos.join(', ')}, actualizado_por, actualizado_en)
     VALUES (?, ${campos.map(() => '?').join(', ')}, ?, NOW())
     ON DUPLICATE KEY UPDATE ${campos.map((c) => `${c} = VALUES(${c})`).join(', ')}, actualizado_por = VALUES(actualizado_por), actualizado_en = NOW()`,
    [p.id, ...valores, req.usuario.id]);
  // Las alergias viven en el paciente porque se muestran en todo el expediente y en las recetas
  await q('UPDATE paciente SET alergias = ? WHERE id = ?', [texto(req.body.alergias, 500), p.id]);
  await bitacora(req, 'EDITAR', 'historia_clinica', p.id, p.id);
  req.flash('ok', 'Historia clínica guardada.');
  res.redirect(`/pacientes/${p.id}?tab=historia`);
});

module.exports = router;
module.exports.leerPaciente = leerPaciente;
module.exports.validarPaciente = validarPaciente;
