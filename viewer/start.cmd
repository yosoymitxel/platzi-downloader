@echo off
rem Platzi Local - arranca el visor y la cola de descargas
cd /d "%~dp0.."

where python >nul 2>nul
if errorlevel 1 (
    echo Se necesita Python en el PATH para servir el visor.
    echo Alternativa: abre viewer\index.html directamente ^(sin descargas^).
    pause
    exit /b 1
)

start "" powershell -NoProfile -Command "Start-Sleep -Milliseconds 1200; Start-Process 'http://localhost:8787/viewer/'"
echo Sirviendo Platzi Local en http://localhost:8787/viewer/   (Ctrl+C para detener)
python scripts\server.py
if errorlevel 1 pause
