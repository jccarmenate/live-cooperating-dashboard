'use client';

import { useEffect, useState } from 'react';
import { Canvas } from '../render/Canvas';
import { ColumnTitleEditor } from '../render/ColumnTitleEditor';
import { Minimap } from '../render/Minimap';
import { RemoteCursors } from '../render/RemoteCursors';
import { TextEditor } from '../render/TextEditor';
import { keyFromHash } from '../sync/key';
import { Header } from '../ui/Header';
import { StatusBanner } from '../ui/StatusBanner';
import { Toolbar } from '../ui/Toolbar';
import { useShortcuts } from '../ui/useShortcuts';
import { ZoomControls } from '../ui/ZoomControls';
import { type BoardSession, createBoardSession } from './session';

function BoardView({ session }: { session: BoardSession }) {
  useShortcuts(session.controller);
  return (
    <div className="fixed inset-0 flex flex-col bg-paper">
      <Header session={session} />
      <div className="relative flex-1 overflow-hidden">
        <Canvas session={session} />
        <RemoteCursors session={session} />
        <TextEditor session={session} />
        <ColumnTitleEditor session={session} />
        <Toolbar session={session} />
        <ZoomControls session={session} />
        <Minimap session={session} />
        <StatusBanner session={session} />
      </div>
    </div>
  );
}

export function Board({ roomId }: { roomId: string }) {
  const [session, setSession] = useState<BoardSession | null>(null);

  useEffect(() => {
    const s = createBoardSession(roomId, keyFromHash(window.location.hash));
    setSession(s);
    return () => s.destroy();
  }, [roomId]);

  return session ? <BoardView session={session} /> : null;
}
