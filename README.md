# Jaradraw

Herramienta de diagramas local, de un solo usuario y sin conexión, al estilo de excalidraw.com. Escrita desde cero con Vite, React, TypeScript y Canvas 2D. Las formas usan `roughjs` para el trazo a mano alzada. Los datos son compatibles con el formato `.excalidraw`, y los campos o tipos de elemento desconocidos se conservan al guardar.

## Ejecutar

Requiere Node 18 o superior.

```
npm install
npm run dev      # servidor de desarrollo
npm run build    # tsc + build de producción
npm test         # pruebas unitarias (vitest)
```

## Funciones

Fase 1
- Lienzo infinito a pantalla completa, nítido en pantallas de alta densidad.
- Desplazamiento (rueda, botón central, Espacio + arrastrar, herramienta Mano) y zoom anclado al cursor (10% a 3000%).
- Herramientas: selección, mano, rectángulo, elipse, rombo, flecha, línea y texto (edición in situ).
- Autoguardado en `localStorage` (clave `jaradraw:scene`) y exportación a imagen.

Fase 2
- Deshacer y rehacer (una entrada por gesto, hasta 200 pasos; el historial no se guarda).
- Selección múltiple: Mayús + clic, selección por recuadro, Ctrl+A. Mover y escalar proporcionalmente el grupo desde las esquinas.
- Duplicar (Mayús+D, o Ctrl/Alt + arrastrar: el original queda en su sitio y la copia sigue al cursor, con guías activas; con Ctrl y una sola figura, la copia queda unida al original por una flecha enlazada), copiar, cortar y pegar con el portapapeles del sistema en formato `excalidraw/clipboard`, compatible con excalidraw.com. Pegar texto plano crea un elemento de texto.
- Orden de capas, movimiento con flechas del teclado.
- Panel de estilo (solo propiedades, a la izquierda): secciones plegables Color, Trazo, Texto y Flecha (el estado se recuerda), con una fila de 32 px por propiedad y solo los controles que afectan al tipo de elemento seleccionado. El color personalizado es el botón con "+"; las puntas de flecha se eligen en dos botones con menú. Con varios elementos marca con * los valores que difieren.
- Barra de acciones contextual (bajo la barra de herramientas, solo con selección): duplicar, eliminar, orden de capas, agrupar/desagrupar, voltear, editar puntos, bloquear, añadir a la biblioteca y menú Alinear. Con una selección bloqueada solo muestra desbloquear.
- Atajos visibles: las teclas de una sola letra se ven en la esquina del botón; el resto aparecen en un tooltip propio (nombre y teclas como chips) tras 300 ms de hover o al enfocar con teclado; Esc lo oculta. Los atajos se escriben como en un teclado español (Ctrl, Mayús, Supr, Intro...) y no dependen de teclas de puntuación físicas: Ctrl+"+" acerca, Ctrl+"-" aleja, Ctrl+0 restablece.
- Archivos: Abrir, Guardar y Guardar como (`.excalidraw`). Con la API File System Access (Chrome, Edge) se reutiliza el archivo al guardar; en otros navegadores se descarga el archivo y se abre con un selector.
- Cada control con atajo muestra su tecla, y el modal de atajos (tecla `?`) lista todos agrupados por categoría.

Fase 3: diagramas conectados
- Texto dentro de formas: doble clic (o Intro con una forma seleccionada) en rectángulo, elipse o rombo. La etiqueta se ajusta al ancho interior, queda centrada, hace crecer la forma si no cabe y se mueve, escala, duplica, copia, ordena y borra junto con ella.
- Flechas enlazadas: al crear una flecha o arrastrar uno de sus extremos, el extremo se enlaza a la forma resaltada (dentro o a menos de 10 px). Ctrl/Cmd desactiva el enlace. Las líneas nunca se enlazan.
- Etiquetas de flecha: doble clic o Intro con una flecha seleccionada; el texto queda en el punto medio del trazo con el color de fondo detrás.
- Puntas de flecha: inicio y fin (ninguna, flecha, triángulo, barra, círculo, rombo).
- Líneas y flechas de varios puntos: con la herramienta Línea o Flecha, clic para añadir puntos y doble clic, Intro o Esc para terminar. Doble clic en una línea (o Ctrl+doble clic en una flecha, Ctrl+Intro, o el botón "Editar puntos") permite arrastrar puntos, insertar uno desde el punto medio de un segmento y borrar el seleccionado con Supr. Trazado recto o curvo desde el panel de estilo.

Fase 4: organización y precisión
- Rotación: tirador sobre la selección; Mayús ajusta a pasos de 15 grados. Con varias selecciones rotan alrededor del centro común. Las líneas y flechas incorporan la rotación a sus puntos (su `angle` queda en 0).
- Grupos: Mayús+G agrupa y Mayús+U desagrupa (`groupIds` de interior a exterior). Un clic selecciona el grupo exterior; doble clic entra en el grupo para elegir miembros; Esc o clic fuera salen. El recuadro solo selecciona grupos completos.
- Bloqueo (Mayús+L): se puede seleccionar, pero no mover, editar, estilizar, borrar ni borrar con el borrador. La barra de acciones solo ofrece "Desbloquear".
- Alinear y distribuir desde el menú Alinear de la barra de acciones (con rectángulos girados); Voltear horizontal y vertical (Mayús+H, Mayús+V).
- Cuadrícula (G o Ctrl+') y guías inteligentes (Mayús+S, ver abajo), con botones junto al zoom. Ctrl suspende ambos al arrastrar. La cuadrícula se guarda en `appState` (`gridSize`, `gridStep`, `gridModeEnabled`) y no se exporta al PNG.
- Texto: tamaño (S 16, M 20, L 28, XL 36) y alineación (izquierda, centro, derecha) en el panel de estilo, para texto libre, etiquetas y contenedores con etiqueta; se usan como valores por defecto del texto nuevo.
- Lápiz (P) con `perfect-freehand` y borrador (E).

Fase 5: contenido y exportación
- Imágenes (PNG, JPEG, GIF, WebP, SVG): botón de la barra o tecla 9 (elige archivos y se colocan donde hagas clic), pegar desde el portapapeles o arrastrar archivos al lienzo (se insertan en el punto de soltado). Las imágenes de más de 2000 px por lado se reducen al insertarlas y se muestran ajustadas a la mitad de la ventana. Mantienen la proporción al redimensionar desde cualquier tirador (Mayús la libera), giran, se voltean (`scale` negativo), se agrupan, bloquean, duplican, copian (los datos viajan en `files` del portapapeles), ordenan, borran, exportan y admiten flechas enlazadas. Mientras falta el archivo se dibuja un cuadro neutro. El identificador es el SHA-1 de los bytes, así que una misma imagen se guarda una sola vez.
- Exportar imagen (Mayús+E o menú Archivo): PNG (1x, 2x, 3x) o SVG, con o sin fondo, solo la selección (un marco seleccionado se exporta con sus hijos y recortado), vista previa, Descargar y Copiar al portapapeles (PNG). La opción «Incluir escena para poder reabrirla» incrusta la escena (PNG: fragmento `tEXt` con clave `application/vnd.excalidraw+json`; SVG: carga útil en base64 dentro de `<metadata>`). Abrir y arrastrar aceptan `.excalidraw`, `.json`, PNG y SVG: si traen escena incrustada se abre la escena (con confirmación si el dibujo actual no está vacío); si no, se inserta la imagen. La exportación siempre usa colores claros.
- Modo oscuro: Archivo > Tema claro, oscuro o del sistema (por defecto, el del sistema). Se guarda como preferencia del usuario en `localStorage` (`jaradraw:theme`), nunca en el archivo. Los colores guardados no cambian: al dibujar se transforman con el equivalente a `invert(93%) hue-rotate(180deg)` (las imágenes no se transforman).
- Biblioteca: botón de la barra. «Añadir a la biblioteca» (barra de acciones o Mayús+B) guarda la selección; un clic en una miniatura inserta una copia en el centro de la vista (un solo paso de deshacer); cada elemento tiene su botón de borrar. Importar y exportar en formato `.excalidrawlib` (versión 2; también se lee la versión 1).
- Marcos (tecla F): arrastra para crear; el nombre (por defecto «Marco») se edita con doble clic, Intro o desde la selección. Se seleccionan por el borde o el nombre, no por el interior. Los hijos (`frameId`) se recortan al marco al dibujar y exportar; al terminar un movimiento, redimensionado, giro o creación, un elemento (o un grupo entero, o una etiqueta con su contenedor) cuyo centro queda dentro de un marco pasa a ser su hijo. Mover, duplicar, copiar y girar un marco arrastra a sus hijos; borrar un marco libera a los hijos; redimensionarlo no escala a los hijos pero recalcula la pertenencia.

## Diagramas de flujo con el teclado

Con una figura (rectángulo, elipse o rombo, no bloqueada) seleccionada se puede construir un diagrama sin ratón. Secuencia típica: dibuja un rectángulo, luego `Intro`, escribe «Inicio», `Esc`, `Ctrl+→`, `Intro`, escribe «Validar», `Esc`, `Tab` (pasa a rombo), `Ctrl+↓`, y así sucesivamente.

- Mantén `Ctrl` (Cmd en macOS) y pulsa una flecha: aparece una vista previa semitransparente (50 %) de una figura del mismo tipo, tamaño y estilo (sin el texto), a 100 px de distancia en esa dirección, con su flecha enlazada. No se añade nada a la escena hasta soltar `Ctrl`: entonces se insertan figuras y flechas como un solo paso de deshacer, la figura más cercana al eje queda seleccionada y, si hace falta, se desplaza el lienzo (sin cambiar el zoom) para mostrarla. Mientras sigas con `Ctrl` pulsado, repetir la misma flecha añade un nodo más (hasta 9) como hijo del origen, cada uno con su flecha, en paralelo: lado a lado en perpendicular, a la misma distancia, separados por el tamaño de la figura más 40 px y centrados en el eje del origen. Con la cuadrícula activa se ajustan a ella. Si algún hueco centrado está ocupado, se rellenan los huecos libres en orden alterno (en el eje, a un lado, al otro, más lejos), de modo que volver al origen y repetir la dirección crea ramas. Pulsar otra flecha descarta lo pendiente y empieza de nuevo con un nodo en la nueva dirección. `Esc`, un clic, perder el foco de la ventana, ocultar la página o cualquier otra tecla descartan la vista previa sin insertar nada (y se restaura la vista del lienzo); la repetición automática de teclado se ignora. Con ninguna, varias o una selección que no sea una figura no ocurre nada.
- `Alt+Mayús+flecha` selecciona la figura conectada por una flecha (en cualquiera de los dos sentidos) que quede en esa dirección, la de menor ángulo y luego la más cercana. No añade historial.
- `Tab` / `Mayús+Tab` cambia el tipo de las figuras seleccionadas (rectángulo, rombo, elipse) conservando posición, tamaño, estilo, texto y enlaces; solo actúa si el foco está en el lienzo, no en un botón o campo, así que `Tab` sigue moviendo el foco en el resto de la interfaz. Al salir de una elipse, los bordes redondeados se toman del estilo actual.
- Tras `Esc` en el editor de texto, la figura sigue seleccionada y el teclado en el lienzo; un segundo `Esc` deselecciona.
- Las capas pasaron de `Ctrl+↑/↓` a `Re Pág` / `Av Pág` (con `Mayús`: al frente / al fondo).

## Almacenamiento

- Abrir una escena (selector, arrastrar o PNG/SVG con escena incrustada) cambia a la vez la escena, el nombre y el archivo recordado: un archivo arrastrado o un PNG/SVG no tiene identidad escribible, así que «Guardar» pregunta dónde guardar. Guardar, exportar y copiar comprueban que las imágenes tengan sus datos; si faltan tras la hidratación se pide confirmación (copiar se rechaza con un aviso).
- Los archivos de imagen de fuentes no confiables (pegar, abrir, arrastrar, importar biblioteca) solo se aceptan como `data:image/(png|jpeg|gif|webp|svg+xml);base64,` con `mimeType` coincidente y nunca sobrescriben una entrada existente.
- La recolección de basura de IndexedDB solo borra archivos con más de 24 horas; los guardados que desaparezcan se reescriben. Un fallo al guardar imágenes muestra su propio aviso y se reintenta en los siguientes guardados.
- La exportación limita el área a unos 64 millones de píxeles (reduce la escala y lo indica en el diálogo); la vista previa no supera unos 800 px.

- `localStorage`: escena sin binarios (`jaradraw:scene`) y preferencia de tema (`jaradraw:theme`).
- IndexedDB (base `jaradraw`): almacén `files` con los datos de las imágenes por `fileId` y almacén `library` con la biblioteca. Al arrancar se carga la escena, después se hidratan las imágenes y se vuelve a dibujar. Solo al arrancar se eliminan los archivos que no usa ningún elemento de la escena ni del historial. Si IndexedDB falla se muestra el aviso «No se pudo guardar» y la aplicación sigue funcionando.
- Los archivos `.excalidraw` incluyen los archivos de las imágenes usadas por elementos no borrados.

## Atajos

En macOS, Ctrl equivale a Cmd.

| Categoría | Acción | Atajo |
| --- | --- | --- |
| Herramientas | Selección, Mano | V (1), H |
| Herramientas | Rectángulo, Elipse, Rombo | R (2), O (3), D (4) |
| Herramientas | Flecha, Línea, Texto | A (5), L (6), T (7) |
| Herramientas | Lápiz, Borrador | P (8), E (0) |
| Herramientas | Marco, Imagen | F, 9 |
| Edición | Añadir a la biblioteca | Mayús+B |
| Edición | Agrupar / Desagrupar | Mayús+G / Mayús+U |
| Edición | Bloquear o desbloquear | Mayús+L |
| Edición | Voltear horizontal / vertical | Mayús+H / Mayús+V |
| Edición | Alinear izquierda / derecha | Ctrl+Mayús+← / Ctrl+Mayús+→ |
| Edición | Distribuir horizontal / vertical | solo botones |
| Edición | Alinear arriba, abajo, centros | solo botones |
| Edición | Rotar con paso de 15 grados | Mayús al girar |
| Vista | Cuadrícula | G, Ctrl+' |
| Vista | Guías inteligentes | Mayús+S |
| Vista | Suspender ajustes al arrastrar | Ctrl |
| Edición | Deshacer | Ctrl+Z |
| Edición | Rehacer | Ctrl+Mayús+Z, Ctrl+Y |
| Edición | Copiar, Cortar, Pegar | Ctrl+C, Ctrl+X, Ctrl+V |
| Edición | Duplicar | Mayús+D |
| Edición | Duplicar arrastrando y conectar con una flecha (un solo rectángulo, elipse o rombo) | Ctrl + arrastrar |
| Edición | Duplicar arrastrando sin flecha | Alt + arrastrar |
| Edición | Seleccionar todo | Ctrl+A |
| Edición | Eliminar | Supr, Retroceso |
| Edición | Traer al frente / Enviar al fondo | Mayús+Re Pág / Mayús+Av Pág |
| Edición | Mover 1 px / 10 px | Flechas / Mayús + flechas |
| Edición | Subir / Bajar una capa | Re Pág / Av Pág |
| Diagramas de flujo | Editar texto de forma o flecha | Intro |
| Diagramas de flujo | Vista previa de nodos conectados (repite la flecha para añadir en paralelo; suelta Ctrl para insertar) | Ctrl+← / → / ↑ / ↓ |
| Diagramas de flujo | Ir al nodo conectado | Alt+Mayús+← / → / ↑ / ↓ |
| Diagramas de flujo | Cambiar tipo de figura | Tab / Mayús+Tab |
| Edición | Editar puntos de línea o flecha | Ctrl+Intro |
| Vista | Acercar, Alejar, 100% | Ctrl++, Ctrl+-, Ctrl+0 |
| Vista | Zoom con rueda | Ctrl + rueda |
| Vista | Mover el lienzo | Espacio + arrastrar, rueda |
| Vista | Atajos de teclado | ? |
| Vista | Cancelar o deseleccionar | Esc |
| Archivo | Abrir | Ctrl+O |
| Archivo | Guardar, Guardar como | Ctrl+S, Ctrl+Alt+S |
| Archivo | Exportar imagen (PNG o SVG) | Mayús+E |

## Estructura

- `src/element`: tipos, fábrica, geometría, impactos, redimensionado, grupos, capas, clonado y estilo (lógica pura).
- `src/scene`: almacén de estado con historial, viewport, serialización, portapapeles, archivos, acciones y autoguardado.
- `src/render`: dibujo con roughjs, capa de selección y exportación.
- `src/ui`: componentes React, máquina de estados del puntero (`interaction.ts`) y registro único de atajos (`shortcuts.ts`).

## Diferencias conocidas con Excalidraw

- Enlaces de flechas: el extremo enlazado apunta siempre al centro de la forma y se coloca sobre su contorno real (rectángulo sin redondeo, elipse, rombo, con su ángulo) más un pequeño margen. Se escribe `focus: 0` y `gap: 4`. Los valores `focus` de archivos ajenos se conservan hasta que se recalcula ese extremo.
- Las relaciones colgantes al cargar (enlaces o `boundElements` hacia elementos inexistentes o borrados) se descartan sin aviso.
- Las curvas son splines de Catmull-Rom (`roundness: { type: 2 }`), no idénticas a las de Excalidraw. El punto de las flechas `circle` y `diamond` se rellena con el color de fondo.
- Abrir un archivo reinicia el historial y no se puede deshacer.
- Al cambiar de herramienta durante una línea de varios puntos, el trazo en curso se descarta.
- Alinear arriba, abajo y centros no tienen atajo: solo botón.
- Las líneas y flechas con `angle` distinto de 0 en un archivo se convierten a puntos al modificarlas por primera vez.
- Las guías inteligentes usan solo los elementos visibles (con un margen) y no se aplican al redimensionar elementos girados; un grupo no seleccionado cuenta como elementos sueltos.
- Un grupo se bloquea como unidad: si un miembro está bloqueado, lo están todos.
- Al transformar flechas enlazadas sin sus formas (girar, voltear, alinear, escalar, mover con flechas) se desenlazan.
- La escena incrustada en PNG y SVG sigue el esquema de Excalidraw (fragmento `tEXt`, sobre `bstring` con zlib; `<metadata>` con base64), pero no se ha podido comprobar con excalidraw.com: el viaje de ida y vuelta solo está verificado dentro de Jaradraw.
- El SVG se genera como texto con el generador de roughjs (`toPaths`, el mismo que usa su renderizador SVG) para poder probarlo sin DOM. El recorte de los hijos de un marco girado en SVG es aproximado.
- Los marcos se dibujan como contorno redondeado sin trazo a mano alzada y siempre por encima de sus hijos; los hijos conservan su posición en la lista (no se reordenan junto a su marco como hace Excalidraw). Mover con las flechas del teclado no recalcula la pertenencia a marcos.
- La tecla 9 pasa a ser Imagen (como en Excalidraw) y el Borrador usa E o 0.
- Las bibliotecas guardan además un campo `files` propio (extensión) con los datos de las imágenes que usan; Excalidraw lo ignora.
- El recorte (`crop`) de imágenes se conserva pero no se aplica.

## Guías inteligentes

Activadas por defecto (botón junto al zoom o Mayús+S; el campo `objectsSnapModeEnabled` del archivo se respeta si es `false`). Con tolerancia de 8 px de pantalla:
- Alineación: bordes y centros de la selección se ajustan a bordes y centros de otras figuras, incluido "empezar donde otra termina". Línea fina magenta desde la figura más lejana hasta la selección, con marcas en los puntos alineados.
- Espaciado igual: entre dos figuras, o continuando la separación de una fila (también un ritmo de tres o más). Se muestran segmentos con topes y el tamaño de un hueco.
- Se aplican al mover (selección, grupo), redimensionar sin rotación (con proporción bloqueada ajusta el eje dominante), crear figuras y arrastrar puntos de líneas y flechas (que se alinean con sus otros puntos; si la flecha se enlaza a una figura no se ajusta).
- Ctrl/Cmd suspende; con la cuadrícula activa manda la cuadrícula y no hay guías. Las guías nunca se guardan ni se exportan.
