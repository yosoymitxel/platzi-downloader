# Platzi Local

Visor web offline de los cursos descargados de Platzi. Reconstruye la experiencia de platzi.com (inicio, rutas, cursos, aula) sin internet, con subtítulos y progreso local.

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
│   ├── platzi_*.py          Scrapers de cursos, rutas, certificados y portadas
│   ├── sondeos/             Respuestas crudas y planes ya procesados (histórico)
│   └── *.json               Estado: cola, progreso, certificados, catálogo
├── logs/                    Logs de descarga. No se versiona.
└── PRODUCT.md               Brief del producto
```

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

Desde el visor: **Descargas → Mis rutas → Descargar pendientes**, o busca un curso suelto y añádelo. La cola es en orden, de a un curso por vez.

Para el lote histórico (la cola de `scripts/cola_descarga.json`):

```
# Toda la cola sin certificados
pwsh -File scripts\download_queue.ps1

# Solo slugs concretos, para reanudar desde donde quedó
pwsh -File scripts\download_queue.ps1 -Slugs ingenieria,gitgithub,gemini
```

El script corta la cola tras dos fallos consecutivos para no insistir sobre una sesión caída.

## Qué se versiona

El código, los scripts, el catálogo (`viewer/assets/`) y el estado de la cola. `Courses/` y `logs/` quedan fuera por peso. El detalle del visor está en `viewer/README.md`.
