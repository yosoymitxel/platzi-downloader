# Platzi Local — visor offline

Visor web local para estudiar los cursos de Platzi descargados en `Courses/` con una experiencia parecida a la de platzi.com: rutas, cursos, módulos, clases, reproductor con subtítulos y progreso local.

## Arranque

1. Doble clic en **`start.cmd`** → lanza `scripts\server.py` y abre `http://localhost:8787/viewer/` (requiere Python en el PATH).
2. Alternativa sin servidor: abrir `viewer\index.html` directamente. Todo funciona **excepto los subtítulos** (el navegador bloquea `.vtt` en `file://`) y la pestaña **Descargas** (modo lectura), verás un aviso.

El servidor es solo local (`127.0.0.1`): sirve el visor, la carpeta `Courses\` y una API en `/api/*` para la cola de descargas.

## Requisitos de datos

`viewer\data.js` es generado — no se edita a mano. Para (re)generarlo cuando haya cursos nuevos descargados:

```
python scripts\viewer_data.py
```

(lee `Courses\` + los JSON de `scripts\`; la primera vez descarga las portadas a `viewer\assets\`).

## Cómo funciona

- El visor es estático: `index.html` + `styles.css` + `app.js` + `data.js`. Sin frameworks, sin CDN, sin build.
- El **progreso** (visto + posición de cada clase, velocidad, subtítulos) se guarda en `localStorage` del navegador (clave `platziLocal.v1`). El estado de Platzi descargado se muestra solo como historial de referencia.
- La búsqueda indexa cursos y clases en el cliente.
- La pestaña **Descargas** habla con `scripts/server.py` (cola persistida en `scripts/download_state.json`, un curso a la vez, progreso por clase). "Actualizar catálogo" ejecuta `viewer_data.py` cuando la cola está vacía.

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

## Problemas comunes

- **No aparecen los subtítulos** → estás en `file://`; usa `start.cmd`.
- **Faltan portadas** → vuelve a ejecutar `python scripts\viewer_data.py` (o ignóralas: hay fallback tipográfico).
- **Un curso recién descargado no aparece completo** → regenera `data.js`.
