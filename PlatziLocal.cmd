@echo off
setlocal
cd /d "%~dp0"
:menu
cls
echo ========================================
echo   Platzi Local - menu principal
echo ========================================
echo 1. Iniciar visor (servidor + navegador)
echo 2. Comprobar sesion de Platzi
echo 3. Iniciar sesion (platzi login)
echo 4. Salir
echo.
set /p opc="Elige una opcion (1-4): "
if "%opc%"=="1" goto start
if "%opc%"=="2" goto check
if "%opc%"=="3" goto login
if "%opc%"=="4" goto end
goto menu

:start
call viewer\start.cmd
goto menu

:check
where platzi >nul 2>&1
if errorlevel 1 (
  echo No se encontro 'platzi' en PATH.
  pause
  goto menu
)
python -c "import json,subprocess,sys; cmd=['platzi','download','https://platzi.com/cursos/__platzi_local_probe__/']; r=subprocess.run(cmd,capture_output=True,text=True,timeout=30); out=(r.stdout or '')+(r.stderr or ''); bad='login first' in out.lower(); print('Sesion iniciada.' if not bad else 'Sesion NO iniciada. Ejecuta platzi login.'); print(out.strip()[-300:])"
pause
goto menu

:login
platzi login
pause
goto menu

:end
endlocal