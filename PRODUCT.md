# PRODUCT — Platzi Local (visor offline)

## Qué es
Visor web **local** que reconstruye parte de la experiencia de platzi.com: navega las rutas y los cursos descargados (mp4 + subtítulos `.vtt` es/en/pt) y lleva el progreso en local. La biblioteca es offline; la vista **Explorar** y la búsqueda de cursos públicos usan una caché SQLite local que se actualiza opcionalmente desde Platzi.

## Quién y su escena
- Usuario único por instalación (Miguel, "YosoyMitxel", en el original): plan Platzi Expert, Windows + Chrome, biblioteca descargada en `Courses/` de este proyecto.
- Escena de uso: sentarse a estudiar, a veces sin conexión estable; quiere "entrar y continuar", no administrar archivos.
- Idiomas: UI en español; clases con subtítulos en español, inglés y portugués.

## Job del producto
- En segundos: abrir el visor y **continuar la última clase** desde el segundo exacto donde quedó.
- Encontrar cualquier curso o clase por tres vías: rutas (estructura mental real), búsqueda instantánea, o grilla de sus cursos.
- Ver la clase con subtítulos, velocidad, autoplay de la siguiente, y que el progreso local persista.
- **Completar la biblioteca sin salir del visor**: ver qué falta por ruta o por curso —con lo ya descargado siempre primero—, encolarlo, seguir el progreso, cancelar y reordenar.
- Descubrir cursos nuevos, rutas públicas y cursos de todo el catálogo en una vista **Explorar** separada, sin mezclar los cursos web con el progreso y las rutas personales.

## Fuera de alcance
- Login, comentarios, exámenes, puntos, gamificación y todo lo social de Platzi.
- Multiusuario en una misma instalación: un solo perfil local, sin cuentas.
- Servicio remoto: no se vende ni se despliega; el repo se comparte para que cada persona levante su propia copia local (catálogo y sesión son de cada cuenta).
- Sin CDNs, fuentes remotas de interfaz ni frameworks. El núcleo funciona offline; la primera sincronización pública requiere internet y guarda los metadatos en `scripts/public_catalog.sqlite3` (archivo local ignorado por Git). Las portadas del catálogo público pueden necesitar internet y tienen fallback tipográfico.

## Restricciones técnicas
- HTML/CSS/JS vanilla, sin build step. Fuentes del sistema (Segoe UI).
- Un `data.js` generado por `scripts/viewer_data.py` + carpeta `assets/` (portadas descargadas).
- Se sirve con `python scripts/server.py` vía `start.cmd` (raíz del proyecto, para servir también `Courses/`); debe degradar con `file://` (sin subtítulos ni descargas, el resto funciona).
- El servidor local expone `/api/*` para la cola de descargas y para la caché pública: escucha solo en `127.0.0.1`, valida origen, lanza el CLI `platzi` con argumentos (sin shell) y guarda el estado runtime en `scripts/download_state.json` (ignorado por git). Un solo worker secuencial.
- `scripts/catalog_db.py` consulta SQLite; `scripts/sync_public_catalog.py` sincroniza metadatos del catálogo, agenda y rutas públicas con Playwright. No descarga vídeos ni altera el progreso local.
- La biblioteca personal conserva su `data.js` con módulos y clases locales. SQLite separa y cachea la información pública del catálogo (en torno a 1.900+ cursos anunciados por Platzi), para que no entre como si estuviera descargada ni infle el catálogo personal. Los vídeos se cargan bajo demanda.

## Supuestos declarados (confirmados por el brief del usuario)
- "Lo más parecido posible a Platzi" = misma arquitectura de información (Inicio / Mis rutas / Curso / Aula), mismo lenguaje visual (azul tinta + verde), no una copia pixel-perfect del CSS propietario.
- Dos capas de progreso: **local** (Visto + posición, fuente de verdad del visor) y **snapshot de Platzi** (pos/total al momento de scrapear, mostrado como historial).
- La cola de descarga y el catálogo pueden crecer: el visor muestra también cursos "en cola" o "sin descargar" para que las rutas se lean completas.
