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
| **Administrador** | Además de su rol: usuarios, datos del consultorio, bitácora y archivar expedientes. |

Los expedientes no se borran, solo se archivan, porque la NOM-004-SSA3-2012 pide conservarlos al menos 5 años. Las recetas, órdenes y certificados emitidos tampoco se modifican.

## Instalación (Windows con Laragon)

1. Instala [Node.js 20 o superior](https://nodejs.org) y enciende **MySQL** en Laragon.
2. En la carpeta del proyecto:
   ```bash
   npm install
   copy .env.example .env
   ```
3. Edita `.env`:
   - Pon una cadena larga y aleatoria en `SESSION_SECRET`.
   - Cambia `ADMIN_PASSWORD`.
   - Laragon usa `root` sin contraseña. Si tu MySQL es distinto, ajusta `DB_*`.
4. Arranca con `npm start` o con doble clic en `iniciar.bat`, y abre http://localhost:3100.

En el primer arranque se crean solos la base de datos `consultorio`, sus tablas y el usuario administrador (`ADMIN_USUARIO` / `ADMIN_PASSWORD`).

**Primeros pasos:**
1. Entra como `admin` y, en **Mi cuenta**, cambia la contraseña y captura tu nombre y tu cédula profesional.
2. En **Administración → Datos del consultorio**, captura nombre, dirección, ciudad y teléfono. Salen en el encabezado de todos los documentos.
3. En **Administración → Usuarios**, da de alta a los demás médicos y asistentes.

### Usarlo desde otras computadoras de la red

Las demás PCs y tabletas abren `http://IP-DE-ESTA-PC:3100`. Si no conectan, permite el puerto 3100 en el Firewall de Windows.

## Respaldos

Respalda **las dos cosas**: la base de datos y la carpeta de archivos adjuntos.

```bash
# Base de datos (desde la carpeta bin de MySQL de Laragon)
mysqldump -uroot --single-transaction consultorio > consultorio-AAAAMMDD.sql
```

Además copia la carpeta `uploads/` (o la que indique `UPLOADS_DIR`).

## Estructura

```
src/
  server.js       arranque, sesiones (guardadas en MySQL) y rutas
  esquema.js      crea la base, las tablas y el primer administrador
  seguridad.js    sesión, roles, CSRF, encabezados y bitácora
  rutas/          pacientes, consultas, documentos (recetas/órdenes/certificados), agenda, archivos, admin
views/            plantillas EJS (los documentos imprimibles están en recetas/, ordenes/, certificados/)
public/           CSS e íconos
```

## Seguridad

- Contraseñas con bcrypt.
- Sesiones con cookie `httpOnly` que vencen tras 8 horas sin uso.
- Token CSRF en todos los formularios.
- Bloqueo de 5 minutos tras 5 intentos de acceso fallidos.
- Los archivos adjuntos se guardan con nombre aleatorio y solo se aceptan tipos permitidos.

Si se publica fuera de la red local, debe ir detrás de HTTPS.
