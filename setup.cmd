@echo off
rem Nota: mensajes en ASCII a proposito; cmd no maneja bien acentos UTF-8 en lotes.
setlocal EnableExtensions
chcp 65001 >nul
cd /d "%~dp0"
title Platzi Local - preparar entorno

echo.
echo  Platzi Local - preparar entorno
echo  ================================
echo  Verifico lo necesario para descargar tus cursos y verlos sin conexion.
echo.

set "PENDIENTE="

rem ----- Python -----
where python >nul 2>nul
if errorlevel 1 (
  echo  [x] Python no esta en el PATH. Instalalo desde https://www.python.org/downloads/
  set "PENDIENTE=1"
) else (
  for /f "delims=" %%v in ('python --version 2^>^&1') do echo  [ok] %%v
)

rem ----- CLI platzi -----
where platzi >nul 2>nul
if errorlevel 1 (
  echo  [x] No encontre el CLI "platzi". Instalalo con:
  echo        pip install -U platzi
  echo      o, si usas uv:  uv tool install platzi
  set "PENDIENTE=1"
) else (
  platzi --help >nul 2>nul
  if errorlevel 1 (
    echo  [!] El comando platzi existe pero no responde. Reinstalalo:
    echo        pip install -U platzi
  ) else (
    echo  [ok] CLI platzi
  )
)

rem ----- ffmpeg -----
where ffmpeg >nul 2>nul
if errorlevel 1 (
  echo  [!] Falta ffmpeg, lo usa el CLI para unir los segmentos de video.
  echo      Windows:  scoop install ffmpeg   o   choco install ffmpeg
) else (
  echo  [ok] ffmpeg
)

rem ----- Playwright -----
python -c "import playwright" >nul 2>nul
if errorlevel 1 (
  echo  [!] Playwright no esta disponible para este Python; los scripts del catalogo lo usan:
  echo        pip install playwright
  echo        playwright install chromium
) else (
  echo  [ok] Playwright
)

rem ----- Sesion -----
if exist "%LOCALAPPDATA%\Platzi\Platzi\state.json" (
  echo  [ok] Sesion de Platzi guardada
) else (
  echo  [x] No hay sesion de Platzi. Inicia sesion con tu cuenta:
  echo        platzi login
  set "PENDIENTE=1"
)

rem ----- Catalogo -----
set "CATALOGO=1"
if not exist "scripts\cursos_progreso.json" set "CATALOGO="
if not exist "scripts\rutas.json" set "CATALOGO="
if not exist "scripts\certificados.json" set "CATALOGO="
if not exist "viewer\data.js" set "CATALOGO="
if defined CATALOGO (
  echo  [ok] Catalogo de tu cuenta
) else (
  echo  [x] Falta tu catalogo; generalo con tu sesion:
  echo        python scripts\platzi_cursos.py
  echo        python scripts\platzi_rutas.py
  echo        python scripts\platzi_certificados.py
  echo        python scripts\viewer_data.py
  set "PENDIENTE=1"
)

echo.
if defined PENDIENTE (
  echo  Quedan pendientes de arriba. El detalle esta en README.md ^> "Empezar de cero".
  echo.
)

set /p "LANZAR=  Arrancar el visor ahora? [s/N] "
if /i "%LANZAR%"=="s" goto :lanzar
echo  Cuando quieras:  viewer\start.cmd
goto :fin

:lanzar
echo  Abriendo el visor...
start "" "%~dp0viewer\start.cmd"

:fin
echo.
pause
endlocal
