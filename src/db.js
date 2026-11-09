const mysql = require('mysql2/promise');
const config = require('./config');

const pool = mysql.createPool({
  ...config.db,
  waitForConnections: true,
  connectionLimit: 10,
  charset: 'utf8mb4',
  dateStrings: true, // fechas como texto 'AAAA-MM-DD [hh:mm:ss]': sin corrimientos de zona horaria
  decimalNumbers: true, // peso 62.5 y no '62.50'
  namedPlaceholders: false,
});

/** Ejecuta una consulta y devuelve los renglones (o el resultado de un INSERT/UPDATE). */
async function q(sql, params = []) {
  const [filas] = await pool.query(sql, params);
  return filas;
}

/** Primer renglón o null. */
async function uno(sql, params = []) {
  const filas = await q(sql, params);
  return filas[0] || null;
}

/** Ejecuta fn(conexion) dentro de una transacción. */
async function tx(fn) {
  const con = await pool.getConnection();
  try {
    await con.beginTransaction();
    const r = await fn(con);
    await con.commit();
    return r;
  } catch (e) {
    await con.rollback();
    throw e;
  } finally {
    con.release();
  }
}

/**
 * Siguiente folio consecutivo por tipo y año (R-2026-0001), sin huecos ni duplicados aunque
 * varios usuarios guarden al mismo tiempo. Se llama dentro de tx().
 */
async function siguienteFolio(con, tipo, prefijo, anio) {
  await con.query(
    'INSERT INTO folio (tipo, anio, ultimo) VALUES (?, ?, 0) ON DUPLICATE KEY UPDATE ultimo = ultimo',
    [tipo, anio]);
  const [[f]] = await con.query('SELECT ultimo FROM folio WHERE tipo = ? AND anio = ? FOR UPDATE', [tipo, anio]);
  const n = f.ultimo + 1;
  await con.query('UPDATE folio SET ultimo = ? WHERE tipo = ? AND anio = ?', [n, tipo, anio]);
  return `${prefijo}-${anio}-${String(n).padStart(4, '0')}`;
}

module.exports = { pool, q, uno, tx, siguienteFolio };
