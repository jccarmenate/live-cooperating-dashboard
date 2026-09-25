'use client';

export function Board({ roomId }: { roomId: string }) {
  return <p className="p-6 font-mono text-sm">Board {roomId}</p>;
}
