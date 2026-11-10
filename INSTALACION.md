# Guía de instalación de Central Médica en una computadora con Laragon

Esta guía explica, paso a paso, cómo dejar funcionando el sistema de expedientes clínicos en la computadora que hará de **servidor** del consultorio: la que guarda la información y a la que se conectan las demás. No necesitas ser experto en computación; sigue los pasos en orden.

> **Tiempo aproximado:** 30 a 45 minutos la primera vez.
> **Necesitas:** una computadora con Windows 10 u 11, conexión a internet durante la instalación y permisos de administrador.

---

## 1. Elegir la computadora servidor

- Debe quedarse **encendida** mientras se atiende en el consultorio.
- De preferencia conéctala por **cable de red** y a un **no-break** (UPS) para que un apagón no la apague de golpe.
- Que no sea la computadora que todos usan para navegar en internet o jugar.

## 2. Instalar Laragon (incluye MySQL, la base de datos)

1. Descarga **Laragon Full** desde https://laragon.org/download/ e instálalo con las opciones que trae.
2. Abre Laragon y presiona **Iniciar todo** (*Start All*). El botón de **MySQL** debe ponerse en verde.
3. En el menú de Laragon (clic derecho sobre su ventana) → **Preferencias** → pestaña **General**, activa:
   - **Ejecutar Laragon al iniciar Windows**.
   - **Iniciar todo automáticamente**.

## 3. Instalar Node.js

1. Descarga la versión **LTS** desde https://nodejs.org (el botón grande de la izquierda).
2. Instálala con las opciones que trae (siguiente, siguiente, finalizar).

> Laragon trae su propio Node.js, pero suele ser una versión vieja. El sistema necesita la **20 o más nueva**; si tienes una menor, el archivo de arranque te lo avisa.

## 4. Copiar el sistema a la computadora

Elige **una** de estas dos formas:

- **Con Git** (recomendado, facilita actualizar después). Abre la **Terminal** de Laragon y escribe:
  ```
  cd C:\laragon\www
  git clone https://github.com/dsaucedol14/centralmedica.git
  ```
- **Sin Git:** en https://github.com/dsaucedol14/centralmedica presiona **Code → Download ZIP** y descomprime la carpeta en `C:\laragon\www\centralmedica`.

> El repositorio es privado: para descargarlo debes iniciar sesión en GitHub con una cuenta que tenga acceso.

## 5. Arrancar por primera vez

1. Abre la carpeta `C:\laragon\www\centralmedica`.
2. Da **doble clic en `iniciar.bat`**.
3. La primera vez tarda unos minutos porque descarga sus componentes. Verás algo así:
   ```
   [OK] MySQL encendido.
   En esta computadora entra a:        http://localhost:3100
   Desde otras computadoras de la red:  http://192.168.0.62:3100
   ```
4. Se abre el navegador solo. Entra con:
   - **Usuario:** `admin`
   - **Contraseña:** `consultorio-dev`

> **No cierres la ventana negra** mientras se use el sistema: si la cierras, el sistema se apaga.

Si aparece un mensaje con **[X]**, ve a la sección [Problemas frecuentes](#10-problemas-frecuentes).

## 6. Primeros ajustes (5 minutos)

1. **Cambia la contraseña del administrador:** clic en tu nombre (arriba a la derecha) → **Mi cuenta** → **Cambiar contraseña**.
2. **Datos del consultorio:** **Administración → Datos del consultorio**: nombre, dirección, ciudad y teléfono. Salen impresos en recetas y documentos.
3. **Usuarios:** **Administración → Usuarios → + Nuevo usuario** para cada médico, asistente y recepcionista. A los médicos captúrales su cédula, especialidad y universidad.

## 7. Pasar la información de la computadora anterior

Si el sistema ya funcionaba en otra computadora, pásale toda su información (pacientes, consultas, usuarios y archivos):

1. En la **computadora anterior**: **Administración → Respaldos**, deja marcada la casilla de archivos adjuntos y presiona **Generar respaldo**. Luego **Descargar** y copia el archivo `.zip` a una memoria USB.
2. En la **computadora nueva**: **Administración → Respaldos → Importar un respaldo**, elige el `.zip` de la memoria y presiona **Importar**.
3. En la lista, junto a ese respaldo, presiona **Restaurar…**, escribe `RESTAURAR` y tu contraseña.
4. Al terminar, inicia sesión con los usuarios y contraseñas **de la computadora anterior**.

## 8. Que lo usen las demás computadoras del consultorio

### 8.1 Abrir el puerto en el Firewall de Windows

En la computadora servidor, busca **Símbolo del sistema**, dale clic derecho → **Ejecutar como administrador**, y escribe:

```
netsh advfirewall firewall add rule name="Central Medica" dir=in action=allow protocol=TCP localport=3100 profile=private
```

> Esto permite la entrada solo desde la red **privada** del consultorio. Asegúrate de que la red de Windows esté marcada como **Privada** (Configuración → Red e internet → tu conexión → *Tipo de perfil de red: Privada*).

### 8.2 Entrar desde otra computadora, tableta o celular

En el navegador de la otra computadora escribe la dirección que muestra la ventana negra, por ejemplo `http://192.168.0.62:3100`. Guárdala en favoritos.

> Si la ventana muestra varias direcciones, usa la de tu red (normalmente empieza con `192.168.0.` o `192.168.1.`).

### 8.3 Que la dirección no cambie

El módem o router puede cambiarle la dirección a la computadora servidor al reiniciarse. Para evitarlo, pide a quien administra tu internet que le **reserve una IP fija** (en el router se llama *reserva DHCP* o *IP estática*).

## 9. Que arranque solo al prender la computadora

1. Presiona **Windows + R**, escribe `shell:startup` y presiona Enter. Se abre la carpeta *Inicio*.
2. En otra ventana abre `C:\laragon\www\centralmedica`, da clic derecho en `iniciar.bat` → **Mostrar más opciones → Crear acceso directo**.
3. Arrastra ese acceso directo a la carpeta *Inicio*.

Así, al iniciar sesión en Windows, Laragon enciende MySQL y el sistema arranca solo. Si MySQL tarda en encender, la ventana muestra «Esperando a que MySQL encienda…» y espera hasta un minuto.

## 10. Problemas frecuentes

| Mensaje o situación | Qué hacer |
|---|---|
| **[X] No se encontró Node.js** | Instala Node.js (paso 3) y vuelve a abrir `iniciar.bat`. |
| **[X] Tienes Node.js v18… se necesita la 20** | Instala la versión LTS de https://nodejs.org (paso 3). |
| **[X] No se pudo conectar con MySQL** | Abre Laragon y presiona **Iniciar todo**. Espera a que MySQL esté en verde y vuelve a abrir `iniciar.bat`. |
| **[X] No se pudieron instalar los componentes** | Revisa que haya internet y vuelve a intentar. |
| `EADDRINUSE` o «puerto en uso» | El sistema ya está abierto en otra ventana negra. Ciérrala o usa esa. |
| Otras computadoras no pueden entrar | Revisa el paso 8.1 (firewall), que estén en la misma red y que uses la dirección correcta (paso 8.2). |
| Olvidaste la contraseña de admin | Otro administrador puede asignarte una nueva en **Administración → Usuarios**. |

## 11. Respaldos: no lo olvides

Toda la información del consultorio vive en esta computadora. **Genera un respaldo al menos cada semana** en **Administración → Respaldos** y guarda una copia **fuera de la computadora** (memoria USB, disco externo o nube). El manual del sistema (**Ayuda → Respaldos**) lo explica paso a paso.

## 12. Actualizar el sistema a una versión nueva

1. Genera un respaldo (sección 11).
2. Cierra la ventana negra del sistema.
3. Si lo instalaste **con Git**, abre la Terminal de Laragon y escribe:
   ```
   cd C:\laragon\www\centralmedica
   git pull
   npm install --omit=dev
   ```
   Si lo instalaste **con ZIP**, descarga el nuevo ZIP y copia sus archivos encima de la carpeta, **sin borrar** el archivo `.env` ni las carpetas `uploads` y `respaldos`.
4. Abre de nuevo `iniciar.bat`. Los cambios a la base de datos se aplican solos.

---

### Datos técnicos (para el encargado de sistemas)

- **Configuración:** archivo `.env` (se crea solo la primera vez a partir de `.env.example`, con una `SESSION_SECRET` aleatoria). Ahí se cambian el puerto (`PORT`), la conexión a MySQL (`DB_*`) y las carpetas de adjuntos y respaldos.
- **Base de datos:** `consultorio` en el MySQL de Laragon (`root` sin contraseña por omisión). Las tablas se crean y actualizan solas al arrancar.
- **Carpetas que no se deben borrar:** `uploads/` (archivos de los pacientes) y `respaldos/`. Ninguna se sube a GitHub.
- **Fuera de la red local:** si algún día se publica en internet, debe ir detrás de HTTPS (por ejemplo, con un proxy inverso) y nunca exponer el puerto 3100 directamente.
