# Platzi Local — visor offline

Visor web local para estudiar los cursos de Platzi descargados en `Courses/` con una experiencia parecida a la de platzi.com: rutas, cursos, módulos, clases, reproductor con subtítulos y progreso local.

Las descargas las hace el CLI [`platzi`](https://github.com/ivansaul/platzi-downloader) (repo base, MIT): este visor y la gestión de la cola son lo que añade Platzi Local. El catálogo es de la cuenta que lo generó — la puesta en marcha completa desde cero está en el `README.md` de la raíz.

## Arranque

1. Doble clic en **`start.cmd`** → lanza `scripts\server.py` y abre `http://localhost:8787/viewer/` (requiere Python en el PATH).
2. Alternativa sin servidor: abrir `viewer\index.html` directamente. Todo funciona **excepto los subtítulos** (el navegador bloquea `.vtt` en `file://`) y la pestaña **Descargas** (modo lectura), verás un aviso. En ese modo el aula usa los controles nativos del navegador.

El servidor es solo local (`127.0.0.1`): sirve el visor, la carpeta `Courses\` y una API en `/api/*` para la cola de descargas y el catálogo público SQLite.

## Requisitos de datos

`viewer\data.js` es generado — no se edita a mano. Para (re)generarlo cuando haya cursos nuevos descargados:

```
python scripts\viewer_data.py
```

(lee `Courses\` + los JSON de `scripts\`; la primera vez descarga las portadas a `viewer\assets\`). Ni los JSON ni `data.js` se versionan como datos de otra cuenta: si clonas el repo, genera los tuyos (ver «Empezar de cero» en el README raíz).

## Explorar y búsqueda pública

La pestaña **Explorar** muestra los últimos cursos de la agenda pública y rutas de Platzi. Usa **Actualizar catálogo público** para sincronizar los metadatos a SQLite; hace falta conexión y puede abrirse una ventana de Chromium. Solo se guardan metadatos, no vídeos.

El buscador global combina las clases y cursos personales con los cursos que estén en la caché pública. Los cursos de la biblioteca abren su ficha local; un resultado que solo existe en el catálogo público abre la página oficial de Platzi en otra pestaña. El catálogo personal, el progreso y la cola no se mezclan con los datos públicos.

## Cómo funciona

- El visor es estático: `index.html` + `styles.css` + `app.js` + `data.js`. Sin frameworks, sin CDN, sin build. El reproductor es **Plyr 3.8.5** (MIT), vendoreado en `viewer/vendor/plyr/`.
- El **progreso** (visto + posición de cada clase, velocidad, subtítulos, volumen) se guarda en `localStorage` del navegador (clave `platziLocal.v1`). El estado de Platzi descargado se muestra solo como historial de referencia.
- La búsqueda indexa cursos y clases personales en el cliente y añade los metadatos públicos guardados en SQLite cuando el servidor local está disponible.
- Los filtros de **Mis cursos** (estado y descarga) se combinan entre sí con «Y»: «En curso» + «Sin descargar» deja solo los cursos que cumplen ambas. Cada ruta repite los mismos filtros sobre sus propios cursos.
- La pestaña **Descargas** habla con `scripts/server.py` (cola persistida en `scripts/download_state.json`, un curso a la vez, progreso por clase). Prioriza lo descargado: «Mis rutas» lista primero las completas y trae los pendientes en un clic; el título de cada ruta abre su ficha. El buscador de cursos incluye los descargados, marcados. En la ficha de un curso sin descargar, **Descargar curso** lo encola y el botón pasa a «En cola» o «Descargando…». Cada ficha guarda el enlace original al curso en Platzi (**Ver en Platzi**). "Actualizar catálogo" ejecuta `viewer_data.py` cuando la cola está vacía.

## Atajos del reproductor

| Tecla | Acción |
|---|---|
| `espacio` / `k` | Play / pausa |
| `←` / `→` | ±5 s |
| `j` / `l` | ±10 s |
| `↑` / `↓` | Volumen |
| `m` | Silenciar |
| `f` | Pantalla completa |
| `c` | Ciclar subtítulos |
| `n` / `p` | Siguiente / anterior clase |

La barra de Plyr, bajo el video, trae play/pausa, progreso, tiempo, volumen, subtítulos, velocidad, PiP y pantalla completa. La fila propia queda con Anterior/Siguiente, Marcar como visto, Subtítulos (idioma) y Autoplay.

## Problemas comunes

- **Al arrancar dice que el puerto ya está en uso** → es el guard: solo puede haber un servidor a la vez (dos workers comparten la cola). Usa el que ya está en `http://localhost:8787/viewer/` o ciérralo antes.
- **No aparecen los subtítulos** → estás en `file://`; usa `start.cmd`. En `file://` el aula también usa los controles nativos porque Plyr se activa con el servidor.
- **Faltan portadas** → vuelve a ejecutar `python scripts\viewer_data.py` (o ignóralas: hay fallback tipográfico).
- **Un curso recién descargado no aparece completo** → regenera `data.js`.
