@echo off
rem Platzi Local - arranca el visor con un servidor local (recomendado: subtitulos + localStorage)
cd /d "%~dp0.."

where python >nul 2>nul
if errorlevel 1 (
    echo Se necesita Python en el PATH para servir el visor.
    echo Alternativa: abre viewer\index.html directamente ^(sin subtitulos^).
    pause
    exit /b 1
)

start "" powershell -NoProfile -Command "Start-Sleep -Milliseconds 1200; Start-Process 'http://localhost:8787/viewer/'"
echo Sirviendo Platzi Local en http://localhost:8787/viewer/   (Ctrl+C para detener)
python -m http.server 8787 --bind 127.0.0.1
