/** Recetas, órdenes de estudio y certificados médicos: los emite un médico y cualquiera puede reimprimirlos. */
const express = require('express');
const { q, uno, tx, siguienteFolio } = require('../db');
const { requiereMedico, prohibido, bitacora } = require('../seguridad');
const { texto, fechaISO, lista, hoy, edad, nombreCompleto, fechaLarga, aFecha } = require('../util');

const router = express.Router();

/** Catálogo de estudios frecuentes; en el formulario salen como casillas y se puede escribir cualquier otro. */
const ESTUDIOS = {
  LABORATORIO: ['Biometría hemática completa', 'Química sanguínea de 6 elementos', 'Química sanguínea de 24 elementos',
    'Examen general de orina', 'Perfil de lípidos', 'Hemoglobina glucosilada (HbA1c)', 'Glucosa en ayuno',
    'Pruebas de función hepática', 'Perfil tiroideo (TSH, T3, T4)', 'Electrolitos séricos', 'Tiempos de coagulación (TP, TTP, INR)',
    'Grupo sanguíneo y factor Rh', 'Proteína C reactiva', 'Ácido úrico', 'Coproparasitoscópico en serie de 3',
    'Urocultivo', 'Antígeno prostático específico', 'Prueba de embarazo (hCG)', 'VDRL', 'VIH (prueba rápida)'],
  GABINETE: ['Radiografía de tórax PA', 'Ultrasonido abdominal', 'Ultrasonido pélvico', 'Ultrasonido obstétrico',
    'Electrocardiograma de 12 derivaciones', 'Radiografía de columna lumbar', 'Mastografía', 'Densitometría ósea',
    'Tomografía de cráneo simple', 'Espirometría'],
  OTRO: [],
};

const TIPOS_ORDEN = { LABORATORIO: 'Laboratorio clínico', GABINETE: 'Imagen y gabinete', OTRO: 'Otros estudios' };
const TIPOS_CERTIFICADO = {
  SALUD: 'Certificado de buena salud',
  INCAPACIDAD: 'Certificado de incapacidad / reposo',
  ASISTENCIA: 'Constancia de asistencia a consulta',
};

async function cargarPaciente(req, res) {
  const p = await uno('SELECT * FROM paciente WHERE id = ?', [req.params.id]);
  if (!p) res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'Ese paciente no existe.' });
  return p;
}

/** Consulta del mismo paciente (para ligar el documento y proponer el diagnóstico), o null. */
async function consultaDe(pacienteId, consultaId) {
  if (!consultaId) return null;
  return uno('SELECT * FROM consulta WHERE id = ? AND paciente_id = ?', [consultaId, pacienteId]);
}

async function datosImpresion(medicoId) {
  const [consultorio, medico] = await Promise.all([
    uno('SELECT * FROM consultorio WHERE id = 1'),
    uno('SELECT nombre, cedula, especialidad, cedula_especialidad, universidad FROM usuario WHERE id = ?', [medicoId]),
  ]);
  return { consultorio, medico };
}

const noEncontrado = (res, que) => res.status(404).render('error', { titulo: 'No encontrado', mensaje: `${que} no existe.` });

/* ----------------------------- Recetas ----------------------------- */

router.get('/pacientes/:id/recetas/nueva', requiereMedico, async (req, res) => {
  const p = await cargarPaciente(req, res);
  if (!p) return;
  const consulta = await consultaDe(p.id, req.query.consulta);
  let r = { fecha: hoy(), diagnostico: consulta ? consulta.diagnostico.split('\n')[0].slice(0, 300) : null, consulta_id: consulta ? consulta.id : null };
  let medicamentos = [];
  // «Repetir receta»: copia los medicamentos e indicaciones de una anterior del mismo paciente
  if (req.query.desde) {
    const previa = await uno('SELECT * FROM receta WHERE id = ? AND paciente_id = ?', [req.query.desde, p.id]);
    if (previa) {
      r = { ...r, diagnostico: r.diagnostico || previa.diagnostico, indicaciones: previa.indicaciones };
      medicamentos = await q('SELECT * FROM receta_medicamento WHERE receta_id = ? ORDER BY orden', [previa.id]);
    }
  }
  res.render('recetas/form', { titulo: 'Nueva receta', p, r, medicamentos, error: null });
});

router.post('/pacientes/:id/recetas', requiereMedico, async (req, res) => {
  const p = await cargarPaciente(req, res);
  if (!p) return;
  const b = req.body;
  const consulta = await consultaDe(p.id, b.consulta_id);
  const r = {
    fecha: fechaISO(b.fecha) || hoy(),
    diagnostico: texto(b.diagnostico, 300),
    indicaciones: texto(b.indicaciones, 3000),
    consulta_id: consulta ? consulta.id : null,
  };
  const campos = ['medicamento', 'presentacion', 'dosis', 'via', 'frecuencia', 'duracion', 'indicaciones_med'];
  const columnas = campos.map((c) => lista(b[c]));
  const medicamentos = columnas[0].map((_, i) => {
    const m = {};
    campos.forEach((c, j) => { m[c === 'indicaciones_med' ? 'indicaciones' : c] = texto(columnas[j][i], c === 'medicamento' ? 200 : 150); });
    return m;
  }).filter((m) => m.medicamento);

  let error = null;
  if (!medicamentos.length) error = 'Agrega al menos un medicamento.';
  else if (medicamentos.some((m) => !m.dosis && !m.frecuencia && !m.indicaciones)) error = 'Cada medicamento necesita su dosis, frecuencia o indicación.';
  else if (!req.usuario.cedula) error = 'Antes de recetar, captura tu cédula profesional en «Mi cuenta».';
  if (error) return res.status(400).render('recetas/form', { titulo: 'Nueva receta', p, r, medicamentos, error });

  const id = await tx(async (con) => {
    const folio = await siguienteFolio(con, 'RECETA', 'R', aFecha(r.fecha).getFullYear());
    const [ins] = await con.query(
      'INSERT INTO receta (folio, paciente_id, medico_id, consulta_id, fecha, diagnostico, indicaciones) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [folio, p.id, req.usuario.id, r.consulta_id, r.fecha, r.diagnostico, r.indicaciones]);
    let orden = 1;
    for (const m of medicamentos) {
      await con.query(
        `INSERT INTO receta_medicamento (receta_id, orden, medicamento, presentacion, dosis, via, frecuencia, duracion, indicaciones)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [ins.insertId, orden++, m.medicamento, m.presentacion, m.dosis, m.via, m.frecuencia, m.duracion, m.indicaciones]);
    }
    return ins.insertId;
  });
  await bitacora(req, 'CREAR', 'receta', id, p.id);
  res.redirect(`/recetas/${id}`);
});

router.get('/recetas/:id', async (req, res) => {
  const r = await uno('SELECT * FROM receta WHERE id = ?', [req.params.id]);
  if (!r) return noEncontrado(res, 'Esa receta');
  const [p, medicamentos, consulta, impresion, proximaCita] = await Promise.all([
    uno('SELECT * FROM paciente WHERE id = ?', [r.paciente_id]),
    q('SELECT * FROM receta_medicamento WHERE receta_id = ? ORDER BY orden', [r.id]),
    r.consulta_id ? uno('SELECT * FROM consulta WHERE id = ?', [r.consulta_id]) : null,
    datosImpresion(r.medico_id),
    uno(`SELECT inicio FROM cita WHERE paciente_id = ? AND estado IN ('PROGRAMADA','CONFIRMADA')
           AND DATE(inicio) > ? AND inicio >= NOW() ORDER BY inicio LIMIT 1`, [r.paciente_id, r.fecha]),
  ]);
  res.render('recetas/imprimir', { titulo: `Receta ${r.folio}`, r, p, medicamentos, consulta, proximaCita, ...impresion });
});

/* ------------------------- Órdenes de estudio ------------------------- */

router.get('/pacientes/:id/ordenes/nueva', requiereMedico, async (req, res) => {
  const p = await cargarPaciente(req, res);
  if (!p) return;
  const consulta = await consultaDe(p.id, req.query.consulta);
  const tipo = TIPOS_ORDEN[req.query.tipo] ? req.query.tipo : 'LABORATORIO';
  const o = {
    tipo, fecha: hoy(), consulta_id: consulta ? consulta.id : null,
    diagnostico: consulta ? consulta.diagnostico.split('\n')[0].slice(0, 300) : null,
    indicaciones: tipo === 'LABORATORIO' ? 'Presentarse en ayuno de 8 horas.' : null,
  };
  res.render('ordenes/form', { titulo: 'Nueva orden de estudios', p, o, seleccion: [], otros: '', ESTUDIOS, TIPOS_ORDEN, error: null });
});

/** Lee el formulario de la orden. Devuelve la orden, los estudios y el error de validación (o null). */
function leerOrden(b) {
  const o = {
    tipo: TIPOS_ORDEN[b.tipo] ? b.tipo : 'OTRO',
    fecha: fechaISO(b.fecha) || hoy(),
    diagnostico: texto(b.diagnostico, 300),
    indicaciones: texto(b.indicaciones, 2000),
  };
  const seleccion = lista(b.estudio).map((e) => texto(e, 200)).filter(Boolean);
  const otros = texto(b.otros, 3000) || '';
  const estudios = [...seleccion, ...otros.split('\n').map((l) => l.trim()).filter(Boolean)];
  let error = null;
  if (!estudios.length) error = 'Marca o escribe al menos un estudio.';
  else if (!o.diagnostico) error = 'Escribe el diagnóstico presuntivo o motivo del estudio.';
  return { o, seleccion, otros, estudios, error };
}

/** Separa los estudios guardados en los del catálogo del tipo (casillas) y el resto (texto libre). */
function repartirEstudios(tipo, estudios) {
  const lista = String(estudios || '').split('\n').filter(Boolean);
  const seleccion = lista.filter((e) => ESTUDIOS[tipo].includes(e));
  return { seleccion, otros: lista.filter((e) => !seleccion.includes(e)).join('\n') };
}

/** Solo quien emitió la orden o un administrador puede modificarla o eliminarla. */
async function ordenEditable(req, res) {
  const o = await uno('SELECT * FROM orden_estudio WHERE id = ?', [req.params.id]);
  if (!o) { noEncontrado(res, 'Esa orden'); return null; }
  if (o.medico_id !== req.usuario.id && !req.usuario.esAdmin) {
    prohibido(res, 'Solo el médico que emitió la orden o un administrador puede modificarla o eliminarla.');
    return null;
  }
  return o;
}

router.post('/pacientes/:id/ordenes', requiereMedico, async (req, res) => {
  const p = await cargarPaciente(req, res);
  if (!p) return;
  const consulta = await consultaDe(p.id, req.body.consulta_id);
  const { o, seleccion, otros, estudios, error } = leerOrden(req.body);
  o.consulta_id = consulta ? consulta.id : null;
  if (error) return res.status(400).render('ordenes/form', { titulo: 'Nueva orden de estudios', p, o, seleccion, otros, ESTUDIOS, TIPOS_ORDEN, error });

  const id = await tx(async (con) => {
    const folio = await siguienteFolio(con, 'ORDEN', 'OE', aFecha(o.fecha).getFullYear());
    const [ins] = await con.query(
      `INSERT INTO orden_estudio (folio, paciente_id, medico_id, consulta_id, fecha, tipo, estudios, diagnostico, indicaciones)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [folio, p.id, req.usuario.id, o.consulta_id, o.fecha, o.tipo, estudios.join('\n'), o.diagnostico, o.indicaciones]);
    return ins.insertId;
  });
  await bitacora(req, 'CREAR', 'orden_estudio', id, p.id);
  res.redirect(`/ordenes/${id}`);
});

router.get('/ordenes/:id', async (req, res) => {
  const o = await uno('SELECT * FROM orden_estudio WHERE id = ?', [req.params.id]);
  if (!o) return noEncontrado(res, 'Esa orden');
  const [p, impresion] = await Promise.all([uno('SELECT * FROM paciente WHERE id = ?', [o.paciente_id]), datosImpresion(o.medico_id)]);
  res.render('ordenes/imprimir', { titulo: `Orden ${o.folio}`, o, p, TIPOS_ORDEN, ...impresion });
});

router.get('/ordenes/:id/editar', async (req, res) => {
  const actual = await ordenEditable(req, res);
  if (!actual) return;
  const p = await uno('SELECT * FROM paciente WHERE id = ?', [actual.paciente_id]);
  const tipo = TIPOS_ORDEN[req.query.tipo] ? req.query.tipo : actual.tipo;
  const { seleccion, otros } = repartirEstudios(tipo, actual.estudios);
  res.render('ordenes/form', { titulo: `Modificar orden ${actual.folio}`, p, o: { ...actual, tipo }, seleccion, otros, ESTUDIOS, TIPOS_ORDEN, error: null });
});

router.post('/ordenes/:id', async (req, res) => {
  const actual = await ordenEditable(req, res);
  if (!actual) return;
  const { o, seleccion, otros, estudios, error } = leerOrden(req.body);
  if (error) {
    const p = await uno('SELECT * FROM paciente WHERE id = ?', [actual.paciente_id]);
    return res.status(400).render('ordenes/form', { titulo: `Modificar orden ${actual.folio}`, p, o: { ...actual, ...o }, seleccion, otros, ESTUDIOS, TIPOS_ORDEN, error });
  }
  await q('UPDATE orden_estudio SET fecha = ?, tipo = ?, estudios = ?, diagnostico = ?, indicaciones = ? WHERE id = ?',
    [o.fecha, o.tipo, estudios.join('\n'), o.diagnostico, o.indicaciones, actual.id]);
  await bitacora(req, 'EDITAR', 'orden_estudio', actual.id, actual.paciente_id, `${actual.folio} · antes: ${actual.estudios.split('\n').join(', ')}`);
  req.flash('ok', `Orden ${actual.folio} modificada.`);
  res.redirect(`/ordenes/${actual.id}`);
});

router.post('/ordenes/:id/eliminar', async (req, res) => {
  const o = await ordenEditable(req, res);
  if (!o) return;
  await q('DELETE FROM orden_estudio WHERE id = ?', [o.id]);
  await bitacora(req, 'ELIMINAR', 'orden_estudio', o.id, o.paciente_id, `${o.folio} · ${o.estudios.split('\n').join(', ')}`);
  req.flash('ok', `Orden ${o.folio} eliminada.`);
  res.redirect(`/pacientes/${o.paciente_id}?tab=ordenes`);
});

/* ----------------------------- Certificados ----------------------------- */

/** Redacta el certificado con los datos capturados. Se guarda ya redactado: lo impreso no cambia después. */
function redactar(c, p, medico) {
  const fem = p.sexo === 'F';
  const nombre = nombreCompleto(p).toUpperCase();
  const anios = edad(p.fecha_nacimiento, aFecha(c.fecha));
  const deEdad = anios ? `, de ${anios} de edad` : '';
  const cedula = medico.cedula ? `, con cédula profesional ${medico.cedula}` : '';
  const intro = `Quien suscribe, médico legalmente autorizado para ejercer la profesión${cedula}`;
  let cuerpo;
  if (c.tipo === 'SALUD') {
    cuerpo = `${intro}, CERTIFICA que habiendo practicado examen médico a ${nombre}${deEdad}, ${fem ? 'la' : 'lo'} encontró CLÍNICAMENTE ${fem ? 'SANA' : 'SANO'}, `
      + 'sin datos de enfermedad infectocontagiosa ni padecimientos que le impidan realizar sus actividades cotidianas'
      + (c.proposito ? `, ${c.proposito}` : '') + '.';
    if (p.tipo_sangre) cuerpo += ` Grupo sanguíneo y factor Rh: ${p.tipo_sangre}.`;
  } else if (c.tipo === 'INCAPACIDAD') {
    cuerpo = `${intro}, CERTIFICA que ${nombre}${deEdad}, fue ${fem ? 'atendida' : 'atendido'} en este consultorio el día ${fechaLarga(c.fecha)}`
      + (c.diagnostico ? ` por presentar ${c.diagnostico}` : '')
      + `, por lo que requiere reposo por ${c.dias_reposo} ${c.dias_reposo === 1 ? 'día' : 'días'}, del ${fechaLarga(c.desde)} al ${fechaLarga(c.hasta)}, inclusive.`;
  } else {
    cuerpo = `${intro}, HACE CONSTAR que ${nombre}${deEdad}, acudió a consulta médica en este consultorio el día ${fechaLarga(c.fecha)}`
      + (c.horario ? `, en el horario de ${c.horario}` : '') + '.';
  }
  return cuerpo;
}

router.get('/pacientes/:id/certificados/nuevo', requiereMedico, async (req, res) => {
  const p = await cargarPaciente(req, res);
  if (!p) return;
  const consulta = await consultaDe(p.id, req.query.consulta);
  const tipo = TIPOS_CERTIFICADO[req.query.tipo] ? req.query.tipo : 'SALUD';
  const c = {
    tipo, fecha: hoy(), dirigido_a: 'A QUIEN CORRESPONDA', desde: hoy(), dias_reposo: 3,
    diagnostico: consulta ? consulta.diagnostico.split('\n')[0].slice(0, 300) : null,
  };
  res.render('certificados/form', { titulo: 'Nuevo certificado', p, c, TIPOS_CERTIFICADO, error: null });
});

router.post('/pacientes/:id/certificados', requiereMedico, async (req, res) => {
  const p = await cargarPaciente(req, res);
  if (!p) return;
  const b = req.body;
  const c = {
    tipo: TIPOS_CERTIFICADO[b.tipo] ? b.tipo : 'SALUD',
    fecha: fechaISO(b.fecha) || hoy(),
    dirigido_a: texto(b.dirigido_a, 200) || 'A QUIEN CORRESPONDA',
    diagnostico: texto(b.diagnostico, 300),
    proposito: texto(b.proposito, 200),
    horario: texto(b.horario, 60),
    observaciones: texto(b.observaciones, 2000),
    dias_reposo: null, desde: null, hasta: null,
  };
  let error = null;
  if (c.tipo === 'INCAPACIDAD') {
    c.dias_reposo = Math.trunc(Number(b.dias_reposo));
    c.desde = fechaISO(b.desde);
    if (!c.diagnostico) error = 'Escribe el diagnóstico que justifica el reposo.';
    else if (!(c.dias_reposo >= 1 && c.dias_reposo <= 365)) error = 'Los días de reposo deben ser de 1 a 365.';
    else if (!c.desde) error = 'Indica desde qué fecha inicia el reposo.';
    else {
      const fin = aFecha(c.desde);
      fin.setDate(fin.getDate() + c.dias_reposo - 1);
      c.hasta = hoy(fin);
    }
  }
  if (!error && !req.usuario.cedula) error = 'Antes de emitir certificados, captura tu cédula profesional en «Mi cuenta».';
  if (error) return res.status(400).render('certificados/form', { titulo: 'Nuevo certificado', p, c, TIPOS_CERTIFICADO, error });

  let redaccion = redactar(c, p, req.usuario);
  if (c.observaciones) redaccion += `\n\n${c.observaciones}`;
  const id = await tx(async (con) => {
    const folio = await siguienteFolio(con, 'CERTIFICADO', 'C', aFecha(c.fecha).getFullYear());
    const [ins] = await con.query(
      `INSERT INTO certificado (folio, paciente_id, medico_id, fecha, tipo, dirigido_a, diagnostico, dias_reposo, desde, hasta, texto)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [folio, p.id, req.usuario.id, c.fecha, c.tipo, c.dirigido_a, c.diagnostico, c.dias_reposo, c.desde, c.hasta, redaccion]);
    return ins.insertId;
  });
  await bitacora(req, 'CREAR', 'certificado', id, p.id, TIPOS_CERTIFICADO[c.tipo]);
  res.redirect(`/certificados/${id}`);
});

router.get('/certificados/:id', async (req, res) => {
  const c = await uno('SELECT * FROM certificado WHERE id = ?', [req.params.id]);
  if (!c) return noEncontrado(res, 'Ese certificado');
  const [p, impresion] = await Promise.all([uno('SELECT * FROM paciente WHERE id = ?', [c.paciente_id]), datosImpresion(c.medico_id)]);
  res.render('certificados/imprimir', { titulo: `Certificado ${c.folio}`, c, p, TIPOS_CERTIFICADO, ...impresion });
});

module.exports = router;
