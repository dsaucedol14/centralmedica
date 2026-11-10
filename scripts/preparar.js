/**
 * Revisión previa al arranque (la usa iniciar.bat): crea el .env si falta, confirma que MySQL responde
 * y muestra las direcciones para entrar desde otras computadoras de la red.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const raiz = path.join(__dirname, '..');
const env = path.join(raiz, '.env');

if (!fs.existsSync(env)) {
  const ejemplo = fs.readFileSync(path.join(raiz, '.env.example'), 'utf8');
  fs.writeFileSync(env, ejemplo.replace(/^SESSION_SECRET=.*$/m, `SESSION_SECRET=${crypto.randomBytes(32).toString('hex')}`));
  console.log('  Se creó el archivo de configuración .env (con una clave de sesión nueva).');
  console.log('  IMPORTANTE: al entrar por primera vez, cambia la contraseña del usuario admin en «Mi cuenta».\n');
}

const config = require('../src/config');
const mysql = require('mysql2/promise');

async function conectar() {
  const { database, ...conexion } = config.db;
  // Al encender la computadora, Laragon puede tardar en levantar MySQL: se espera hasta un minuto
  for (let intento = 1; ; intento++) {
    try {
      const con = await mysql.createConnection({ ...conexion, connectTimeout: 5000 });
      await con.end();
      return;
    } catch (e) {
      if (e.code !== 'ECONNREFUSED' || intento >= 30) throw e;
      if (intento === 1) process.stdout.write('  Esperando a que MySQL encienda');
      process.stdout.write('.');
      await new Promise((ok) => setTimeout(ok, 2000));
    }
  }
}

(async () => {
  try {
    await conectar();
  } catch (e) {
    console.error(`\n  [X] No se pudo conectar con MySQL en ${config.db.host}:${config.db.port}.`);
    if (e.code === 'ECONNREFUSED' || e.code === 'ETIMEDOUT') {
      console.error('      Abre Laragon y presiona «Iniciar todo» (o «Start All») para encender MySQL.');
    } else if (e.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('      El usuario o la contraseña de MySQL no coinciden: revisa DB_USER y DB_PASSWORD en el archivo .env.');
    } else {
      console.error(`      Detalle: ${e.message}`);
    }
    process.exit(1);
  }

  // Se omiten los adaptadores virtuales (Hyper-V, WSL, VirtualBox, VMware): no sirven para entrar desde otra computadora
  const ips = Object.entries(os.networkInterfaces())
    .filter(([nombre]) => !/vethernet|virtualbox|vmware|wsl|loopback|hyper-v/i.test(nombre))
    .flatMap(([, lista]) => lista)
    .filter((i) => i.family === 'IPv4' && !i.internal && !i.address.startsWith('169.254.'))
    .map((i) => i.address);
  console.log('  [OK] MySQL encendido.\n');
  console.log(`  En esta computadora entra a:        http://localhost:${config.puerto}`);
  for (const ip of ips) console.log(`  Desde otras computadoras de la red:  http://${ip}:${config.puerto}`);
  console.log('\n  No cierres esta ventana mientras se use el sistema.\n');
})();
