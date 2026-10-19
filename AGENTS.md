# AGENTS.md

Guía para agentes de IA (opencode, Claude, etc.) que trabajen en **Platzi Local**: visor offline de cursos de Platzi + cola de descargas local.

**Sin IA en runtime.** El producto no usa modelos, claves ni servicios externos nuevos. No agregues telemetría. El único servicio externo es la sesión de Platzi que usa el CLI.

**Base.** El CLI `platzi` viene de [ivansaul/platzi-downloader](https://github.com/ivansaul/platzi-downloader) (MIT). Este repo aporta el visor y la gestión de la cola.

## Poner el proyecto en marcha

Sigue «Empezar de cero» del `README.md`:

1. `pip install -U platzi` (o `uv tool install platzi`) + `playwright install chromium`.
2. `platzi login` (sesión del usuario; queda en `%LOCALAPPDATA%\Platzi\Platzi\state.json`).
3. Catálogo de la cuenta: `python scripts\platzi_cursos.py`, `platzi_rutas.py`, `platzi_certificados.py`, `viewer_data.py`.
4. `viewer\start.cmd` → `http://localhost:8787/viewer/`.

`setup.cmd` verifica todo lo anterior. Si algo falta, no lo instales en silencio: díselo a la persona con el comando exacto.

## Comandos útiles

- Arrancar: `viewer\start.cmd` o `python scripts\server.py` (desde la raíz; sirve `Courses/`).
- Regenerar catálogo: `python scripts\viewer_data.py` (nunca editar `viewer/data.js` a mano).
- Descargar un curso: `platzi download https://platzi.com/cursos/<slug>/`.
- Probar sin descargas reales: `PLATZI_BIN` y `PLATZI_PREFIX` (ver docstring de `scripts/server.py`).
- Lote histórico: `pwsh -File scripts\download_queue.ps1` (solo con la cola del visor vacía).

## Arquitectura

- `viewer/`: estático, sin build. `app.js` es ES5 sin módulos, router por hash (`#/`, `#/rutas`, `#/cursos`, `#/curso/<slug>`, `#/aula/<slug>/<n>`, `#/descargas`). `viewer/SPEC.md` es el contrato de UI; si cambias algo visible, actualízalo. `viewer/README.md` explica el uso.
- `scripts/server.py`: sirve el repo y expone `/api/*` para la cola; un worker secuencial lanza el CLI (sin shell). Estado runtime en `scripts/download_state.json` (ignorado por git).
- `scripts/platzi_*.py`: scrapers del catálogo (Playwright + la sesión del CLI). `scripts/build_queue.py` y `download_queue.ps1`: lote histórico.
- El catálogo se genera por cuenta: los JSON de `scripts\` y `viewer\data.js` son datos del usuario, no constantes del proyecto.

## Reglas

- No commitear `Courses/`, `logs/`, `.tmp/`, `__pycache__/` ni `download_state.json` (ya están en `.gitignore`).
- No debilitar la seguridad de `server.py`: solo `127.0.0.1`, validación de `Origin`/`Host`, `shell=False`, bloqueo de `/scripts/`, `/logs/`, `/.git*/`.
- No correr dos servidores a la vez ni `download_queue.ps1` con la cola del visor activa.
- Al tocar UI o copy en `viewer/`: carga las skills **antislop** (modo `during`) y, si están disponibles, **taste-skill** / **impeccable**; cierra con su Delivery Gate.
- Estilo de la casa: español con acentos, sin emoji, copy congelada en `viewer/SPEC.md` §7. Nada de `innerHTML` con datos dinámicos.
