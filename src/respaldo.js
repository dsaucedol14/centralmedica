/**
 * Respaldos del sistema: un .zip con la base de datos (base-de-datos.sql, utilizable por separado)
 * y, si se pide, los archivos adjuntos de los expedientes. También importa y restaura esos respaldos.
 */
const fs = require('fs');
const fsp = fs.promises;
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { once } = require('events');
const { pipeline } = require('stream/promises');
const yazl = require('yazl');
const yauzl = require('yauzl');
const config = require('./config');
const { pool } = require('./db');
const { preparar } = require('./esquema');

const ENCABEZADO = '-- Central Médica · respaldo de la base de datos';
// Si falta esta última línea, el archivo llegó cortado y no se restaura
const FIN = '-- Fin del respaldo de Central Médica';
const SQL_EN_ZIP = 'base-de-datos.sql';
const MANIFIESTO = 'manifiesto.json';
// Las sesiones abiertas no se respaldan: al restaurar, todos vuelven a iniciar sesión
const NO_RESPALDAR = new Set(['sessions']);
const MAX_LINEA = 512 * 1024;
const NOMBRE_VALIDO = /^[A-Za-z0-9][A-Za-z0-9._-]*\.(zip|sql)$/;
const ARCHIVO_ADJUNTO = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

const dos = (n) => String(n).padStart(2, '0');
function sello(d = new Date()) {
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}_${dos(d.getHours())}${dos(d.getMinutes())}${dos(d.getSeconds())}`;
}

let ocupado = false;
async function enExclusiva(fn) {
  if (ocupado) throw new ErrorRespaldo('Ya se está generando o restaurando un respaldo. Espera a que termine.');
  ocupado = true;
  try { return await fn(); } finally { ocupado = false; }
}

class ErrorRespaldo extends Error {}

function rutaDe(nombre) {
  if (!NOMBRE_VALIDO.test(nombre || '')) throw new ErrorRespaldo('Nombre de respaldo no válido.');
  return path.join(config.respaldos, path.basename(nombre));
}

async function carpetaTemporal() {
  const dir = path.join(config.respaldos, '.tmp');
  await fsp.mkdir(dir, { recursive: true });
  return dir;
}

/* ----------------------------- Base de datos → SQL ----------------------------- */

async function tablasDe(con) {
  const [filas] = await con.query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
  return filas.map((f) => Object.values(f)[0]).filter((t) => !NO_RESPALDAR.has(t));
}

/** Escribe la base completa en un .sql con una sentencia por línea. Devuelve el número de renglones por tabla. */
async function volcarBase(destino) {
  const salida = fs.createWriteStream(destino, { encoding: 'utf8' });
  const escribir = async (texto) => { if (!salida.write(texto)) await once(salida, 'drain'); };
  const con = await pool.getConnection();
  const conteos = {};
  try {
    // Todas las tablas se leen en el mismo instante aunque otros usuarios sigan guardando
    await con.query('SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await con.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY');
    await escribir(`${ENCABEZADO}\n-- Generado el ${new Date().toLocaleString('es-MX')}\n-- Cada sentencia ocupa una sola línea.\n`);
    await escribir('SET NAMES utf8mb4;\nSET FOREIGN_KEY_CHECKS = 0;\n');
    for (const tabla of await tablasDe(con)) {
      const id = con.escapeId(tabla);
      const [[crear]] = await con.query(`SHOW CREATE TABLE ${id}`);
      await escribir(`DROP TABLE IF EXISTS ${id};\n${crear['Create Table'].replace(/\s*\n\s*/g, ' ')};\n`);
      let n = 0;
      let prefijo = null;
      let lote = [];
      let tam = 0;
      const vaciar = async () => {
        if (!lote.length) return;
        await escribir(`${prefijo}${lote.join(',')};\n`);
        lote = []; tam = 0;
      };
      for await (const fila of con.connection.query(`SELECT * FROM ${id}`).stream()) {
        if (!prefijo) prefijo = `INSERT INTO ${id} (${Object.keys(fila).map((c) => con.escapeId(c)).join(',')}) VALUES `;
        const valores = `(${Object.values(fila).map((v) => con.escape(v)).join(',')})`;
        lote.push(valores);
        tam += valores.length;
        n++;
        if (tam >= MAX_LINEA) await vaciar();
      }
      await vaciar();
      conteos[tabla] = n;
    }
    await escribir(`SET FOREIGN_KEY_CHECKS = 1;\n${FIN}\n`);
  } finally {
    await con.query('COMMIT').catch(() => {});
    con.release();
    salida.end();
    await once(salida, 'close');
  }
  return conteos;
}

/* ----------------------------- Generar ----------------------------- */

function textoLeeme(m) {
  return [
    'RESPALDO DE CENTRAL MÉDICA',
    '==========================',
    '',
    `Fecha: ${new Date(m.fecha).toLocaleString('es-MX')}`,
    `Generado por: ${m.generado_por || '—'}`,
    `Pacientes: ${m.conteos.paciente ?? 0} · Consultas: ${m.conteos.consulta ?? 0} · Recetas: ${m.conteos.receta ?? 0}`,
    `Archivos adjuntos incluidos: ${m.incluye_archivos ? `sí (${m.archivos})` : 'no'}`,
    '',
    'Contenido:',
    `  - ${SQL_EN_ZIP}: la base de datos completa. Puede usarse por separado con MySQL.`,
    m.incluye_archivos ? '  - archivos/: estudios y documentos adjuntos a los expedientes.' : null,
    `  - ${MANIFIESTO}: datos técnicos del respaldo.`,
    '',
    'Para restaurarlo: entra al sistema como administrador, ve a',
    'Administración > Respaldos > Importar un respaldo, y después elige «Restaurar».',
    '',
    'IMPORTANTE: este archivo contiene expedientes clínicos (datos personales sensibles).',
    'Guárdalo en un lugar seguro y no lo compartas.',
    '',
  ].filter((l) => l !== null).join('\r\n');
}

async function generarSinBloqueo({ incluirArchivos, usuario, antesDeRestaurar = false }) {
  await fsp.mkdir(config.respaldos, { recursive: true });
  const tmp = await carpetaTemporal();
  const marca = sello();
  const tipo = incluirArchivos ? 'completo' : 'base-de-datos';
  const nombre = `central-medica_${marca}_${tipo}${antesDeRestaurar ? '_antes-de-restaurar' : ''}.zip`;
  const sqlTemporal = path.join(tmp, `${crypto.randomBytes(8).toString('hex')}.sql`);
  const destino = path.join(config.respaldos, nombre);
  const parcial = path.join(tmp, `${nombre}.parcial`);
  try {
    const conteos = await volcarBase(sqlTemporal);
    const zip = new yazl.ZipFile();
    zip.addFile(sqlTemporal, SQL_EN_ZIP);
    let archivos = 0;
    if (incluirArchivos) {
      const lista = await fsp.readdir(config.uploads, { withFileTypes: true }).catch(() => []);
      for (const a of lista) {
        if (!a.isFile() || !ARCHIVO_ADJUNTO.test(a.name)) continue;
        zip.addFile(path.join(config.uploads, a.name), `archivos/${a.name}`, { compress: !/\.(jpe?g|png|webp|heic|pdf|docx|xlsx)$/i.test(a.name) });
        archivos++;
      }
    }
    const manifiesto = {
      sistema: 'central-medica', formato: 1, fecha: new Date().toISOString(), generado_por: usuario || null,
      incluye_archivos: !!incluirArchivos, archivos, conteos,
    };
    zip.addBuffer(Buffer.from(JSON.stringify(manifiesto, null, 2)), MANIFIESTO);
    zip.addBuffer(Buffer.from(textoLeeme(manifiesto)), 'LEEME.txt');
    zip.end();
    await pipeline(zip.outputStream, fs.createWriteStream(parcial));
    await fsp.rename(parcial, destino);
    return { nombre, manifiesto };
  } finally {
    await fsp.rm(sqlTemporal, { force: true });
    await fsp.rm(parcial, { force: true });
  }
}

function generar(opciones) {
  return enExclusiva(() => generarSinBloqueo(opciones));
}

/* ----------------------------- Leer respaldos ----------------------------- */

function abrirZip(ruta) {
  return new Promise((ok, mal) => yauzl.open(ruta, { lazyEntries: true, autoClose: false }, (e, z) => (e ? mal(e) : ok(z))));
}

/** Recorre las entradas del zip en orden; fn(entrada, abrir) puede abrir y consumir cada una. */
async function recorrerZip(ruta, fn) {
  const zip = await abrirZip(ruta);
  try {
    await new Promise((ok, mal) => {
      zip.on('error', mal);
      zip.on('end', ok);
      zip.on('entry', (entrada) => {
        const abrir = () => new Promise((a, b) => zip.openReadStream(entrada, (e, s) => (e ? b(e) : a(s))));
        Promise.resolve(fn(entrada, abrir)).then(() => zip.readEntry(), mal);
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
}

async function leerTexto(flujo) {
  const partes = [];
  for await (const p of flujo) partes.push(p);
  return Buffer.concat(partes).toString('utf8');
}

async function primeraLinea(ruta) {
  const flujo = fs.createReadStream(ruta, { end: 200 });
  const texto = await leerTexto(flujo);
  return texto.split(/\r?\n/)[0];
}

/** Datos de un respaldo, o null si el archivo no es un respaldo de este sistema. */
async function inspeccionar(ruta) {
  if (ruta.endsWith('.sql')) {
    if (!(await primeraLinea(ruta)).startsWith(ENCABEZADO)) return null;
    const st = await fsp.stat(ruta);
    return { tipo: 'sql', incluye_archivos: false, fecha: st.mtime.toISOString(), conteos: null };
  }
  let manifiesto = null;
  let tieneSql = false;
  try {
    await recorrerZip(ruta, async (entrada, abrir) => {
      if (entrada.fileName === SQL_EN_ZIP) tieneSql = true;
      if (entrada.fileName === MANIFIESTO && entrada.uncompressedSize < 1024 * 1024) manifiesto = JSON.parse(await leerTexto(await abrir()));
    });
  } catch {
    return null;
  }
  if (!tieneSql || !manifiesto || manifiesto.sistema !== 'central-medica') return null;
  return { tipo: 'zip', ...manifiesto };
}

async function listar() {
  const nombres = await fsp.readdir(config.respaldos).catch(() => []);
  const lista = [];
  for (const nombre of nombres) {
    if (!NOMBRE_VALIDO.test(nombre)) continue;
    const ruta = path.join(config.respaldos, nombre);
    const st = await fsp.stat(ruta);
    if (!st.isFile()) continue;
    lista.push({ nombre, tamano: st.size, modificado: st.mtime, info: await inspeccionar(ruta) });
  }
  return lista.sort((a, b) => b.modificado - a.modificado);
}

/** Flujo de lectura del .sql de un respaldo (para descargar solo la base de datos o restaurarla). */
async function flujoSql(ruta, alAbrir) {
  if (ruta.endsWith('.sql')) return alAbrir(fs.createReadStream(ruta));
  let encontrado = false;
  await recorrerZip(ruta, async (entrada, abrir) => {
    if (entrada.fileName !== SQL_EN_ZIP) return;
    encontrado = true;
    await alAbrir(await abrir());
  });
  if (!encontrado) throw new ErrorRespaldo('El respaldo no contiene la base de datos.');
}

/* ----------------------------- Restaurar ----------------------------- */

/** Lee el .sql completo sin ejecutarlo y confirma que no esté cortado. */
async function sqlCompleto(ruta) {
  let cola = '';
  await flujoSql(ruta, async (flujo) => {
    for await (const parte of flujo) cola = (cola + parte.toString('utf8')).slice(-200);
  });
  return cola.trimEnd().endsWith(FIN);
}

/** Ejecuta un .sql de respaldo sentencia por sentencia. Devuelve las tablas que contenía. */
async function ejecutarSql(con, flujo) {
  const tablas = new Set();
  let pendiente = '';
  const lineas = readline.createInterface({ input: flujo, crlfDelay: Infinity });
  let completo = false;
  for await (const linea of lineas) {
    if (linea.startsWith(FIN)) completo = true;
    if (!pendiente && (!linea.trim() || linea.startsWith('--'))) continue;
    pendiente += (pendiente ? '\n' : '') + linea;
    if (!pendiente.trimEnd().endsWith(';')) continue;
    const m = pendiente.match(/^CREATE TABLE `([^`]+)`/);
    if (m) tablas.add(m[1]);
    await con.query(pendiente);
    pendiente = '';
  }
  if (pendiente.trim() || !completo) throw new ErrorRespaldo('El respaldo está incompleto o dañado.');
  return tablas;
}

async function restaurarBase(ruta) {
  const con = await pool.getConnection();
  try {
    await con.query('SET FOREIGN_KEY_CHECKS = 0');
    let tablas;
    await flujoSql(ruta, async (flujo) => { tablas = await ejecutarSql(con, flujo); });
    // Tablas que el respaldo no traía (creadas por versiones posteriores): se vacían borrándolas y se recrean al preparar
    for (const t of await tablasDe(con)) if (!tablas.has(t)) await con.query(`DROP TABLE ${con.escapeId(t)}`);
    await con.query('SET FOREIGN_KEY_CHECKS = 1');
  } finally {
    con.release();
  }
  await preparar();
}

async function restaurarArchivos(ruta) {
  const padre = path.dirname(config.uploads);
  const nueva = path.join(padre, `.uploads-restaurando-${sello()}`);
  await fsp.mkdir(nueva, { recursive: true });
  try {
    await recorrerZip(ruta, async (entrada, abrir) => {
      if (!entrada.fileName.startsWith('archivos/')) return;
      const nombre = entrada.fileName.slice('archivos/'.length);
      if (!ARCHIVO_ADJUNTO.test(nombre)) return; // evita rutas como ../ dentro del zip
      await pipeline(await abrir(), fs.createWriteStream(path.join(nueva, nombre)));
    });
    const anterior = path.join(padre, `.uploads-anterior-${sello()}`);
    await fsp.rename(config.uploads, anterior).catch((e) => { if (e.code !== 'ENOENT') throw e; });
    await fsp.rename(nueva, config.uploads);
    await fsp.rm(anterior, { recursive: true, force: true });
  } catch (e) {
    await fsp.rm(nueva, { recursive: true, force: true });
    throw e;
  }
}

/**
 * Reemplaza la información actual por la del respaldo. Antes guarda un respaldo completo de seguridad;
 * si la base falla a medio camino, la regresa sola al estado anterior.
 */
function restaurar(nombre, { conArchivos, usuario }) {
  return enExclusiva(async () => {
    const ruta = rutaDe(nombre);
    const info = await inspeccionar(ruta);
    if (!info) throw new ErrorRespaldo('Ese archivo no es un respaldo válido de Central Médica.');
    if (!(await sqlCompleto(ruta))) throw new ErrorRespaldo('El respaldo está incompleto o dañado (el archivo está cortado). No se cambió nada.');
    const seguridad = await generarSinBloqueo({ incluirArchivos: true, usuario, antesDeRestaurar: true });
    try {
      await restaurarBase(ruta);
    } catch (e) {
      console.error('Falló la restauración; se regresa al estado anterior:', e);
      try {
        await restaurarBase(path.join(config.respaldos, seguridad.nombre));
      } catch (e2) {
        console.error('Tampoco se pudo regresar al estado anterior:', e2);
        throw new ErrorRespaldo(`La restauración falló y no se pudo regresar sola al estado anterior. Restaura manualmente el respaldo «${seguridad.nombre}».`);
      }
      throw new ErrorRespaldo(`La restauración falló (${e.message}). No se perdió nada: el sistema quedó como estaba.`);
    }
    const archivosRestaurados = conArchivos && info.incluye_archivos;
    if (archivosRestaurados) await restaurarArchivos(ruta);
    // Todos vuelven a iniciar sesión: los usuarios pudieron cambiar con el respaldo
    await pool.query('DELETE FROM sessions').catch(() => {});
    return { info, seguridad: seguridad.nombre, archivosRestaurados };
  });
}

/* ----------------------------- Importar ----------------------------- */

/** Valida un archivo subido y lo deja en la carpeta de respaldos. Devuelve su nombre final. */
async function importar(rutaTemporal, nombreOriginal) {
  const extension = /\.sql$/i.test(nombreOriginal) ? '.sql' : '.zip';
  const provisional = `${rutaTemporal}${extension}`;
  await fsp.rename(rutaTemporal, provisional);
  try {
    if (!(await inspeccionar(provisional))) throw new ErrorRespaldo('Ese archivo no es un respaldo de Central Médica. Usa un archivo .zip (o .sql) generado por este sistema.');
    const base = path.basename(nombreOriginal, path.extname(nombreOriginal)).replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '').slice(0, 80) || 'respaldo';
    const nombre = `importado_${sello()}_${base}${extension}`;
    await fsp.mkdir(config.respaldos, { recursive: true });
    await fsp.rename(provisional, path.join(config.respaldos, nombre));
    return nombre;
  } finally {
    await fsp.rm(provisional, { force: true });
  }
}

async function eliminar(nombre) {
  await fsp.rm(rutaDe(nombre));
}

module.exports = {
  ErrorRespaldo, generar, listar, inspeccionar, flujoSql, restaurar, importar, eliminar, rutaDe, carpetaTemporal,
};
