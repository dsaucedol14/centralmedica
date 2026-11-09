/** Utilidades de formato y de lectura de formularios. Las fechas llegan de MySQL como texto. */

const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
  'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DIAS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];

const dos = (n) => String(n).padStart(2, '0');

/** Fecha local de hoy como 'AAAA-MM-DD'. */
function hoy(d = new Date()) {
  return `${d.getFullYear()}-${dos(d.getMonth() + 1)}-${dos(d.getDate())}`;
}

/** Fecha y hora local como 'AAAA-MM-DDThh:mm' (para <input type="datetime-local">). */
function ahoraLocal(d = new Date()) {
  return `${hoy(d)}T${dos(d.getHours())}:${dos(d.getMinutes())}`;
}

/** Interpreta 'AAAA-MM-DD[ hh:mm[:ss]]' como fecha local. */
function aFecha(texto) {
  if (!texto) return null;
  if (texto instanceof Date) return texto;
  const m = String(texto).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
}

/** 02/11/2026 */
function fecha(texto) {
  const d = aFecha(texto);
  return d ? `${dos(d.getDate())}/${dos(d.getMonth() + 1)}/${d.getFullYear()}` : '';
}

/** 2 de noviembre de 2026 */
function fechaLarga(texto) {
  const d = aFecha(texto);
  return d ? `${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}` : '';
}

/** 02/11/2026 09:30 */
function fechaHora(texto) {
  const d = aFecha(texto);
  return d ? `${fecha(texto)} ${dos(d.getHours())}:${dos(d.getMinutes())}` : '';
}

function hora(texto) {
  const d = aFecha(texto);
  return d ? `${dos(d.getHours())}:${dos(d.getMinutes())}` : '';
}

/** lunes 2 de noviembre */
function diaLargo(texto) {
  const d = aFecha(texto);
  return d ? `${DIAS[d.getDay()]} ${d.getDate()} de ${MESES[d.getMonth()]}` : '';
}

/** Edad legible: «34 años», «8 meses», «12 días». */
function edad(nacimiento, referencia = new Date()) {
  const n = aFecha(nacimiento);
  if (!n) return '';
  let meses = (referencia.getFullYear() - n.getFullYear()) * 12 + referencia.getMonth() - n.getMonth();
  if (referencia.getDate() < n.getDate()) meses--;
  if (meses >= 24) return `${Math.floor(meses / 12)} años`;
  if (meses >= 1) return `${meses} ${meses === 1 ? 'mes' : 'meses'}`;
  const dias = Math.max(0, Math.floor((referencia - n) / 86400000));
  return `${dias} ${dias === 1 ? 'día' : 'días'}`;
}

function nombreCompleto(p) {
  return [p.nombre, p.apellido_paterno, p.apellido_materno].filter(Boolean).join(' ');
}

/** Apellidos primero, para listas ordenadas. */
function nombreLista(p) {
  return [p.apellido_paterno, p.apellido_materno].filter(Boolean).join(' ') + ', ' + p.nombre;
}

/** Texto limpio o null. */
function texto(v, max) {
  if (v === undefined || v === null) return null;
  const s = String(v).trim();
  if (!s) return null;
  return max ? s.slice(0, max) : s;
}

/** Número o null (acepta coma decimal). */
function numero(v) {
  const s = texto(v);
  if (s === null) return null;
  const n = Number(s.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

/** Fecha 'AAAA-MM-DD' válida o null. */
function fechaISO(v) {
  const s = texto(v);
  return s && /^\d{4}-\d{2}-\d{2}$/.test(s) && aFecha(s) ? s : null;
}

/** Siempre un arreglo (los campos repetidos de un formulario llegan como texto si hay uno solo). */
function lista(v) {
  if (v === undefined || v === null) return [];
  return Array.isArray(v) ? v : [v];
}

function imc(peso, talla) {
  if (!peso || !talla) return null;
  return Math.round((peso / (talla * talla)) * 10) / 10;
}

function clasificaImc(valor) {
  if (valor === null) return '';
  if (valor < 18.5) return 'bajo peso';
  if (valor < 25) return 'normal';
  if (valor < 30) return 'sobrepeso';
  return 'obesidad';
}

function tamano(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

module.exports = {
  hoy, ahoraLocal, aFecha, fecha, fechaLarga, fechaHora, hora, diaLargo, edad,
  nombreCompleto, nombreLista, texto, numero, fechaISO, lista, imc, clasificaImc, tamano,
};
