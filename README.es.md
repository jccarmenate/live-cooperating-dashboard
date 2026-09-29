# Relay — pizarra multijugador en vivo

[![CI](https://github.com/jccarmenate/live-cooperating-dashboard/actions/workflows/ci.yml/badge.svg)](https://github.com/jccarmenate/live-cooperating-dashboard/actions/workflows/ci.yml)
[![Nightly convergence](https://github.com/jccarmenate/live-cooperating-dashboard/actions/workflows/nightly.yml/badge.svg)](https://github.com/jccarmenate/live-cooperating-dashboard/actions/workflows/nightly.yml)
![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6)
![Yjs](https://img.shields.io/badge/CRDT-Yjs-f5d547)
![Cloudflare](https://img.shields.io/badge/Cloudflare-Durable%20Objects-f38020)
![Cost](https://img.shields.io/badge/hosting-%240-111111)

Un lienzo compartido donde los cursores, las formas y las ediciones se sincronizan al instante
entre todos los miembros de una sala. Sin registro: abres el enlace y ya estás dentro.

[Read in English](README.md)

![Dos usuarios anónimos editando el mismo tablero a la vez](docs/demo.gif)

*Dos navegadores independientes, dos usuarios anónimos, un solo tablero. Cada fotograma del
GIF sale de la aplicación real, controlada por [`scripts/capture.mjs`](scripts/capture.mjs). La
grabación es del primer hito; más abajo están las funciones posteriores.*

## Qué hace

- **Colaboración en tiempo real.** Todo se sincroniza en vivo: formas, conectores, frames, texto, votos, comentarios, páginas y celdas de hojas de cálculo. El texto se fusiona carácter a carácter, así que dos personas pueden escribir a la vez en la misma nota.
- **Herramientas del tablero:**
  - Formas: rectángulos, elipses, líneas, texto, notas adhesivas y bloques de código. Rectángulo, elipse y línea comparten un único botón **Shapes** en la barra, con un menú desplegable (`R`, `O` y `L` siguen funcionando).
  - **Conectores** anclados a las formas que unen, rectos o en codo. Un conector puede llevar una etiqueta de hasta 40 caracteres, dibujada en su punto medio; se edita con doble clic.
  - **Frames con columnas** para retrospectivas. Adoptan las formas que caen dentro y las cuentan por columna.
  - Redimensionado desde 8 asas, selección por marquesina, desplazamiento con las flechas y doble clic para editar el texto.
- **Menús contextuales y portapapeles.** El clic derecho sobre cualquier elemento ofrece:
  - cortar, copiar, pegar y duplicar;
  - traer al frente y enviar atrás;
  - colores de relleno, bloquear y comentar.

  Copiar y pegar usan el portapapeles del sistema, así que se pueden llevar formas de un tablero a otro, y el texto de otras apps se pega como nota. Una barra de propiedades flotante cambia relleno, borde, fuente y tamaño de texto. Nadie puede mover, redimensionar, borrar ni editar una forma bloqueada.
- **Navegación.** Zoom centrado en el cursor (10–400 %), desplazamiento con Espacio+arrastrar o con la rueda, y ajuste de zoom al contenido. El minimapa es interactivo y muestra dónde mira cada persona. Cada página recuerda su propia cámara.
- **Sesión.** Hay un temporizador de votación por puntos que corre con la hora del servidor, con límite de votos por persona y recuentos en vivo. Los comentarios se anclan a formas o a puntos del lienzo, con respuestas y opción de resolverlos.
- **Páginas.** Una sala contiene varias páginas en pestañas que se pueden renombrar, reordenar y borrar. Cada página tiene su propio contenido, cámara y presencia.
- **Hojas de cálculo.** Una página puede ser una hoja de cálculo compartida en lugar de un tablero:
  - filas y columnas tienen ids estables, así que sobreviven a inserciones, borrados y movimientos simultáneos;
  - un motor de fórmulas escrito a mano con `SUM`, `AVERAGE`, `MIN`, `MAX`, `COUNT`, `ROUND`, `ABS` e `IF`, operadores, rangos, valores de error y detección de ciclos;
  - copiar y pegar usan texto separado por tabuladores, compatible con Excel y Google Sheets;
  - controlador de relleno y `Ctrl+D`, además de negrita, alineación y formatos numéricos;
  - el rango que tiene seleccionado cada persona se ve en vivo.
- **Grafos.** El botón **Graph** (o `G`) abre un menú:
  - **New graph…** genera un grafo completo, ciclo, camino, estrella, rueda, bipartito completo, cuadrícula, árbol k-ario o aleatorio G(n, p), dirigido o con pesos si se quiere. También lo construye a partir de una lista de aristas pegada (`A-B`, `A->B`, `A-B:5`) e indica los errores línea a línea. Cada familia tiene su propia disposición, y las listas de aristas usan una disposición por fuerzas determinista. Un grafo tiene como máximo 100 nodos y 500 aristas, y se deshace entero en un solo paso.
  - **Algorithms…** ejecuta BFS, DFS, camino más corto (Dijkstra), árbol generador mínimo (Kruskal) y componentes conexas sobre la selección, o sobre toda la página si no hay nada seleccionado. Si la etiqueta de un conector es un número, ese es el peso de la arista. Los resultados son una capa local (orden de visita, camino, árbol, colores por componente) que nunca se sincroniza; Escape o **Clear** la quitan. Los lectores también pueden ejecutar algoritmos.
- **Presencia.** Cursores y selecciones remotos con nombre y color, una etiqueta "typing…" sobre la forma que otro está editando, y puntos en cada pestaña con quién está en esa página.
- **Compartir.** Sin cuentas. El enlace de una sala lleva una clave HMAC que da permiso de edición o solo de lectura, y el servidor lo hace cumplir. El diálogo Share muestra los dos enlaces.
- **Ayuda.** `?` muestra todos los atajos, y una página vacía muestra una pista para empezar.

## Decisiones de ingeniería

La idea central es que **el documento es un CRDT y todo lo demás es una función pura de él**.

| Área | Decisión | Por qué importa |
|---|---|---|
| Modelo de datos | Formas, conectores, comentarios y páginas son `Y.Map` indexados por id. El orden en z usa índices fraccionales. El texto es `Y.Text`. | Las ediciones simultáneas sobre elementos distintos nunca chocan, y no hay un array de orden compartido por el que pelear. |
| Mutaciones | Cada cambio es un comando tipado que `applyCommand` aplica dentro de una transacción Yjs con un origen: `LOCAL`, o `SESSION` para votos, comentarios y páginas, que el deshacer no sigue. | Un único camino de escritura. Se puede probar sin React y define exactamente qué puede deshacerse. |
| Lectura | Los conectores huérfanos, los padres inexistentes, las páginas borradas y los empates de z se resuelven al leer el documento ("normalizar al leer"). | Las réplicas pueden pasar por estados raros transitorios sin que nadie tenga que repararlos. |
| Borrados definitivos | Una página borrada queda registrada en un mapa plano de lápidas de una sola escritura, nunca como un indicador en el mapa de la página. | Un renombrado o un movimiento simultáneo nunca resucita una página borrada. |
| Estado de UI | Una máquina de estados pura para las herramientas, `(estado, evento) → (estado, efectos)`, vive en el paquete core. El bloqueo se aplica allí y también en los comandos. | Los gestos se prueban con tablas de transiciones. React solo pinta snapshots y reenvía los eventos del puntero. |
| Render | Renderer SVG propio. Solo se reconstruyen las formas que tocó cada transacción, y el resto conserva su identidad de objeto. | Cada forma solo vuelve a pintarse cuando cambia de verdad. |
| Convergencia | Tests basados en propiedades (fast-check) ejecutan tres réplicas con comandos concurrentes aleatorios (formas, votos, comentarios, páginas, orden en z, estilo y bloqueo) y un orden de entrega aleatorio, y comprueban que el estado final es idéntico. En CI corren 10.000 casos cada noche. | La convergencia se prueba, no se da por hecha. |
| Tiempo | Los plazos de votación son marcas de tiempo absolutas del servidor. El cliente aplica el desfase de reloj que obtiene de los mensajes `hello`/`time`, y el estado "abierto" se deriva en lugar de guardarse. | Ningún reloj de cliente puede alargar una votación, y nadie tiene que escribir nada cuando termina el temporizador. |
| Deshacer | Un `Y.UndoManager` por usuario sigue solo los orígenes de este cliente. Cada gesto, pegado o sesión de edición de texto es un paso, y cambiar de página vacía la pila. | Deshacer nunca revierte el trabajo de otra persona ni cambia una página que no estás viendo. |
| Seguridad | Las claves son capacidades HMAC-SHA-256 comparadas en tiempo constante y verificadas antes de despertar ningún Durable Object. El servidor sobrescribe el header de rol y los mensajes tienen límites de tamaño. Cada conexión tiene un token bucket, y se rechaza un pegado de más de 192 KiB. | Todo cabe en el plan gratuito, y un cliente hostil no puede escribir sin clave. |
| Edición de texto | Un `<textarea>` superpuesto aplica sus cambios como diff sobre `Y.Text`. El diff nunca parte pares surrogate UTF-16, y el caret se recoloca cuando llegan ediciones remotas. | Los emoji y la escritura simultánea no se corrompen. |
| Modelo de hojas | Filas y columnas son mapas anidados con un orden fraccional, y las celdas viven en un único mapa plano indexado por id de fila y de columna. Las fórmulas guardan las referencias por id, y la evaluación es una pasada pura y determinista por filas, con un límite de profundidad. | Insertar o mover una fila nunca reescribe una fórmula, y un movimiento y un borrado simultáneos no pueden resucitar una fila. |
| Grafos | Un grafo está hecho de elipses y conectores normales, y los algoritmos son funciones puras del paquete core. | La colaboración, el deshacer, el portapapeles y los estilos funcionan con los grafos sin trabajo extra, y cada algoritmo se prueba sin navegador. |
| Vista previa local | Los arrastres y redimensionados se pintan en cada fotograma desde un overlay local, y los commits al CRDT se limitan a uno cada 50 ms. | Gestos fluidos a 60 fps sin saturar a los demás ni el cupo de peticiones del plan gratuito. |

El razonamiento completo, junto con las alternativas descartadas (tldraw, Canvas 2D,
y-websocket en un host Node), está en la [spec de diseño](docs/superpowers/specs/2026-09-24-relay-design.md).
Cada fase siguió un plan de implementación escrito, con revisión de spec y de calidad de
código después de cada tarea:
[F0/F1](docs/superpowers/plans/2026-09-24-relay-f0-f1-foundation-mvp.md) ·
[F2a](docs/superpowers/plans/2026-09-26-relay-f2a-editing.md) ·
[F2b](docs/superpowers/plans/2026-09-26-relay-f2b-structure.md) ·
[F3a](docs/superpowers/plans/2026-09-27-relay-f3a-navigation.md) ·
[F3b](docs/superpowers/plans/2026-09-27-relay-f3b-session.md) ·
[F4 P1](docs/superpowers/plans/2026-09-27-relay-p1-pages.md) ·
[F4 P2](docs/superpowers/plans/2026-09-27-relay-p2-canvas-ux.md) ·
[F4 P3](docs/superpowers/plans/2026-09-28-relay-p3-sheets.md) ·
[F4 P4](docs/superpowers/plans/2026-09-29-relay-p4-graphs.md).

## Arquitectura

```mermaid
flowchart LR
  subgraph Browser["Navegador (Next.js, tablero solo en cliente)"]
    UI[Toolbar · Menús · Overlays] --> FSM[FSM de herramientas<br/>@relay/core]
    FSM -->|efectos| CMD[applyCommand<br/>@relay/core]
    UI -->|menús, portapapeles, páginas| CMD
    CMD -->|transact LOCAL / SESSION| YD[(Y.Doc)]
    YD -->|observeDeep| Z[Snapshots en Zustand<br/>página activa]
    Z --> R[Renderer SVG]
    YD <--> IDB[(IndexedDB)]
  end
  subgraph Cloudflare["Cloudflare (plan gratuito)"]
    W[Router del Worker<br/>verificación HMAC] --> DO[Durable Object por sala<br/>y-partyserver · hora del servidor]
    DO --> SQL[(Snapshot en SQLite)]
  end
  YD <-->|WebSocket: sync Yjs + awareness| W
```

```
relay/
├─ packages/core       TypeScript sin dependencias de plataforma: esquema, comandos, geometría, FSM, portapapeles, presencia, fórmulas, grafos
├─ apps/sync-server    Cloudflare Worker + un Durable Object por sala (y-partyserver)
├─ apps/web            Next.js 16 App Router, Tailwind 4, Zustand
├─ e2e/                Playwright, con un contexto de navegador independiente por usuario
└─ scripts/            Bot de demo + captura del material del README
```

## Stack

**Frontend:** Next.js 16, React 19, TypeScript 5.9, Tailwind CSS 4, Zustand 5 ·
**Tiempo real:** Yjs 13, y-partyserver, y-indexeddb ·
**Backend:** Cloudflare Workers + Durable Objects (SQLite), Wrangler 4 ·
**Calidad:** Vitest 4, fast-check, Playwright, Biome, GitHub Actions.

Todo funciona en planes gratuitos y sin tarjeta: Vercel Hobby para la web y el plan gratuito
de Cloudflare Workers para la sincronización.

## Ejecutarlo en local

Requiere Node ≥ 22. No hace falta cuenta de Cloudflare: Wrangler ejecuta el Worker en local.

```bash
npm install
npm run dev        # web → http://localhost:4000 · sync → http://localhost:8787
```

Abre <http://localhost:4000>, pulsa **New board** y abre el enlace en otro navegador o en una
ventana privada. **SHARE** te da un enlace de edición y otro de solo lectura.

(La web usa el puerto 4000 porque Windows suele reservar el rango 2900–3100.)

**Colaboradores automáticos.** Mira cómo se llena el tablero con bots que usan la UI real:

```bash
npm run demo:bot -- --role writer              # crea una sala y escribe una retro
npm run demo:bot -- --role mover <url-tablero> # se une, mueve formas y añade "+1"
```

O con Docker: `docker compose up`.

## Tests

```bash
npm test         # 659 tests unitarios, de propiedades y de integración (core 370 · web 263 · sync-server 26)
npm run e2e      # 32 escenarios de Playwright con varios navegadores independientes
npm run lint && npm run typecheck
```

| Suite | Qué demuestra |
|---|---|
| `packages/core` (Vitest + fast-check) | Geometría, tablas de transiciones de la FSM (incluido el bloqueo), comandos sobre un `Y.Doc` real, la validación del portapapeles y la reasignación de ids, el diff de texto con emoji, el deshacer por usuario, los recuentos de votos, las lápidas de páginas, el parser y el evaluador de fórmulas, las familias, disposiciones y algoritmos de grafos, y la convergencia de tres réplicas para formas, datos de sesión, páginas y hojas |
| `apps/sync-server` (Vitest + `wrangler dev` real) | Sincronización entre editores, lectores de solo lectura, 4401 con claves inválidas, header de rol falsificado, límites de mensaje y de awareness, tope de tamaño, hora del servidor y persistencia tras reiniciar el servidor |
| `apps/web` (Vitest) | La proyección Yjs → Zustand por página, el controlador del tablero (arrastres con throttle, portapapeles, orden en z, estilo, bloqueo, menús y pasos de deshacer), los atajos y los permisos por rol, los temporizadores de votación, los enlaces de compartir, los avisos, el controlador y las teclas de las hojas, y la creación de grafos |
| `e2e/` (Playwright) | Estos escenarios: dos usuarios que ven las ediciones y los cursores del otro; conectores y frames; zoom, minimapa y restauración de la cámara; votación y comentarios entre usuarios; crear, reordenar y borrar páginas, y enlaces con hash; menús contextuales, portapapeles, bloqueo, ayuda y límites de los lectores; edición de hojas de cálculo entre usuarios; familias de grafos, listas de aristas, etiquetas y capas de algoritmos |

## Hoja de ruta

Se construye por fases, cada una desplegable; los detalles están en la spec.

- [x] **F0 — Base:** monorepo, CI, tokens de diseño, un spike que confirma el soporte de hibernación de WebSockets
- [x] **F1 — MVP:** formas, notas y texto en vivo, cursores, presencia, persistencia, enlaces con capacidades
- [x] **F2 — Edición y estructura:** deshacer/rehacer por usuario, redimensionado, marquesina, elipses, líneas, bloques de código, conectores anclados, frames con columnas
- [x] **F3 — Navegación y sesión:** zoom y desplazamiento, un minimapa interactivo, selecciones remotas y "typing…", hora del servidor, votación por puntos, comentarios
- [ ] **F4 — Espacio de trabajo**
  - [x] **P1 páginas:** pestañas, contenido y presencia por página, el diálogo Share, título editable
  - [x] **P2 UX del lienzo:** menús contextuales, portapapeles del sistema, barra de propiedades, orden en z, bloqueo, ayuda y pulido
  - [x] **P3 páginas de hoja de cálculo:** filas y columnas con ids estables, motor de fórmulas, copiar y pegar compatible con Excel, relleno, formatos, rangos de los demás en vivo
  - [x] **P4 grafos:** familias de grafos y listas de aristas con disposición automática, etiquetas en conectores, capas locales de algoritmos, el desplegable Shapes
  - [ ] **P5 página de calendario** (mes y semana), la siguiente
- [ ] **F5 — Publicación:** sala demo que se reinicia cada noche, endurecimiento del protocolo, despliegue (Vercel + Workers), pulido offline
- [ ] **F6 — IA:** "Cluster & summarize" para retros. El agrupamiento es determinista (embeddings más clustering aglomerativo) y corre en Workers AI. La salida del LLM se valida con un esquema y se mide con el Adjusted Rand Index.

**Limitaciones conocidas (previstas para F5):**
- El protocolo de sincronización necesita una fase de endurecimiento antes de abrir la sala demo pública:
  - validación estricta de los frames de awareness;
  - un estimador de tamaño de documento más fino;
  - mostrar en la UI los cierres por "mensaje demasiado grande".

## Licencia

Aún no se ha elegido licencia. Mientras no se añada una, todos los derechos quedan reservados por el autor.
