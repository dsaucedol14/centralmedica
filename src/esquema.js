/**
 * Crea la base de datos y las tablas si no existen, y el primer administrador.
 * Se ejecuta en cada arranque; las sentencias son idempotentes.
 */
const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const config = require('./config');

const TABLAS = [
  `CREATE TABLE IF NOT EXISTS usuario (
    id INT AUTO_INCREMENT PRIMARY KEY,
    usuario VARCHAR(50) NOT NULL UNIQUE,
    nombre VARCHAR(150) NOT NULL,
    password_hash VARCHAR(100) NOT NULL,
    rol ENUM('MEDICO','ASISTENTE') NOT NULL DEFAULT 'ASISTENTE',
    es_admin TINYINT(1) NOT NULL DEFAULT 0,
    cedula VARCHAR(30) NULL,
    especialidad VARCHAR(120) NULL,
    cedula_especialidad VARCHAR(30) NULL,
    universidad VARCHAR(200) NULL,
    activo TINYINT(1) NOT NULL DEFAULT 1,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,

  `CREATE TABLE IF NOT EXISTS consultorio (
    id TINYINT PRIMARY KEY,
    nombre VARCHAR(150) NOT NULL,
    direccion VARCHAR(250) NULL,
    ciudad VARCHAR(100) NULL,
    telefono VARCHAR(60) NULL,
    email VARCHAR(120) NULL,
    horario VARCHAR(150) NULL,
    leyenda_receta VARCHAR(300) NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,

  `CREATE TABLE IF NOT EXISTS paciente (
    id INT AUTO_INCREMENT PRIMARY KEY,
    expediente VARCHAR(20) NULL UNIQUE,
    nombre VARCHAR(80) NOT NULL,
    apellido_paterno VARCHAR(80) NOT NULL,
    apellido_materno VARCHAR(80) NULL,
    fecha_nacimiento DATE NULL,
    sexo ENUM('F','M') NULL,
    curp VARCHAR(18) NULL,
    telefono VARCHAR(30) NULL,
    email VARCHAR(120) NULL,
    domicilio VARCHAR(250) NULL,
    ocupacion VARCHAR(100) NULL,
    estado_civil VARCHAR(30) NULL,
    tipo_sangre VARCHAR(5) NULL,
    contacto_emergencia VARCHAR(150) NULL,
    telefono_emergencia VARCHAR(30) NULL,
    alergias VARCHAR(500) NULL,
    notas TEXT NULL,
    activo TINYINT(1) NOT NULL DEFAULT 1,
    creado_por INT NULL,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    INDEX ix_paciente_nombre (apellido_paterno, apellido_materno, nombre),
    INDEX ix_paciente_curp (curp),
    CONSTRAINT fk_paciente_usuario FOREIGN KEY (creado_por) REFERENCES usuario(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,

  `CREATE TABLE IF NOT EXISTS historia_clinica (
    paciente_id INT PRIMARY KEY,
    heredofamiliares TEXT NULL,
    personales_patologicos TEXT NULL,
    personales_no_patologicos TEXT NULL,
    gineco_obstetricos TEXT NULL,
    quirurgicos TEXT NULL,
    medicamentos_actuales TEXT NULL,
    vacunas TEXT NULL,
    actualizado_por INT NULL,
    actualizado_en DATETIME NULL,
    CONSTRAINT fk_historia_paciente FOREIGN KEY (paciente_id) REFERENCES paciente(id) ON DELETE CASCADE,
    CONSTRAINT fk_historia_usuario FOREIGN KEY (actualizado_por) REFERENCES usuario(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,

  `CREATE TABLE IF NOT EXISTS consulta (
    id INT AUTO_INCREMENT PRIMARY KEY,
    paciente_id INT NOT NULL,
    medico_id INT NOT NULL,
    fecha DATETIME NOT NULL,
    motivo VARCHAR(300) NOT NULL,
    padecimiento_actual TEXT NULL,
    peso DECIMAL(5,2) NULL,
    talla DECIMAL(4,2) NULL,
    ta_sistolica SMALLINT NULL,
    ta_diastolica SMALLINT NULL,
    fc SMALLINT NULL,
    fr SMALLINT NULL,
    temperatura DECIMAL(4,1) NULL,
    spo2 TINYINT NULL,
    glucosa SMALLINT NULL,
    exploracion TEXT NULL,
    diagnostico TEXT NOT NULL,
    cie10 VARCHAR(60) NULL,
    plan TEXT NULL,
    pronostico VARCHAR(200) NULL,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    actualizado_en DATETIME NULL ON UPDATE CURRENT_TIMESTAMP,
    INDEX ix_consulta_paciente (paciente_id, fecha),
    CONSTRAINT fk_consulta_paciente FOREIGN KEY (paciente_id) REFERENCES paciente(id),
    CONSTRAINT fk_consulta_medico FOREIGN KEY (medico_id) REFERENCES usuario(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,

  `CREATE TABLE IF NOT EXISTS folio (
    tipo VARCHAR(20) NOT NULL,
    anio SMALLINT NOT NULL,
    ultimo INT NOT NULL,
    PRIMARY KEY (tipo, anio)
  ) ENGINE=InnoDB`,

  `CREATE TABLE IF NOT EXISTS receta (
    id INT AUTO_INCREMENT PRIMARY KEY,
    folio VARCHAR(20) NOT NULL UNIQUE,
    paciente_id INT NOT NULL,
    medico_id INT NOT NULL,
    consulta_id INT NULL,
    fecha DATE NOT NULL,
    diagnostico VARCHAR(300) NULL,
    indicaciones TEXT NULL,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX ix_receta_paciente (paciente_id, fecha),
    CONSTRAINT fk_receta_paciente FOREIGN KEY (paciente_id) REFERENCES paciente(id),
    CONSTRAINT fk_receta_medico FOREIGN KEY (medico_id) REFERENCES usuario(id),
    CONSTRAINT fk_receta_consulta FOREIGN KEY (consulta_id) REFERENCES consulta(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,

  `CREATE TABLE IF NOT EXISTS receta_medicamento (
    id INT AUTO_INCREMENT PRIMARY KEY,
    receta_id INT NOT NULL,
    orden TINYINT NOT NULL,
    medicamento VARCHAR(200) NOT NULL,
    presentacion VARCHAR(150) NULL,
    dosis VARCHAR(100) NULL,
    via VARCHAR(50) NULL,
    frecuencia VARCHAR(100) NULL,
    duracion VARCHAR(100) NULL,
    indicaciones VARCHAR(300) NULL,
    CONSTRAINT fk_medicamento_receta FOREIGN KEY (receta_id) REFERENCES receta(id) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,

  `CREATE TABLE IF NOT EXISTS orden_estudio (
    id INT AUTO_INCREMENT PRIMARY KEY,
    folio VARCHAR(20) NOT NULL UNIQUE,
    paciente_id INT NOT NULL,
    medico_id INT NOT NULL,
    consulta_id INT NULL,
    fecha DATE NOT NULL,
    tipo ENUM('LABORATORIO','GABINETE','OTRO') NOT NULL,
    estudios TEXT NOT NULL,
    diagnostico VARCHAR(300) NULL,
    indicaciones TEXT NULL,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX ix_orden_paciente (paciente_id, fecha),
    CONSTRAINT fk_orden_paciente FOREIGN KEY (paciente_id) REFERENCES paciente(id),
    CONSTRAINT fk_orden_medico FOREIGN KEY (medico_id) REFERENCES usuario(id),
    CONSTRAINT fk_orden_consulta FOREIGN KEY (consulta_id) REFERENCES consulta(id) ON DELETE SET NULL
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,

  `CREATE TABLE IF NOT EXISTS certificado (
    id INT AUTO_INCREMENT PRIMARY KEY,
    folio VARCHAR(20) NOT NULL UNIQUE,
    paciente_id INT NOT NULL,
    medico_id INT NOT NULL,
    fecha DATE NOT NULL,
    tipo ENUM('SALUD','INCAPACIDAD','ASISTENCIA') NOT NULL,
    dirigido_a VARCHAR(200) NULL,
    diagnostico VARCHAR(300) NULL,
    dias_reposo SMALLINT NULL,
    desde DATE NULL,
    hasta DATE NULL,
    texto TEXT NOT NULL,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX ix_certificado_paciente (paciente_id, fecha),
    CONSTRAINT fk_certificado_paciente FOREIGN KEY (paciente_id) REFERENCES paciente(id),
    CONSTRAINT fk_certificado_medico FOREIGN KEY (medico_id) REFERENCES usuario(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,

  `CREATE TABLE IF NOT EXISTS cita (
    id INT AUTO_INCREMENT PRIMARY KEY,
    paciente_id INT NULL,
    nombre_paciente VARCHAR(200) NULL,
    telefono VARCHAR(30) NULL,
    medico_id INT NOT NULL,
    inicio DATETIME NOT NULL,
    duracion_min SMALLINT NOT NULL DEFAULT 30,
    motivo VARCHAR(300) NULL,
    estado ENUM('PROGRAMADA','CONFIRMADA','ATENDIDA','CANCELADA','NO_ASISTIO') NOT NULL DEFAULT 'PROGRAMADA',
    notas VARCHAR(500) NULL,
    creado_por INT NULL,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX ix_cita_inicio (inicio),
    INDEX ix_cita_medico (medico_id, inicio),
    CONSTRAINT fk_cita_paciente FOREIGN KEY (paciente_id) REFERENCES paciente(id) ON DELETE SET NULL,
    CONSTRAINT fk_cita_medico FOREIGN KEY (medico_id) REFERENCES usuario(id),
    CONSTRAINT fk_cita_usuario FOREIGN KEY (creado_por) REFERENCES usuario(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,

  `CREATE TABLE IF NOT EXISTS dia_bloqueado (
    id INT AUTO_INCREMENT PRIMARY KEY,
    medico_id INT NOT NULL,
    fecha DATE NOT NULL,
    motivo VARCHAR(200) NULL,
    creado_por INT NULL,
    creado_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_bloqueo_medico_fecha (medico_id, fecha),
    INDEX ix_bloqueo_fecha (fecha),
    CONSTRAINT fk_bloqueo_medico FOREIGN KEY (medico_id) REFERENCES usuario(id),
    CONSTRAINT fk_bloqueo_usuario FOREIGN KEY (creado_por) REFERENCES usuario(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,

  `CREATE TABLE IF NOT EXISTS archivo (
    id INT AUTO_INCREMENT PRIMARY KEY,
    paciente_id INT NOT NULL,
    categoria VARCHAR(40) NOT NULL,
    descripcion VARCHAR(250) NULL,
    nombre_original VARCHAR(255) NOT NULL,
    nombre_guardado VARCHAR(100) NOT NULL,
    tipo_mime VARCHAR(100) NOT NULL,
    tamano INT NOT NULL,
    subido_por INT NULL,
    subido_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX ix_archivo_paciente (paciente_id),
    CONSTRAINT fk_archivo_paciente FOREIGN KEY (paciente_id) REFERENCES paciente(id),
    CONSTRAINT fk_archivo_usuario FOREIGN KEY (subido_por) REFERENCES usuario(id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,

  `CREATE TABLE IF NOT EXISTS bitacora (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    usuario_id INT NULL,
    accion VARCHAR(40) NOT NULL,
    entidad VARCHAR(40) NOT NULL,
    entidad_id INT NULL,
    paciente_id INT NULL,
    detalle VARCHAR(300) NULL,
    fecha DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX ix_bitacora_fecha (fecha),
    INDEX ix_bitacora_paciente (paciente_id)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci`,
];

async function preparar() {
  const { database, ...conexion } = config.db;
  const con = await mysql.createConnection({ ...conexion, multipleStatements: false });
  try {
    await con.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
    await con.changeUser({ database });
    for (const sql of TABLAS) await con.query(sql);

    await con.query(`INSERT IGNORE INTO consultorio (id, nombre) VALUES (1, 'Central Médica')`);

    const [[{ admins }]] = await con.query('SELECT COUNT(*) AS admins FROM usuario WHERE es_admin = 1 AND activo = 1');
    if (admins === 0) {
      const hash = await bcrypt.hash(config.admin.password, 10);
      const [[existe]] = await con.query('SELECT id FROM usuario WHERE usuario = ?', [config.admin.usuario]);
      if (existe) {
        await con.query('UPDATE usuario SET es_admin = 1, activo = 1, password_hash = ? WHERE id = ?', [hash, existe.id]);
      } else {
        await con.query(
          `INSERT INTO usuario (usuario, nombre, password_hash, rol, es_admin) VALUES (?, 'Administrador', ?, 'MEDICO', 1)`,
          [config.admin.usuario, hash]);
      }
      console.log(`Administrador inicial: ${config.admin.usuario} (cambia la contraseña en «Mi cuenta»)`);
    }
  } finally {
    await con.end();
  }
}

module.exports = { preparar };
