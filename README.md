# Consultorio

Sistema web para administrar los expedientes clínicos de un consultorio médico. Es multiusuario y todos los usuarios trabajan sobre los mismos expedientes. Hecho con Node.js, Express y MySQL.

## Qué hace

- **Pacientes:** número de expediente automático. Se busca por nombre (sin importar acentos), expediente, CURP o teléfono. Las alergias aparecen resaltadas en todo el expediente y en las recetas.
- **Historia clínica:** antecedentes heredofamiliares, personales patológicos y no patológicos, gineco-obstétricos, quirúrgicos, medicamentos actuales e inmunizaciones.
- **Consultas (nota médica):**
  - Registra motivo, padecimiento actual, signos vitales con IMC automático, exploración física, diagnóstico con clave CIE-10, plan y pronóstico.
  - Se imprime como nota médica.
  - Solo el médico que hizo la consulta puede corregirla.
- **Recetas:**
  - Media carta horizontal con folio consecutivo por año (`R-2026-0001`).
  - Imprime los datos del médico y del consultorio, edad, alergias, signos de la consulta, los medicamentos con presentación, dosis, vía, frecuencia y duración, e indicaciones generales.
  - Botón «Repetir» para copiar una receta anterior.
- **Órdenes de estudio:** laboratorio, gabinete u otros, con un catálogo de estudios frecuentes y texto libre. Folio `OE-2026-0001`.
- **Certificados médicos:** buena salud, incapacidad o reposo (calcula la fecha de término) y constancia de asistencia. El texto se redacta solo con los datos del paciente y del médico, y queda fijo al emitirlo. Folio `C-2026-0001`.
- **Agenda:**
  - Vista semanal por médico o de todos.
  - Detecta citas empalmadas.
  - Acepta citas de primera vez sin expediente.
  - Estados de la cita: programada, confirmada, atendida, cancelada y no asistió.
  - Con el botón «Atender» se abre la consulta y la cita queda como atendida.
- **Archivos:** PDF, imágenes y documentos de Office (hasta 20 MB cada uno) adjuntos al expediente. Se guardan fuera de la carpeta pública y solo se ven con sesión iniciada.
- **Bitácora:** registra quién entró, vio, creó o modificó cada expediente.

## Usuarios

| Rol | Puede |
|---|---|
| **Médico** | Todo lo clínico: consultas, historia clínica, recetas, órdenes y certificados con su nombre y cédula. |
| **Asistente** | Dar de alta y editar pacientes, manejar la agenda, subir archivos, y ver y reimprimir cualquier documento. No receta ni registra consultas. |
| **Recepción** | Solo el módulo de Recepción: buscar o registrar pacientes (datos generales) y enviarlos a consulta. No ve expedientes. |
| **Administrador** | Además de su rol: usuarios, datos del consultorio, bitácora, respaldos y archivar expedientes. |

Los expedientes no se borran, solo se archivan, porque la NOM-004-SSA3-2012 pide conservarlos al menos 5 años. Las recetas y certificados emitidos no se modifican; las órdenes de estudio las puede modificar o eliminar el médico que las emitió o un administrador (queda en la bitácora).

Otros módulos: **Recepción y sala de espera** (el médico recibe un aviso con los datos generales del paciente que le envía recepción), **días bloqueados** en la agenda de cada médico, **respaldos** desde el propio sistema y **manual de usuario** en el menú *Ayuda*.

## Instalación (Windows con Laragon)

La guía completa, paso a paso y sin tecnicismos, está en **[INSTALACION.md](INSTALACION.md)**. En resumen:

1. Instala [Node.js 20 o superior](https://nodejs.org) y enciende **MySQL** en Laragon.
2. Doble clic en `iniciar.bat`. Revisa la versión de Node y que MySQL responda, instala los componentes, crea el `.env` (con una `SESSION_SECRET` aleatoria) y abre http://localhost:3100.
3. Laragon usa `root` sin contraseña. Si tu MySQL es distinto, ajusta `DB_*` en `.env`.

En el primer arranque se crean solos la base de datos `consultorio`, sus tablas y el usuario administrador (`ADMIN_USUARIO` / `ADMIN_PASSWORD`).

**Primeros pasos:**
1. Entra como `admin` y, en **Mi cuenta**, cambia la contraseña y captura tu nombre y tu cédula profesional.
2. En **Administración → Datos del consultorio**, captura nombre, dirección, ciudad y teléfono. Salen en el encabezado de todos los documentos.
3. En **Administración → Usuarios**, da de alta a los demás médicos y asistentes.

### Usarlo desde otras computadoras de la red

Las demás PCs y tabletas abren `http://IP-DE-ESTA-PC:3100` (`iniciar.bat` muestra la dirección al arrancar). Si no conectan, permite el puerto 3100 en el Firewall de Windows (ver [INSTALACION.md](INSTALACION.md#81-abrir-el-puerto-en-el-firewall-de-windows)).

## Respaldos

En **Administración → Respaldos** se genera un `.zip` con la base de datos (`base-de-datos.sql`, utilizable por separado con MySQL) y, opcionalmente, los archivos adjuntos. Desde ahí también se descargan, se importan y se restauran; antes de restaurar se guarda solo un respaldo de seguridad y, si la restauración falla, se regresa sola al estado anterior. Los respaldos se guardan en `respaldos/` (o la carpeta de `RESPALDOS_DIR`).

## Estructura

```
src/
  server.js       arranque, sesiones (guardadas en MySQL) y rutas
  esquema.js      crea la base, las tablas y el primer administrador
  seguridad.js    sesión, roles, CSRF, encabezados y bitácora
  respaldo.js     generar, leer, importar y restaurar respaldos
  rutas/          pacientes, consultas, documentos (recetas/órdenes/certificados), agenda, archivos,
                  recepcion, sala (sala de espera y avisos), respaldos, admin
views/            plantillas EJS (los documentos imprimibles están en recetas/, ordenes/, certificados/;
                  el manual de usuario en ayuda.ejs)
public/           CSS, logo e íconos
scripts/          preparar.js: revisión previa al arranque que usa iniciar.bat
```

## Seguridad

- Contraseñas con bcrypt.
- Sesiones con cookie `httpOnly` que vencen tras 8 horas sin uso.
- Token CSRF en todos los formularios.
- Bloqueo de 5 minutos tras 5 intentos de acceso fallidos.
- Los archivos adjuntos se guardan con nombre aleatorio y solo se aceptan tipos permitidos.

Si se publica fuera de la red local, debe ir detrás de HTTPS.
