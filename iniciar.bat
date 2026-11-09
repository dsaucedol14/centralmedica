@echo off
rem Arranca el consultorio y abre el navegador. Requiere MySQL encendido en Laragon.
cd /d "%~dp0"
if not exist node_modules call npm install
if not exist .env copy .env.example .env >nul
start "" http://localhost:3100
node src\server.js
pause
