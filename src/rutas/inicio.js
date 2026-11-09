const express = require('express');
const { q } = require('../db');
const { hoy } = require('../util');

const router = express.Router();

router.get('/', async (req, res) => {
  const fecha = hoy();
  const citas = await q(
    `SELECT c.*, u.nombre AS medico, p.nombre, p.apellido_paterno, p.apellido_materno, p.expediente
       FROM cita c JOIN usuario u ON u.id = c.medico_id LEFT JOIN paciente p ON p.id = c.paciente_id
      WHERE c.inicio >= ? AND c.inicio < ? + INTERVAL 1 DAY AND c.estado <> 'CANCELADA'
        ${req.usuario.esMedico ? 'ORDER BY (c.medico_id = ?) DESC, c.inicio' : 'ORDER BY c.inicio'}`,
    req.usuario.esMedico ? [fecha, fecha, req.usuario.id] : [fecha, fecha]);

  const recientes = await q(
    `SELECT p.id, p.expediente, p.nombre, p.apellido_paterno, p.apellido_materno, p.fecha_nacimiento, MAX(c.fecha) AS ultima
       FROM consulta c JOIN paciente p ON p.id = c.paciente_id
      GROUP BY p.id ORDER BY ultima DESC LIMIT 8`);

  const [totales] = await q(
    `SELECT (SELECT COUNT(*) FROM paciente WHERE activo = 1) AS pacientes,
            (SELECT COUNT(*) FROM consulta WHERE fecha >= DATE_FORMAT(CURDATE(), '%Y-%m-01')) AS consultasMes,
            (SELECT COUNT(*) FROM receta WHERE fecha >= DATE_FORMAT(CURDATE(), '%Y-%m-01')) AS recetasMes`);

  res.render('inicio', { titulo: 'Inicio', citas, recientes, totales, fecha });
});

module.exports = router;
