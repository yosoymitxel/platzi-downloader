# SPEC — Visor offline de cursos Platzi

Contrato de construcción del visor local. **Este documento manda.** Tres constructores trabajan en paralelo sobre archivos disjuntos; las interfaces de este SPEC están congeladas:

| Constructor | Archivos (solo estos) |
|---|---|
| UI | `viewer/index.html`, `viewer/styles.css`, `viewer/assets/logo.svg` (+ cualquier SVG inline) |
| Lógica | `viewer/app.js` |
| Datos | `scripts/viewer_data.py` → genera `viewer/data.js`, `viewer/assets/covers/`, `viewer/assets/rutas/` |
| Integrador (sesión principal) | `viewer/start.cmd`, `viewer/README.md`, ajustes de integración |

Objetivo: ver los cursos descargados en `Courses/` con la experiencia más parecida posible a platzi.com, 100% offline, en HTML/CSS/JS vanilla **sin build step ni servicios externos**. El único componente de terceros es Plyr 3.8.5 (MIT), vendoreado en `viewer/vendor/plyr/`.

---

## §1 Arquitectura

- SPA de una sola página con **router por hash**. `index.html` contiene: barra superior estática, `<main id="app">`, un contenedor oculto `#templates` con todos los `<template>`, la hoja `vendor/plyr/plyr.css` y tres scripts al final: `vendor/plyr/plyr.min.js`, `data.js` y `app.js` (los dos últimos `defer` y sin módulos ES para que funcione también en `file://`; Plyr es UMD).
- `app.js` renderiza cada vista clonando su template desde `#templates` y rellenando solo los hooks `[data-slot]` / `[data-list]` definidos en §4. La UI define el markup y las clases; la lógica **nunca** crea markup nuevo salvo: `<track>`s dentro del `<video>`, nodos clonados de partials, e iconos `<svg><use href="#ic-…">` cambiando el `href` del `use`.
- Rutas del router:
  - `#/` → Inicio
  - `#/rutas` → rutas de tu cuenta
  - `#/explorar` → cursos recientes y rutas públicas de Platzi (requiere sincronización online opcional)
  - `#/ruta/<routeId>` → detalle de ruta
  - `#/cursos` → catálogo completo con filtros
  - `#/curso/<slug>` → detalle de curso
  - `#/aula/<slug>/<n>` → reproductor; `n` = índice **aplanado 1-based** de la clase (módulos en orden, luego clases en orden)
  - `#/buscar/<q urlencoded>` → resultados
- Al cambiar de vista: `window.scrollTo(0,0)`, foco a `#app` (`tabindex="-1"`), `document.title` = `"<Vista> · Platzi Local"`.
- Ruta desconocida o inválida → redirige a `#/`.

## §2 Datos: `viewer/data.js` (lo genera `viewer_data.py`; consumido, nunca editado a mano)

```js
window.PLATZI_LOCAL = {
  generatedAt: "2026-10-18T...Z",
  stats: { courses: 547, downloaded: 60, classes: 1234, durationSec: 999999 },
  routes: [   // solo rutas con >=1 curso; orden: pct desc, luego título
    { id:"ainative", title:"AI-Native", pct:0, hours:57, coursesCount:19,
      cover:"assets/rutas/ainative.jpg"|null, courses:["slug1","slug2", ...] }
  ],
  courses: [  // array; el orden no importa (la lógica indexa por slug)
    {
      slug:"openclaw-2026", url:"https://platzi.com/cursos/openclaw-2026/",
      title:"Curso de OpenClaw", folder:"Curso de OpenClaw"|null,
      routes:["ainative"], hours:2.5|null, category:"..."|null,
      cert:{ date:"2026-09-26", url:"https://platzi.com/p/..." }|null,
      platzi:{ done:10, total:13, at:"2026-09-28", last:"Ataques de..." }|null,
      cover:"assets/covers/openclaw-2026.jpg"|null, coverRemote:"https://..."|null,
      queued:false, downloaded:true, classesTotal:13, durationSec:9420,
      modules:[ { name:"01-Instalación", classes:[
        { src:"../Courses/Curso de OpenClaw/01-Instalación/01-Instalar.mp4",
          title:"Instalar", durationSec:420,
          subs:{ es:"../Courses/…/01-Instalar_es.vtt", en:"…_en.vtt", pt:"…_pt.vtt" } }
      ] } ]
    }
  ]
};
```

Reglas de datos:
- `downloaded` = existe carpeta con ≥1 mp4. Cursos sin carpeta → `downloaded:false`, `modules:[]`.
- `queued` = está en `scripts/cola_descarga.json` y no está descargado.
- `url` = página original del curso en Platzi (`https://platzi.com/cursos/<slug>/`); la escribe `viewer_data.py`. La UI no la inventa: si falta, el enlace se oculta.
- `src`/`subs` son rutas **relativas a `viewer/`** (empiezan con `../Courses/`), con `/` como separador, tal cual en disco (sin URL-encode; la lógica las codifica al usarlas, §6.2).
- `hours` viene del scrape de rutas; puede ser `null`.
- `durationSec` de clase viene de ffprobe; puede ser `null`.
- TODOS los cursos del universo de rutas + certificados + descargados aparecen en `courses` (aunque no estén descargados), para que las rutas se lean completas.

## §3 Persistencia local (la lógica la implementa)

- `localStorage["platziLocal.v1"]`:
```js
{ v:1,
  watched:{ "<slug>|<srcRelativo>": { done:true|false, pos:123.4, at:1717... } },
  prefs:{ speed:1, captions:"off"|"es"|"en"|"pt", autoplayNext:true, volume:1 },
  last:{ slug:"…", src:"…", at:1717... } | null
}
```
- Clave por `slug|src` (estable ante re-indexados).
- Si `localStorage` no está disponible: estado en memoria + aviso discreto una vez.
- Nunca se escriben datos de Platzi aquí: `platzi.*` y `cert.*` son snapshot de solo lectura.

## §4 Vistas y hooks DOM (interfaz congelada UI ⇄ lógica)

Convención: la UI puede añadir clases y estructura **alrededor**, pero estos hooks deben existir con estos nombres exactos. `[data-slot]` se rellena con `textContent` o atributos; `[data-list]` recibe nodos clonados de un partial por la lógica; lo demás lo decide la UI.

### Shell (estático en `index.html`)
- `header#topbar` con: `.brand` (→ `#/`), `nav#mainnav` con `a[data-nav="inicio|rutas|cursos"]` (la lógica marca `aria-current="page"`), `#searchbox` (`input#search-input[type=search]` + `div#search-results[hidden]` dropdown), y `button#resume-chip[hidden]` — la firma de continuidad: muestra "Retomar: <clase>" y navega al aula. 
- `main#app[tabindex="-1"]`.
- `#templates` oculto (`display:none`) con los `<template>` de §4.1 + partials §4.2.
- `#banner-file` (oculto; la lógica lo muestra en `file://`): texto de §7.4 + botón `[data-control="banner-dismiss"]`.

### §4.1 Vistas (template → root)
| Template | Root | Hooks obligatorios |
|---|---|---|
| `tpl-explorar` | `section.view.view-explorar` | `[data-slot=sync-status]`, `[data-slot=summary]`, `[data-slot=notice]`, `[data-list=latest]`, `[data-slot=latest-empty]`, `[data-list=public-routes]`, `[data-slot=routes-empty]`, botón `[data-control=catalog-refresh]` |
| `tpl-home` | `section.view.view-home` | `[data-slot=resume-title]`, `[data-slot=resume-meta]`, `a[data-slot=resume-link]`, `[data-slot=resume-empty]` (bloque alterno oculto), `[data-list=routes]`, `[data-list=courses]`, `a[data-slot=all-routes]` (→`#/rutas`), `a[data-slot=all-courses]` (→`#/cursos`) |
| `tpl-rutas` | `…view-rutas` | `[data-list=routes]`, `[data-slot=empty]` |
| `tpl-ruta` | `…view-ruta` | `[data-slot=title]`, `[data-slot=cover]` (img o fallback), `[data-slot=meta]` (ej. "23 cursos · 44 h"), `[data-slot=bar]` (ancho %), `[data-slot=pct]`, `a[data-slot=continue]`, `[data-filters]` con los pills de §5.5 y `span[data-filter-count]`, `[data-slot=count]`, `[data-list=courses]`, `[data-slot=empty]` |
| `tpl-cursos` | `…view-cursos` | `[data-filters]` con `button[data-filter="all|progress|cert|downloaded|queued|missing"]` y su `span[data-filter-count="<filtro>"]`, `[data-list=courses]`, `[data-slot=count]`, `[data-slot=empty]` |
| `tpl-curso` | `…view-curso` | `[data-slot=title]`, `[data-slot=cover]`, `[data-slot=chips]`, `[data-slot=progress-text]`, `[data-slot=bar]`, `a[data-slot=continue]`, `[data-slot=continue-label]`, `[data-slot=platzi]`, `button[data-control=download-course]` con `[data-slot=download-label]` (oculto si ya está descargado o sin servidor), `[data-slot=download-status]` (`role=status`), `a[data-slot=platzi-link]` (oculto si falta `url`), `a[data-slot=diploma]` (oculto si no hay), `[data-list=modules]`, `[data-slot=empty]` (curso sin descargar) |
| `tpl-module` (partial) | `details.module` | `summary` con `[data-slot=name]`, `[data-slot=count]`, `[data-list=classes]` |
| `tpl-aula` | `…view-aula` | `video#player[playsinline][preload=metadata]` (sin `controls`; Plyr los monta, y en `file://` se restauran los nativos), `[data-slot=class-title]`, `[data-slot=module-name]`, `a[data-slot=course-link]`, `[data-slot=progress-text]`, `button[data-control=prev]`, `button[data-control=next]`, `button[data-control=mark]` (label en `[data-slot=mark-label]`), `select[data-control=captions]` (label "Subtítulos"), `label`+`input[type=checkbox][data-control=autoplay]`, `[data-list=classes]` (sidebar), `[data-slot=error]` (oculto; estado de error de video) |
| `tpl-buscar` | `…view-buscar` | `[data-slot=q]`, `[data-list=courses]`, `[data-list=classes]`, `[data-slot=empty]` |

### §4.2 Partials
- `tpl-course-card` (article `.course-card`): `data-slot="cover"` (img), `data-slot="cover-fallback"`, `a[data-slot=link]`, `data-slot="title"`, `data-slot="meta"`, `data-slot="status"` (aquí la lógica clona chips), `[data-slot=progress]` con `[data-slot=bar]`. La lógica setea el atributo `data-state` en el root del card: `certified|progress|queued|missing|available`.
- `tpl-route-card` (a `.route-card`): `[data-slot=cover]`, `[data-slot=cover-fallback]`, `[data-slot=title]`, `[data-slot=meta]`, `[data-slot=bar]`, `[data-slot=pct]`.
- `tpl-class-row` (li `.class-row`): `a[data-slot=link]`, `svg[data-slot=icon]` con `<use>`, `[data-slot=title]`, `[data-slot=time]`, `[data-slot=bar]` (progreso fino). La lógica setea `data-done` y `data-current` en el root.
- `tpl-result-class` (li `.result-class`): `a[data-slot=link]`, `[data-slot=title]`, `[data-slot=course]`, `[data-slot=time]`.
- Chips: la UI define `.chip` + modificadores `.chip-cert`, `.chip-progress`, `.chip-queued`, `.chip-downloaded`, `.chip-missing` (markup libre; la lógica crea `span.chip.<mod>` con el texto de §7.3).

### §4.3 Iconos
La UI define un sprite `<svg id="icons" style="display:none">` con `<symbol>`: `ic-play` (triángulo relleno), `ic-check`, `ic-chevron`, `ic-search`, `ic-queue` (nube/flecha abajo), `ic-diploma`, `ic-external` (enlace externo), `ic-back`. Un solo trazo/grosor consistente; nada de emoji ni glifos unicode como iconos.

## §5 Comportamientos (los implementa `app.js`)

### §5.1 Inicio
- "Continuar viendo": si `state.last` existe → título de la clase, meta ("Curso · Módulo"), link al aula con el `n` actual. Si no → mostrar `[data-slot=resume-empty]` ("Elige una ruta para empezar" + botón a `#/rutas`).
- `[data-list=routes]`: rutas con `0 < pct < 100` ordenadas por `pct` desc; si hay menos de 4, completar con el resto por pct desc; máximo 6.
- `[data-list=courses]`: hasta 12 cursos: primero los con `last`/`platzi.at` más recientes (por fecha), luego descargados recientes; cada uno con `tpl-course-card`.
- Barra superior: `#resume-chip` visible si `state.last`; texto "Retomar · <título corto>".

### §5.2 Rutas y ruta
- `#/rutas`: `tpl-route-card` por ruta (orden: pct desc). Barra = pct. Meta: "N cursos · H h" (omitir h si null).
- `#/ruta/<id>`: cabecera + lista de `tpl-course-card` en el **orden de `route.courses`** (orden de aprendizaje). Si hay descargados, la meta añade "· N de M descargados". Los no descargados se ven apagados (portada y título) sin reordenar. `[data-slot=continue]` → curso descargado con actividad local más reciente, o primero descargado; oculto si ninguno.
- `#/ruta/<id>` repite los filtros de §5.5 sobre los cursos de esa ruta: mismos pills, mismos conteos (calculados solo sobre la ruta) y la misma combinación con Y. La selección se reinicia al cambiar de ruta. `[data-slot=count]` muestra "N cursos" del resultado.

### §5.3 Curso
- Chips (pueden coexistir, en este orden): `Aprobado` (cert), `En curso` (platzi.done>0 o local>0), `Descargado`, `En cola`, `Sin descargar`.
- Progreso local: `vistas/total` = clases con `done` / (`classesTotal`), barra = fracción. Si no descargado: sin barra, mostrar `[data-slot=empty]` ("Este curso aún no se ha descargado" + chip cola si aplica) y deshabilitar continue.
- `platzi` (snapshot): "En Platzi: 7/13 · sep 2026" en `[data-slot=platzi]`; si hay cert: fecha + `[data-slot=diploma]` visible ("Ver diploma", target `_blank`).
- Continue: primera clase no vista; label "Continuar" (o "Reproducir" si no hay ninguna vista; "Reanudar" si la primera no vista tiene `pos>0`). Link a `#/aula/<slug>/<n>`.
- Descargar: `button[data-control=download-course]` visible solo si `!course.downloaded` y hay servidor (`http(s)`). Al pulsarlo, `POST /api/enqueue {items:[{slug,title}], position:"back"}`; mientras responde, label "Encolando…"; después, "En cola" o "Descargando…" (según el item devuelto) y queda deshabilitado. Al entrar, `GET /api/state` ajusta el label si el curso ya está en cola o corriendo. El resultado se anuncia en `[data-slot=download-status]`. Si falla, vuelve a "Descargar curso" y anuncia el error de §7.2.
- Enlace original: `a[data-slot=platzi-link]` visible si `course.url`; `href` = esa URL, `target="_blank"`, `rel="noopener noreferrer"`; se oculta y se quita el `href` si falta. Texto de §7.1.
- Módulos: `tpl-module` por módulo, `<details open>` para todos si hay ≤3 módulos; con más, solo el que contiene la clase actual (o el primero); el summary muestra "N clases". Clases: `tpl-class-row` con icono `ic-check` si `done` (y `data-done="true"`), si no `ic-play`; `data-current="true"` en la última vista/posición.

### §5.4 Aula (reproductor)
- Construye la playlist aplanada del curso (módulos→clases, n=1..N). Resuelve `n` (clamp 1..N; inválido → 1).
- `<video id="player" playsinline preload="metadata">` sin `controls`. Antes de inicializar el reproductor inserta `<source src=encode(f.src) type="video/mp4">` y, por cada sub en `f.subs`, `<track kind="subtitles" srclang="es|en|pt" label="Español|English|Português" src=encode(sub)>`. La preferencia `prefs.captions` decide el track activo (`off` = todos `disabled`).
- Reproductor: **Plyr 3.8.5** vendoreado (`vendor/plyr/plyr.min.js`, `plyr.css`, `plyr.svg`; MIT). Aporta play/pausa, progreso, tiempo, volumen, silencio, subtítulos, menú de velocidad, PiP y pantalla completa. Config: `controls` con esa lista, `settings:['speed']`, `speed.options = [0.75,1,1.25,1.5,1.75,2]`, `keyboard:{focused:false, global:false}` (los atajos globales son del visor), `storage.enabled:false` (manda `prefs`) e `i18n` en español (§7.1).
- Preferencias: la velocidad inicial va a `video.playbackRate` y a `speed.selected`; el volumen a `volume`; los subtítulos a `captions.active`/`captions.language`. Los eventos `ratechange`, `volumechange`, `captionsenabled`, `captionsdisabled` y `languagechange` actualizan `state.prefs` (guardado con debounce de 250 ms).
- Carga: `video.load()`. Errores (`video.error`, `source` 404): mostrar `[data-slot=error]` ("No se pudo cargar el video — revisa que el archivo exista") y desactivar autoplay-next.
- Reanudar: al `loadedmetadata`, si `pos>5` y `pos < duration-10` → `currentTime = pos`. Guardar `pos` cada `timeupdate` (~5 s) y en `pause`/`beforeunload` (usar `visibilitychange`).
- `ended`: marcar `done=true` (salvo que el usuario haya desmarcado manualmente esa reproducción), y si `prefs.autoplayNext` → navegar a `n+1` (si no hay siguiente: quedarse; clase queda vista).
- "Marcar como visto": toggle `done`. Label: "Marcar como visto" / "Visto ✓" (usa `[data-slot=mark-label]`).
- `data-control=prev|next`: navegan `n∓1` (clamp; deshabilitados en extremos).
- Velocidad: menú Ajustes de Plyr (0.75–2); aplica `video.playbackRate`; persiste en `prefs.speed`.
- Subtítulos: selector visible `select[data-control=captions]` en la barra secundaria (Desactivados + los idiomas con track en esa clase) y menú CC de Plyr; ambos sincronizados. Persiste en `prefs.captions`; la tecla `c` cicla `off → es → en → pt` con `toggleCaptions`/`language`. Para leer el estado, `captions.active` manda sobre `currentTrack` (que conserva el último índice al desactivar).
- Autoplay siguiente: checkbox, persiste.
- Pantalla completa: la tecla `f` y el botón de Plyr llaman a `player.fullscreen.toggle()`; sin Plyr, `video.requestFullscreen()`.
- Picture in picture: lo aporta Plyr (`controls` incluye `pip`); sin Plyr se usa el botón nativo de Chrome.
- Fallback: si `window.Plyr` no cargó o el protocolo es `file://`, se restauran los `controls` nativos del `<video>` y se aplican subtítulos/prefs a mano; la barra secundaria no cambia.
- Teardown: al salir del aula se llama `player.destroy()` antes de limpiar el `<video>`; sin Plyr no hay nada que destruir.
- Playlist lateral: `tpl-class-row` por clase; la actual con `data-current`, `aria-current="true"` y el fondo en la fila completa (incluye la barra de progreso); click navega. La barra de progreso vive dentro de su fila y usa el fondo del contenedor, así solo se ve cuando hay avance; la fila actual mantiene la pista visible. La cabecera muestra el título del curso en hasta 2 líneas; la lista no tiene scroll horizontal, cada fila recorta el título con elipsis y la lista hace scroll hasta la fila actual.
- Atajos de teclado (ignorar cuando el foco está en input/select/textarea): `espacio`/`k` play-pausa, `←/→` ±5 s, `j/l` ±10 s, `↑/↓` volumen ±5%, `m` mute, `f` pantalla completa, `c` ciclar subtítulos, `n`/`p` siguiente/anterior.
- Título: `document.title` = "<clase> · <curso> · Platzi Local".

### §5.5 Cursos (catálogo) y búsqueda
- Filtros: all (todo), progress (`platzi.done>0` o local>0 y sin cert), cert, downloaded, queued, missing. Cada pill es un interruptor: `aria-pressed="true"` si está activo, y varios pueden estarlo a la vez. Los activos se combinan con **Y** (p. ej. "En curso" + "Sin descargar" = en curso y sin descargar); "Todos" limpia la selección y solo está pulsado cuando no hay ninguno. Cada pill muestra su total en `[data-filter-count]` (all = total del ámbito: catálogo o ruta); los conteos se calculan con la misma condición del filtro y no cambian al combinar.
- Orden del catálogo: certificados al final; antes, descargados primero; dentro de cada grupo, título alfabético. Contador "N cursos".
- Búsqueda: `#search-input` con dropdown (`#search-results`): máx. 8 resultados mezclando cursos y clases locales con cursos públicos de la caché SQLite; navegación ↑/↓/Enter/Escape. Orden: cursos descargados, biblioteca personal y catálogo público. Los resultados públicos abren la página oficial en otra pestaña; las fichas locales conservan el progreso. Vista `#/buscar/<q>`: sección "Cursos" (cards) + "Clases" (result-class, máx. 100). Normalización: minúsculas y sin acentos (NFD + strip diacríticos). Sin resultados → `[data-slot=empty]`.
- `#/cursos`: `[data-slot=count]`; grid con todos.

### §5.6 Utilidades de la lógica
- `fmtTime(sec)` → "12:34" / "1:02:03"; "—" si null.
- `fmtHours(h)` → "2 h" / "45 min".
- Meta de curso: "N clases" + (· H h si hours) + (· H h descargadas? no: usar durationSec → "N clases · 3 h 20 min").
- Meta de ruta: "N cursos · H h".
- Encode de rutas: `p.split('/').map(encodeURIComponent).join('/')` (nunca `encodeURI` sobre la ruta completa).
- Estado global `state` (watched/prefs/last) con helpers `markDone(slug,src)`, `setPos(slug,src,pos)`, `getEntry(slug,src)`.
- `pctLocal(course)` = clases `done` / `classesTotal` (0 si no descargado).
- Nada de `innerHTML` con datos dinámicos: crear nodos y setear `textContent` (los títulos vienen del scrape; contenido es confiable pero la disciplina queda).

## §6 UI — sistema visual (lo implementa `styles.css` + `index.html`)

### §6.1 Tokens (valores congelados; la UI puede ajustar ±10% manteniendo familia y contraste)
```
--bg:#0d1a33; --surface:#14264a; --surface-2:#1b305c; --surface-3:#22406f;
--ink:#ffffff; --ink-2:#aebbd9; --accent:#98ca3f; --accent-2:#7fb32e; --accent-ink:#12233f;
--gold:#ffce00; --danger:#ff6b6b; --focus:#98ca3f;
--radius:12px; --radius-sm:10px; --maxw:1200px;
```
- Un solo ground con superficies separadas **por pasos de tono**, nunca por líneas/sombras. Sombra solo en lo que flota de verdad (dropdown de búsqueda).
- Tipografía: `"Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif`. h1 clamp(1.75rem,3vw,2.5rem)/700; h2 1.375rem/700; cuerpo 1rem/1.55; meta 0.875rem `--ink-2`. Nada de uppercase con tracking.
- Botones: `.btn` verde `--accent` texto `--accent-ink` 700, radio `--radius-sm`; `.btn-ghost` transparente texto `--ink`; `.btn[disabled]` opacidad 45% y `cursor:not-allowed`.
- Plyr: `--plyr-color-main: var(--accent)`, controles sobre negro, radio `--radius-sm`; los menús usan las superficies del tema. No se re-skinea más allá de eso.
- Barras de progreso: `.progressbar` 6px, track `--surface-3`, relleno `--accent`, `border-radius:999px`, transición de ancho 300ms.
- Chips: pill `--surface-2` texto `--ink-2`; `.chip-cert` fondo `--gold` texto `#3a2f00`; `.chip-progress` borde… no: fondo `--surface-3` texto `--accent`; demás neutros.
- Foco: `:focus-visible` outline 2px `--focus` offset 2px.
- Selección de texto: `::selection` fondo `--accent` texto `--accent-ink`. Scrollbars oscuros.
- Nada de: gradientes, glass/blur, sombras en reposo, emoji, monoespaciada fuera de código, eyebrows/kickers, numeración decorativa, bordes-left de color en filas.

### §6.2 Composición por vista
- **Topbar** (~56px): marca "Platzi" + "Local" (segunda palabra en verde); nav 3 links (activo = texto blanco + barra inferior verde 2px, no color suelto); buscador a la derecha; `#resume-chip` pill con `ic-play`.
- **Home**: (1) héroe de continuar: superficie ancha con título de clase grande, meta, CTA verde; a su derecha una columna "Rutas activas" (filas con barra + %); (2) "Tus cursos" grilla de cards (auto-fill minmax(220px,1fr), máx 12); el héroe y las rutas no comparten composición.
- **Rutas**: lista de filas (no grilla): miniatura 16:9 96px + título + meta + barra + % + chevron.
- **Curso**: banda héroe (portada a la derecha 16:9 ~380px, texto a la izquierda: título, chips, progreso, CTA) y debajo la lista de módulos a 860px centrados; aside no — una columna. En la fila de acciones, "Ver en Platzi" es un enlace neutro con icono; "Ver diploma" conserva el dorado.
- **Aula**: video 16:9 en columna izquierda (flex 1, máx ~900px) con la barra de Plyr; debajo, barra secundaria propia (prev/next/mark/subtítulos/autoplay); sidebar derecha 360px con cabecera del curso (progreso) y playlist scrolleable; en <960px la sidebar pasa debajo.
- **Cursos/buscar**: fila de filtros (pills `aria-pressed` con contador) + grilla de cards; resultados de búsqueda en filas.
- **Course card**: portada 16:9 arriba (o fallback tipográfico con la inicial en `--surface-3`), título 2 líneas máx, meta, chips, progreso local fino. Hover: `--surface-2` + translateY(-2px) suave. `data-state="missing"` → portada y título atenuados (el descargado destaca).

### §6.3 Fallback de portada
Sin imagen: bloque `--surface-3` con la inicial del curso grande en `--ink-2` (nunca icono ni placeholder gris).

### §6.4 Movimiento y estados
- Entrada de vista: opacity+4px, 160ms ease-out. Un solo momento orquestado: la barra de progreso animando su ancho al aparecer (300ms) — eso es la firma.
- Hover/press en botones, cards, filas de clase y links (tono + 1px translate). 
- `@media (prefers-reduced-motion: reduce)`: sin translaciones ni transiciones no esenciales.
- Estados: vacío (home sin last, buscar sin resultados, curso sin descargar), error de video, disabled, hover/focus. Todos visibles en §4 (hooks) y con copy de §7.

## §7 Copy (español, congelado)

### §7.1 Navegación y botones
Inicio · Rutas · Mis cursos · Descargas · Buscar curso o clase… · Todos · En curso · Aprobado · Descargado · En cola · Sin descargar · Abrir ruta {ruta} · Continuar · Reproducir · Reanudar · Marcar como visto · Visto · Anterior · Siguiente · Subtítulos · Desactivados · Español · English · Português · Autoplay siguiente · Reproducir siguiente al terminar · Ver todas las rutas · Ver todos los cursos · Ver diploma · Ver en Platzi · Descargar curso · Encolando… · En cola · Descargando… · Entendido · Empezar · Actualizar catálogo · Recargar visor · Elegir una ruta · Añadir un curso · Añadir · Descargar {n} · Ya en cola · Sin pendientes · Subir · Bajar · Cancelar · Limpiar · Reintentar · Quitar · Comprobar sesión.

Plyr (i18n propio): Reproducir · Pausar · Reiniciar · Retroceder {n}s · Avanzar {n}s · Buscar · Reproducido · Cargado · Volumen · Silenciar · Activar sonido · Activar subtítulos · Desactivar subtítulos · Subtítulos · Ajustes · Velocidad · Normal · Imagen en imagen · Pantalla completa · Salir de pantalla completa · Desactivado.

### §7.2 Estados
- Sin last: "Elige una ruta para empezar" + botón "Explorar rutas".
- Curso sin descargar: "Este curso aún no se ha descargado" (+ chip "En cola" si `queued`).
- Curso encolado: "«{curso}» añadido a la cola de descargas." (`role=status`; al entrar ya en cola no se anuncia nada).
- Error al encolar: "No se pudo encolar. Revisa que el servidor local esté activo."
- Buscar vacío: "Sin resultados para «{q}»". Catálogo vacío (hipotético): "Todavía no hay cursos en el catálogo".
- Filtros sin resultados: "Ningún curso coincide con este filtro" (uno activo) o "Ningún curso coincide con estos filtros" (dos o más). Ruta sin cursos: "Esta ruta todavía no tiene cursos".
- Error video: "No se pudo cargar el video. Revisa que el archivo exista en Courses/".
- Banner `file://`: "Estás abriendo el visor como archivo local. Para subtítulos y mejor experiencia ejecuta viewer\\start.cmd." + "Entendido".
- localStorage no disponible: "Tu progreso no se guardará en esta sesión".
- Descargas sin servidor: "Las descargas necesitan el servidor local" + "Abre el visor con viewer\\start.cmd".
- Descargas sin CLI: "No encontré el comando platzi" + "Instálalo o define PLATZI_BIN antes de arrancar el servidor".
- Sesión de Platzi no iniciada: "La sesión de Platzi no está iniciada" + "Ejecuta platzi login en la terminal y vuelve a intentar. La sesión se gestiona en la terminal; no depende del navegador que uses para el visor." + botón "Comprobar sesión".
- Cola vacía: "No hay descargas en cola" + "Elige una ruta o añade un curso para empezar." + acciones "Elegir una ruta" (baja a Mis rutas) y "Añadir un curso" (enfoca el buscador).
- Sin cursos pendientes: "Todos tus cursos están descargados o en cola." Sin rutas con cursos: "No hay rutas con cursos en el catálogo."
- Historial: chips "Completado" · "Error" · "Cancelado"; meta con la fecha o el mensaje de error.
- Catálogo: "Actualizando el catálogo…" · "Catálogo actualizado. Recarga el visor para verlo." · resumen "… · catálogo pendiente de actualizar".

### §7.3 Chips
Aprobado · En curso · Descargado · En cola · Sin descargar.

### §7.4 Textos de meta
- Curso: "13 clases · 3 h 20 min" (omitir duration si null). 
- Ruta: "23 cursos · 44 h"; en el detalle, "· 8 de 23 descargados" si hay descargados.
- Platzi snapshot: "En Platzi: 7/13 · sep 2026". Diploma: "Ver diploma".
- Continuar (home): "Continuar viendo" + meta "Curso · Clase". Resume chip: "Retomar".

## §8 Accesibilidad
- Todo lo clickeable es `<a>`/`<button>`; iconos decorativos `aria-hidden`; botones de icono con `aria-label`.
- Contraste ≥4.5:1 en texto corrido (revisar `--ink-2` sobre `--surface`); ≥3:1 en texto grande.
- Navegación con teclado completa; foco visible; `aria-current` en nav/clase actual; listas semánticas (`ol`/`ul`).
- Video: subtítulos nativos; Plyr vendoreado (controles estándar, i18n en español) + barra secundaria propia, sin duplicar controles.
- Alt de portadas: título del curso (o `alt=""` si hay texto adyacente idéntico).

## §9 Integración y pruebas
- `viewer/start.cmd` (lo escribe el integrador): `cd` a la raíz del proyecto, `python scripts/server.py` y abre `http://localhost:8787/viewer/`. La raíz se sirve completa (salvo `scripts/`, `logs/` y `.git/`) para que `../Courses/…` resuelva. Solo un servidor a la vez: si el puerto ya está en uso, `server.py` avisa y no arranca (un segundo worker competiría por la misma cola). Los archivos estáticos se sirven con `Cache-Control: no-cache`: una recarga normal trae la versión editada del visor.
- Los MP4 se sirven con `Accept-Ranges: bytes`: `Range` válido → 206 con `Content-Range`, rango insatisfecho → 416, sin cabecera → 200 completo. Sin esto Chrome marca el video como no buscable y rompe el seek/reanudar.
- Con `file://` (abrir `viewer/index.html`): todo debe funcionar salvo subtítulos (CORS) y descargas → banners §7.2.
- Criterios de aceptación del conjunto:
  1. Con el server: Home renderiza (con o sin last), navegación por las 8 vistas sin errores de consola.
  2. Aula: video carga y reanuda; terminar una clase la marca vista y avanza; los subtítulos cambian desde el selector y desde el botón CC de Plyr (y ambos quedan sincronizados); la velocidad (menú Ajustes) y el volumen persisten tras recargar; pantalla completa y PiP operativos; el seek funciona (rangos HTTP).
  3. Un curso sin descargar no rompe nada (chip En cola, empty state).
  4. Con DevTools en offline: todo sigue funcionando (excepto portadas que no se hayan podido descargar → fallback).
  5. Teclado: recorrer topbar → cards → aula sin ratón; atajos del aula operativos. Descargas: reordenar y cancelar sin perder el foco.
  6. Móvil 390px: sin overflow horizontal; tap targets ≥44px.
  7. Descargas: "traer rutas" encola solo lo pendiente en orden; el progreso avanza por clase; cancelar corta el proceso; "Actualizar catálogo" se bloquea con la cola activa.
  8. Curso: "Descargar curso" encola ese curso y pasa a "En cola"/"Descargando…"; el botón no aparece si ya está descargado ni en `file://`; un fallo de red lo deja reintentar y lo anuncia.
- La UI y la lógica deben poder abrirse con datos reales sin tocar el otro archivo; cualquier hook faltante es un bug del responsable de la vista, no del consumidor.

## §10 Descargas (servidor local)

La vista `#/descargas` requiere `scripts/server.py`, que arranca `viewer/start.cmd`. Con `file://` se renderiza en modo lectura: catálogo local, acciones deshabilitadas y banner de §7.2.

### §10.1 Contrato de la vista
- Plantillas: `tpl-descargas`, `tpl-dl-item`, `tpl-dl-route`, `tpl-dl-course`, `tpl-dl-history`.
- Hooks: `summary`, `notice`/`notice-text`, `offline`, `cli-warning`, `session-warning`, `session-status`, `active`/`active-title`/`active-bar`/`active-fill`/`active-pct`/`active-phase`, listas `queue`, `routes`, `courses`, `history`, `queue-empty`, `routes-empty`, `add-empty` y región viva `live`. Cada fila de `routes` lleva `a[data-slot=route-link]` (título de la ruta, enlaza a `#/ruta/<id>`) además del botón de descarga de la propia fila.
- Sondeo de `/api/state` cada 1.5 s; se pausa con `document.hidden` y se detiene al salir de la vista.
- Foco: cada control lleva `data-focus`; tras cada render se restaura el foco y, si el control desapareció, cae al siguiente del mismo grupo.
- Rutas: cada una muestra descargados/total de sus cursos y encola solo los pendientes que no estén ya en la cola. Las completas también se listan (arriba, con "Sin pendientes"); el resto después, por pendientes desc. El título de la ruta es un enlace directo a `#/ruta/<id>`; la descarga sigue en su botón. El enlace conserva el foco tras el sondeo (`data-focus="route:<id>:open"`).
- Cursos manuales: buscador sobre todo el catálogo, descargados primero y marcados con el chip "Descargado" (sin botones); "Añadir" va al final y "al frente" (icono) después del que corre. Contador: "N descargados · M sin descargar" (omitir el 0); al buscar, "N resultados · M descargados".

### §10.2 API local
- `GET /api/catalog` devuelve la caché SQLite: catálogo público, últimos cursos, rutas públicas, recuentos y estado de sincronización.
- `POST /api/catalog/refresh` inicia en segundo plano la actualización pública desde Platzi; abre Chromium si hace falta, no descarga vídeos y no modifica el progreso personal.
- `GET /api/state` → `{ok, items, stats, catalog, session, cliAvailable, serverTime}`; cada item: `{slug, title, status: queued|running|completed|error|canceled, progress, phase, error, addedAt, startedAt, finishedAt}`. `session` = `{checkedAt, loggedIn, message}`.
- `GET /api/session` → `{ok, session, cliAvailable, serverTime}`. `POST /api/session/check` ejecuta una comprobación de la sesión de Platzi y devuelve el mismo formato.
- `POST /api/enqueue {items:[{slug,title}], position: back|front}` · `POST /api/reorder {slug, direction: up|down}`.
- `POST /api/cancel {slug}` · `POST /api/remove {slug}` · `POST /api/clear`.
- `POST /api/refresh` regenera `viewer/data.js` con `scripts/viewer_data.py`; responde 409 si hay cola activa.
- Errores: `{ok:false, error}` con 4xx/5xx. Respuestas `no-store`.

### §10.3 Reglas del servidor
- Escucha solo en `127.0.0.1`; valida `Origin` y `Host`; bloquea `/scripts/`, `/logs/`, `/.git*` y traversal.
- Slug validado con `^[a-z0-9][a-z0-9-]{0,80}$`; el CLI se lanza con lista de argumentos, sin shell.
- Progreso: cuenta `[DOWNLOADING-VIDEO]` contra el total que reporta el propio CLI (`| Total | n |`). No se guardan líneas crudas (evita filtrar el saludo con el nombre).
- Cancelación: `taskkill /T /F` del árbol del proceso. Estado en `scripts/download_state.json` (runtime, ignorado por git).
- Un worker secuencial: la cola corre en orden; "al frente" inserta después del que está corriendo.

## §11 Fuera de alcance
Login, comentarios, exámenes, notas de clase, skins de Plyr más allá del acento, sincronizar progreso con Platzi, multiperfil, i18n, descargas simultáneas (un solo worker), reintentos automáticos y programación de descargas por horario.
