# Platzi Local

Visor web offline de los cursos descargados de Platzi, con la cola de descargas gestionada desde el propio navegador. Reconstruye la experiencia de platzi.com (inicio, rutas, cursos, aula) sin internet, con subtítulos y progreso local.

## Base

Este proyecto se apoya en el CLI **[`platzi`](https://github.com/ivansaul/platzi-downloader)** de [ivansaul/platzi-downloader](https://github.com/ivansaul/platzi-downloader) (MIT): es quien hace las descargas (Playwright + ffmpeg). Lo que añade este repo es el visor offline y la gestión de la cola desde el navegador.

## Empezar de cero (con tu cuenta)

Requisitos: Windows con **Python 3.9+**, **ffmpeg** en el PATH (lo usa el CLI) y navegador para el login.

1. Instala el CLI (una sola vez).

   **Si usas Python 3.9 en Windows**, ejecuta estos comandos juntos para evitar que `pip` intente compilar `greenlet` con Visual Studio:

   ```bat
   python -m pip install --upgrade pip
   python -m pip install --upgrade --only-binary=greenlet "greenlet==3.2.4" platzi
   ```

   En otras versiones de Python puedes usar:

   ```bat
   python -m pip install --upgrade platzi
   ```

   (también vale `uv tool install platzi` o `pipx install platzi`, si esos entornos usan una versión de Python compatible). Instala el navegador de Playwright con el mismo Python:

   ```bat
   python -m playwright install chromium
   ```

   **Por qué existe el paso especial:** `greenlet 3.2.5` no publica ruedas binarias para Windows/Python 3.9; sin fijar la versión, `pip` intenta compilar C++ y puede fallar con compiladores antiguos como Visual Studio 2017. `greenlet 3.2.4` sí publica la rueda de Windows para Python 3.9.

2. Inicia sesión con **tu** cuenta:

   ```
   platzi login
   ```

   Abre el navegador, te autenticas y la sesión queda guardada en `%LOCALAPPDATA%\Platzi\Platzi\state.json`.

3. Dependencias de los scripts del visor (solo si instalaste el CLI aislado con uv/pipx):

   En Python 3.9 sobre Windows, mantén también la versión de `greenlet` fijada:

   ```bat
   python -m pip install --only-binary=greenlet "greenlet==3.2.4" playwright
   ```

   En Python 3.10 o superior:

   ```bat
   python -m pip install playwright
   ```

4. Genera **tu** catálogo (una vez, y de nuevo cuando tu cuenta cambie):

   ```bat
   python scripts\platzi_cursos.py
   python scripts\platzi_rutas.py
   python scripts\platzi_certificados.py
   python scripts\viewer_data.py
   ```

5. Arranca el visor:

   ```bat
   viewer\start.cmd
   ```

   Se abre `http://localhost:8787/viewer/`.

6. Descarga desde el visor: pestaña **Descargas** → **Mis rutas → Descargar N**, o **Añadir un curso**. También directo con el CLI:

   ```
   platzi download https://platzi.com/cursos/<slug>/
   ```

Puedes saltarte la lectura con **`setup.cmd`**: verifica Python, el CLI, ffmpeg, Playwright, la sesión y tu catálogo, y te dice exactamente qué falta.

> Los JSON de `scripts\` (progreso, rutas, certificados) y `viewer\data.js` son de la cuenta que los generó. Si clonas el repo, haz el paso 4 con tu sesión.

## Estructura

```
.
├── Courses/                 Cursos descargados (mp4 + .vtt). No se versiona.
├── viewer/                  Visor estático: HTML/CSS/JS vanilla, sin build.
│   ├── index.html
│   ├── data.js              Catálogo generado por scripts/viewer_data.py
│   ├── start.cmd            Servidor local en http://localhost:8787/viewer/
│   └── assets/              Portadas de cursos y rutas
├── scripts/
│   ├── server.py            Servidor local + API de la cola de descargas
│   ├── download_queue.ps1   Descarga la cola con el CLI `platzi` (lote)
│   ├── build_queue.py       Cruza progreso, certificados y rutas para armar la cola
│   ├── plan_expansion.py    Propone cursos nuevos según afinidad de rutas
│   ├── viewer_data.py       Regenera viewer/data.js desde los JSON
│   ├── catalog_db.py        Almacén y consultas SQLite del catálogo público
│   ├── sync_public_catalog.py Sincroniza cursos recientes, catálogo y rutas públicas
│   ├── platzi_*.py          Scrapers de cursos, rutas, certificados y portadas
│   ├── sondeos/             Respuestas crudas y planes ya procesados (histórico)
│   └── *.json               Estado: cola, progreso, certificados, catálogo
├── logs/                    Logs de descarga. No se versiona.
├── setup.cmd                Verifica el entorno y guía la puesta en marcha
└── PRODUCT.md               Brief del producto
```

## Explorar el catálogo público

La vista **Explorar** consulta una caché SQLite local del catálogo público de Platzi. La primera sincronización y las actualizaciones se lanzan desde esa vista con **Actualizar catálogo público**: se leen el catálogo general, los lanzamientos y las rutas públicas. La sincronización puede abrir una ventana de Chromium y requiere internet; no descarga vídeos.

El buscador combina cursos y clases de tu biblioteca con los cursos públicos guardados en SQLite. Los cursos de tu biblioteca mantienen la ficha y el progreso locales; los que solo aparecen en el catálogo público abren la página oficial de Platzi. La caché no se versiona y se reconstruye por instalación.

Para sincronizar manualmente, ejecuta **python scripts\sync_public_catalog.py** desde la raíz con Playwright y Chromium instalados. Si no hay conexión o todavía no se sincronizó, tus cursos descargados siguen funcionando offline; las novedades públicas y cursos ajenos a tu biblioteca necesitan una caché previa o internet.

## Usar el visor

```
viewer\start.cmd
```

Abre `http://localhost:8787/viewer/`. El servidor se lanza desde la raíz para que el visor pueda leer `Courses/`.

La pestaña **Descargas** gestiona la cola desde el propio visor: traer los pendientes de una ruta, añadir cursos sueltos, reordenar, cancelar y ver el progreso. Solo funciona con este servidor (`file://` muestra el visor en modo lectura).

> No ejecutes `download_queue.ps1` mientras la cola del visor está activa: ambas lanzan el mismo CLI sobre los mismos cursos.

## Regenerar el catálogo

```
python scripts\viewer_data.py
```

Se ejecuta después de descargar cursos nuevos. Lee `Courses/` y los JSON de `scripts/`, y reescribe `viewer/data.js`. También puedes lanzarlo desde **Descargas → Actualizar catálogo** cuando la cola esté vacía.

## Reanudar descargas

Desde el visor: **Descargas → Mis rutas → Descargar N**, o busca un curso suelto y añádelo. La cola es en orden, de a un curso por vez.

Para el lote histórico (la cola de `scripts/cola_descarga.json`):

```powershell
# Toda la cola sin certificados
pwsh -File scripts\download_queue.ps1

# Solo slugs concretos, para reanudar desde donde quedó
pwsh -File scripts\download_queue.ps1 -Slugs ingenieria,gitgithub,gemini
```

El script corta la cola tras dos fallos consecutivos para no insistir sobre una sesión caída.

## ¿Usa IA?

No. Nada de modelos ni claves: descargar, generar el catálogo y estudiar funciona 100% local (el único servicio externo es la propia sesión de Platzi del CLI).

**Con un agente.** También puedes pedirle a un agente de IA (opencode, Claude, etc.) que te lo deje listo. Ábrele este repo y dile algo como:

> Sigue `AGENTS.md` y `README.md` para instalar el CLI, iniciar mi sesión y dejarme el visor arrancado.

`AGENTS.md` resume para agentes los comandos, la arquitectura y las reglas del proyecto.

## Qué se versiona

El código, los scripts, el catálogo (`viewer/assets/`), `viewer/data.js` y el estado de la cola. `Courses/`, `logs/` y `scripts/download_state.json` (runtime) quedan fuera.
