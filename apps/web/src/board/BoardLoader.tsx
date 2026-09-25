'use client';

import dynamic from 'next/dynamic';

const Board = dynamic(() => import('./Board').then((m) => m.Board), {
  ssr: false,
  loading: () => <p className="p-6 font-mono text-sm">Connecting…</p>,
});

export function BoardLoader({ roomId }: { roomId: string }) {
  return <Board roomId={roomId} />;
}
