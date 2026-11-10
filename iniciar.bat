@echo off
chcp 65001 >nul
title Central Medica
cd /d "%~dp0"
echo.
echo   ==============================
echo     CENTRAL MEDICA - Expedientes
echo   ==============================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo   [X] No se encontro Node.js.
  echo       Instala la version LTS desde https://nodejs.org y vuelve a abrir este archivo.
  goto fin
)
node -e "process.exit(+process.versions.node.split('.')[0] >= 20 ? 0 : 1)"
if errorlevel 1 (
  for /f %%v in ('node -v') do echo   [X] Tienes Node.js %%v y se necesita la version 20 o superior.
  echo       Instala la version LTS desde https://nodejs.org y vuelve a abrir este archivo.
  goto fin
)

if not exist node_modules (
  echo   Instalando componentes por primera vez; tarda unos minutos y necesita internet...
  call npm install --omit=dev
  if errorlevel 1 (
    echo   [X] No se pudieron instalar los componentes. Revisa la conexion a internet.
    goto fin
  )
)

node scripts\preparar.js
if errorlevel 1 goto fin

start "" cmd /c "timeout /t 4 >nul & start http://localhost:3100"
node src\server.js
echo.
echo   [X] El sistema se detuvo. Revisa el mensaje de arriba.

:fin
echo.
pause
