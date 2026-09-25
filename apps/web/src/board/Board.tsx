'use client';

import { useEffect, useState } from 'react';
import { Canvas } from '../render/Canvas';
import { TextEditor } from '../render/TextEditor';
import { keyFromHash } from '../sync/key';
import { type BoardSession, createBoardSession } from './session';

export function Board({ roomId }: { roomId: string }) {
  const [session, setSession] = useState<BoardSession | null>(null);

  useEffect(() => {
    const s = createBoardSession(roomId, keyFromHash(window.location.hash));
    setSession(s);
    return () => s.destroy();
  }, [roomId]);

  if (!session) return null;

  return (
    <div className="fixed inset-0 flex flex-col bg-paper">
      <div className="relative flex-1 overflow-hidden">
        <Canvas session={session} />
        <TextEditor session={session} />
      </div>
    </div>
  );
}
