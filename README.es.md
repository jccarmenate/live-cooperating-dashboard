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
GIF sale de la aplicación real, manejada por [`scripts/capture.mjs`](scripts/capture.mjs).*

## Qué hace

- **Colaboración en tiempo real.** Todas las formas (rectángulos, elipses, líneas, texto, notas
  adhesivas y bloques de código) se sincronizan en vivo. Las ediciones se fusionan carácter a
  carácter, así que dos personas pueden escribir a la vez en la misma nota.
- **Presencia.** Cursores remotos con nombre y color, selecciones remotas, avatares y el
  contador `N online`.
- **Edición.** Herramientas de selección, rectángulo, elipse, línea, texto, nota adhesiva y bloque de código, con atajos de teclado (`V R O L T S C`). Arrastrar para mover y redimensionar desde 8 asas (Shift mantiene las proporciones); selección por marquesina; las flechas mueven un poco la selección; `Ctrl+Z` / `Ctrl+Shift+Z` deshace y rehace solo tus propios cambios; doble clic para editar el texto.
- **Persistencia.** Cada sala vive en su propio Durable Object de Cloudflare, respaldado por
  SQLite. El navegador guarda además una copia local en IndexedDB para cargar al instante.
- **Enlaces con capacidades.** Sin cuentas. El enlace de una sala lleva una clave HMAC que da
  permiso de edición o solo de lectura. Lo aplica el servidor: los lectores pueden ver y
  mostrar su cursor, pero no escribir.

## Decisiones de ingeniería

La idea central es que **el documento es un CRDT y todo lo demás es una función pura de él**.

| Área | Decisión | Por qué importa |
|---|---|---|
| Modelo de datos | Las formas son un `Y.Map` de `Y.Map`. El orden en z usa índices fraccionales. El texto es `Y.Text`. | Las ediciones simultáneas sobre formas distintas nunca chocan y no hay un array de orden compartido por el que pelear. |
| Mutaciones | Cada cambio es un comando tipado que `applyCommand` aplica dentro de una transacción Yjs con origen local. | Un único camino de escritura. Se puede testear sin React y queda listo para el undo por usuario. |
| Lectura | "Normalizar al leer": conectores huérfanos, padres que no existen y empates de z se resuelven al leer. | Las réplicas pueden pasar por estados raros transitorios sin que nadie tenga que repararlos. |
| Estado de UI | Una máquina de estados pura para las herramientas, `(estado, evento) → (estado, efectos)`, vive en el paquete core. | Los gestos se prueban con tablas de transiciones. React solo dibuja snapshots y reenvía eventos del puntero. |
| Render | Renderer SVG propio. Solo se reconstruyen las formas que tocó cada transacción, y el resto conserva su identidad de objeto. | Cada forma solo vuelve a pintarse cuando cambia de verdad. |
| Convergencia | Un test basado en propiedades (fast-check) ejecuta tres réplicas con comandos concurrentes y orden de entrega aleatorios, y comprueba que el estado final es idéntico. En CI corren 10.000 casos cada noche. | La convergencia se prueba, no se da por hecha. |
| Seguridad | Las claves son capacidades HMAC-SHA-256 comparadas en tiempo constante. Las claves inválidas se rechazan en el Worker antes de despertar ningún Durable Object. El rol viaja en un header que el servidor sobrescribe, así que el cliente no puede falsificarlo. Hay límites de tamaño por mensaje y un token bucket por conexión. | Todo cabe en el plan gratuito, y un cliente hostil no puede escribir sin clave. |
| Edición de texto | Un `<textarea>` superpuesto cuyos cambios se aplican como diff sobre `Y.Text`. El diff nunca parte pares surrogate UTF-16 y el caret se recoloca cuando llegan ediciones remotas. | Los emoji y la escritura simultánea no se corrompen. |
| Preview local | Los arrastres y redimensionados se dibujan desde un overlay local en cada fotograma, mientras los commits al CRDT se limitan a 50 ms | Gestos fluidos a 60 fps sin inundar a los demás ni el cupo de peticiones del plan gratuito |
| Deshacer | Un `Y.UndoManager` por usuario que solo sigue los orígenes de este cliente; un paso por gesto o por sesión de edición de texto; se prueba con fuzzing en el test de convergencia | Deshacer nunca revierte el trabajo de otra persona, y las réplicas siguen convergiendo |

El razonamiento completo está en la [spec de diseño](docs/superpowers/specs/2026-09-24-relay-design.md), junto con las
alternativas descartadas (tldraw, Canvas 2D, y-websocket en un host Node). La construcción siguió planes de
implementación escritos para [F0/F1](docs/superpowers/plans/2026-09-24-relay-f0-f1-foundation-mvp.md)
y [F2a](docs/superpowers/plans/2026-09-26-relay-f2a-editing.md), con
revisión de spec y de calidad de código después de cada tarea.

## Arquitectura

```mermaid
flowchart LR
  subgraph Browser["Navegador (Next.js, tablero solo en cliente)"]
    UI[Toolbar · Header · Overlays] --> FSM[FSM de herramientas<br/>@relay/core]
    FSM -->|efectos| CMD[applyCommand<br/>@relay/core]
    CMD -->|transact LOCAL| YD[(Y.Doc)]
    YD -->|observeDeep| Z[Snapshots en Zustand]
    Z --> R[Renderer SVG]
    YD <--> IDB[(IndexedDB)]
  end
  subgraph Cloudflare["Cloudflare (plan gratuito)"]
    W[Router del Worker<br/>verificación HMAC] --> DO[Durable Object por sala<br/>y-partyserver]
    DO --> SQL[(Snapshot en SQLite)]
  end
  YD <-->|WebSocket: sync Yjs + awareness| W
```

```
relay/
├─ packages/core       TypeScript sin dependencias de plataforma: esquema, comandos, geometría, FSM, presencia
├─ apps/sync-server    Cloudflare Worker + un Durable Object por sala (y-partyserver)
├─ apps/web            Next.js 16 App Router, Tailwind 4, Zustand
├─ e2e/                Playwright con dos contextos de navegador independientes
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
npm run dev        # web → http://localhost:3000 · sync → http://localhost:8787
```

Abre <http://localhost:3000>, pulsa **New board** y comparte el enlace con otro navegador o
una ventana privada.

**Colaboradores automáticos.** Mira cómo se llena el tablero con bots que usan la UI real:

```bash
npm run demo:bot -- --role writer            # crea una sala y escribe una retro
npm run demo:bot -- --role mover <url-tablero> # se une, mueve formas y añade "+1"
```

O con Docker: `docker compose up`.

## Tests

```bash
npm test         # tests unitarios, de propiedades y de integración (≈140)
npm run e2e      # Playwright: dos usuarios colaborando, edición con doble clic, enlaces inválidos,
                 # redimensionado + deshacer/rehacer visto por un segundo usuario, marquesina + borrado, dibujo de elipses/líneas/bloques de código
npm run lint && npm run typecheck
```

| Suite | Qué demuestra |
|---|---|
| `packages/core` (Vitest + fast-check) | Geometría, tablas de transiciones de la FSM, comandos sobre un `Y.Doc` real, diff de texto (incluidos emoji), geometría de redimensionado, hit-testing de marquesina, deshacer por usuario y convergencia de tres réplicas |
| `apps/sync-server` (Vitest + `wrangler dev` real) | Sincronización entre editores, lectores de solo lectura, 4401 con claves inválidas, header de rol falsificado, límites de mensaje y de awareness, tope de tamaño y persistencia tras reiniciar el servidor |
| `apps/web` (Vitest) | El puente Yjs → Zustand (solo se reconstruyen las formas tocadas), el controlador del tablero (commits de arrastre con throttle, overlay local, deshacer/rehacer) y la firma de presencia |
| `e2e/` (Playwright) | Dos navegadores ven las ediciones y los cursores con nombre del otro, el estado sobrevive a que todos se vayan, la edición con doble clic, el rechazo de enlaces inválidos, redimensionado + deshacer/rehacer visto por un segundo usuario, selección por marquesina + borrado, y el dibujo de elipses/líneas/bloques de código |

## Hoja de ruta

Construido por fases desplegables; los detalles están en la spec.

- [x] **F0 — Base:** monorepo, CI, tokens de diseño, spike que confirma el soporte de hibernación de WebSockets
- [x] **F1 — MVP:** formas, notas y textos en vivo, cursores, presencia, persistencia, enlaces con capacidades
- [x] **F2a — Edición core:** deshacer/rehacer por usuario, asas de redimensionado, selección por marquesina, elipses, líneas, bloques de código, preview de arrastre a 60 fps
- [ ] **F2b — Estructura:** conectores anclados, frames con columnas
- [ ] **F3 — Navegación y sesión:** zoom al cursor, minimapa, temporizador de votación compartido, "Typing…", comentarios
- [ ] **F4 — Publicación:** interfaz de enlaces para compartir, sala demo que se reinicia cada noche, endurecimiento del protocolo, despliegue (Vercel + Workers), pulido offline
- [ ] **F5 — IA:** "Cluster & summarize" para retros. El agrupamiento es determinista (embeddings más clustering aglomerativo) y corre en Workers AI; la salida del LLM se valida con un esquema y se mide con Adjusted Rand Index.

**Limitaciones conocidas (previstas para F2/F4):**
- El protocolo de sincronización necesita el endurecimiento de F4 (validación de frames de awareness, un estimador de tamaño más fino) antes de abrir la sala demo pública.

## Licencia

Aún no se ha elegido licencia. Mientras no se añada una, todos los derechos quedan reservados por el autor.
