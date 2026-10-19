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
│   ├── download_queue.ps1   Descarga la cola con el CLI `platzi`
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

## Regenerar el catálogo

```
python scripts\viewer_data.py
```

Se ejecuta después de descargar cursos nuevos. Lee `Courses/` y los JSON de `scripts/`, y reescribe `viewer/data.js`.

## Reanudar descargas

La cola vive en `scripts/cola_descarga.json`. El último log (`logs/download_queue_20261018_132408.log`) se cortó en el curso 14 de 100, en el curso de Fundamentos de Ingeniería de Software.

```
# Toda la cola sin certificados
pwsh -File scripts\download_queue.ps1

# Solo slugs concretos, para reanudar desde donde quedó
pwsh -File scripts\download_queue.ps1 -Slugs ingenieria,gitgithub,gemini
```

El script corta la cola tras dos fallos consecutivos para no insistir sobre una sesión caída.

## Qué se versiona

El código, los scripts, el catálogo (`viewer/assets/`) y el estado de la cola. `Courses/` y `logs/` quedan fuera por peso. El detalle del visor está en `viewer/README.md`.
