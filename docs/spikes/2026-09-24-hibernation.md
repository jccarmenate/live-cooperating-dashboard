# Spike: WebSocket hibernation with y-partyserver

Date: 2026-09-24
Result: **Supported** — enabled via `static options = { hibernate: true }` on `Room`.

## Evidence (source inspection, partyserver 0.5.10 / y-partyserver 2.2.0)

- `partyserver`'s `Server` reads `static options.hibernate` and switches to a
  `HibernatingConnectionManager` built on the Durable Object hibernation API.
- `y-partyserver` stores the awareness client ids owned by each connection in
  the connection state (`__ypsAwarenessIds`), which partyserver persists to the
  WebSocket attachment "so it survives hibernation".
- On wake-up the DO runs `onStart` → our `onLoad`, which rebuilds the Y.Doc from
  the SQLite snapshot.

## Consequences for Relay

- In-memory state is lost on hibernation. `#frozen` is recomputed in `onLoad`;
  per-connection token buckets reset (acceptable: they only bound bursts).
- Connection roles live in connection state (`setState`), so they survive.
- The integration test "persists documents across a server restart" covers the
  same reload path hibernation uses.

## To verify after first deploy (F4)

- Cloudflare dashboard → Durable Objects → duration (GB-s) stays near zero for
  idle rooms with open sockets.
