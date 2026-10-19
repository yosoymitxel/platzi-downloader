# Superficie: Visor offline `viewer/index.html` — modo Operate

## Alcance y visitante
Visor personal de los cursos de Platzi descargados en `Courses/`. Visitante único: Miguel, sentado a estudiar, a veces sin conexión; viene a retomar y ver clases. Modo **Operate**: la tarea manda; el mundo Platzi aporta solo tipo, paleta, densidad y una firma, nunca el layout.

## Contrato de dirección

THESIS: Un aula Platzi en el disco: la misma jerarquía Rutas → Curso → Módulo → Clase servida local; se rechaza el catálogo de archivos genérico y el dashboard de tarjetas métricas.
OWN-WORLD: Azul tinta profundo (fondo #0d1a33 sobre el navy #121f3d), superficies en pasos de tono (sin líneas ni sombras salvo menús flotantes), verde Platzi #98ca3f reservado a acción y progreso, amarillo solo en insignias de aprobado; Segoe UI con escala amplia; radios 12px; íconos SVG dibujados en un solo trazo.
STORY: El visitante entra y en un clic retoma la última clase; navega sus rutas como en Platzi, ve la clase con subtítulos es/en/pt, su progreso avanza solo al terminar y pasa a la siguiente.
FIRST VIEWPORT: barra superior fina (marca "Platzi Local", nav Inicio/Rutas/Mis cursos, buscador). Debajo, héroe de retomar: tarjeta ancha "Continuar viendo" con la última clase y botón verde; a la derecha, rutas activas con barra de progreso y %. La tesis (retomar) manda; sin hero decorativo.
FORM: estructura propia del inventario (router por hash, aula con playlist lateral, barra fina de progreso como firma de continuidad), construida code-led.
FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
seed: none (unavailable)

## Decisiones sin resolver
- Densidad exacta de la grilla de cursos (la decide la UI dentro del SPEC).
- Portadas: usar portada real descargada; si no existe, bloque tipográfico con inicial (nunca placeholder gris).
