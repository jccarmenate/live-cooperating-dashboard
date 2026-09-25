import { routePartykitRequest } from 'partyserver';
import { deriveKey, newRoomId, ROLE_HEADER, roleForKey } from './auth';
import type { Env } from './env';

export { Room } from './room';

function corsHeaders(req: Request, env: Env): Record<string, string> {
  const origin = req.headers.get('Origin');
  const allowed = env.ALLOWED_ORIGINS.split(',').map((o) => o.trim());
  if (!origin || !allowed.includes(origin)) return {};
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

async function createRoom(env: Env) {
  const roomId = newRoomId();
  const [editKey, viewKey] = await Promise.all([
    deriveKey(env.ROOM_SECRET, roomId, 'edit'),
    deriveKey(env.ROOM_SECRET, roomId, 'view'),
  ]);
  return { roomId, editKey, viewKey };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/health') return new Response('ok');

    if (url.pathname === '/api/rooms') {
      const cors = corsHeaders(req, env);
      if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
      if (req.method !== 'POST')
        return new Response('Method not allowed', { status: 405, headers: cors });
      return Response.json(await createRoom(env), { headers: cors });
    }

    const routed = await routePartykitRequest(req, env as unknown as Record<string, unknown>, {
      onBeforeConnect: async (request, lobby) => {
        const key = new URL(request.url).searchParams.get('key');
        const role = await roleForKey(env.ROOM_SECRET, lobby.name, key);
        if (!role) {
          // Reject here so an invalid key never wakes the Durable Object.
          const pair = new WebSocketPair();
          const client = pair[0];
          const server = pair[1];
          server.accept();
          server.close(4401, 'unauthorized');
          return new Response(null, { status: 101, webSocket: client });
        }
        const forwarded = new Request(request);
        // Never trust client-supplied routing/props headers.
        forwarded.headers.delete('x-partykit-room');
        forwarded.headers.delete('x-partykit-props');
        forwarded.headers.set(ROLE_HEADER, role);
        return forwarded;
      },
      // Rooms are only reachable over WebSocket.
      onBeforeRequest: () => new Response('Not found', { status: 404 }),
    });
    return routed ?? new Response('Not found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;
