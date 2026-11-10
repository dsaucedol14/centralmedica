const path = require('path');
const fs = require('fs');
const express = require('express');
const session = require('express-session');
const MySQLStore = require('express-mysql-session')(session);

const config = require('./config');
const { pool } = require('./db');
const { preparar } = require('./esquema');
const util = require('./util');
const seg = require('./seguridad');

async function iniciar() {
  await preparar();
  fs.mkdirSync(config.uploads, { recursive: true });

  const app = express();
  app.set('view engine', 'ejs');
  app.set('views', path.join(__dirname, '..', 'views'));
  app.set('trust proxy', 'loopback');
  app.disable('x-powered-by');

  app.use(seg.encabezados);
  app.use('/static', express.static(path.join(__dirname, '..', 'public'), { maxAge: '1h' }));
  app.use(express.urlencoded({ extended: false, limit: '1mb' }));

  // Sesiones en MySQL: sobreviven a reinicios y se comparten si hay varios procesos
  app.use(session({
    name: 'consultorio.sid',
    secret: config.secretoSesion,
    store: new MySQLStore({ createDatabaseTable: true, clearExpired: true }, pool),
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure: 'auto', maxAge: 8 * 60 * 60 * 1000 },
  }));

  // express-session manda los encabezados de la respuesta antes de terminar de guardar la sesión en MySQL;
  // el navegador sigue la redirección de inmediato y leería la sesión vieja (se perdía el login y los avisos).
  // Por eso toda redirección espera a que la sesión quede guardada.
  app.use((req, res, next) => {
    const redirigir = res.redirect.bind(res);
    res.redirect = (...args) => (req.session // tras «Salir» la sesión ya no existe
      ? req.session.save((err) => (err ? next(err) : redirigir(...args)))
      : redirigir(...args));
    next();
  });
  app.use(seg.flash);
  app.use(seg.csrf);
  app.use(seg.cargarUsuario);
  app.use((req, res, next) => {
    res.locals.f = util;
    res.locals.ruta = req.path;
    res.locals.titulo = 'Central Médica';
    next();
  });

  // El POST de archivos es multipart: su token CSRF viaja en ?_csrf= y se valida en la propia ruta
  app.use((req, res, next) => (req.is('multipart/form-data') ? next() : seg.validarCsrf(req, res, next)));

  app.use(require('./rutas/acceso'));
  app.get('/ayuda', (req, res) => res.render('ayuda', { titulo: 'Manual de usuario' }));
  app.use(seg.requiereSesion);
  app.use(seg.limitarRecepcion);
  app.use(seg.salaDeEspera);
  app.use(require('./rutas/recepcion'));
  app.use(require('./rutas/sala'));
  app.use(require('./rutas/inicio'));
  app.use(require('./rutas/pacientes'));
  app.use(require('./rutas/consultas'));
  app.use(require('./rutas/documentos'));
  app.use(require('./rutas/agenda'));
  app.use(require('./rutas/archivos'));
  app.use('/admin/respaldos', seg.requiereAdmin, require('./rutas/respaldos'));
  app.use('/admin', seg.requiereAdmin, require('./rutas/admin'));

  app.use((req, res) => res.status(404).render('error', { titulo: 'No encontrado', mensaje: 'La página que buscas no existe.' }));
  app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
    console.error(err);
    const mensaje = err.code === 'LIMIT_FILE_SIZE'
      ? `El archivo pasa del límite de ${config.uploadMaxMb} MB.`
      : 'Ocurrió un error inesperado. Si se repite, avisa al administrador.';
    res.status(err.code === 'LIMIT_FILE_SIZE' ? 413 : 500).render('error', { titulo: 'Error', mensaje });
  });

  app.listen(config.puerto, () => console.log(`Central Médica en http://localhost:${config.puerto}`));
}

iniciar().catch((e) => {
  console.error('No se pudo arrancar:', e.message);
  if (e.code === 'ECONNREFUSED') console.error('¿Está encendido MySQL en Laragon?');
  process.exit(1);
});
