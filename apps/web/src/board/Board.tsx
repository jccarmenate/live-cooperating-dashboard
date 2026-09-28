'use client';

import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { Canvas } from '../render/Canvas';
import { ColumnTitleEditor } from '../render/ColumnTitleEditor';
import { CommentComposer } from '../render/CommentComposer';
import { CommentLayer } from '../render/CommentLayer';
import { Minimap } from '../render/Minimap';
import { RemoteCursors } from '../render/RemoteCursors';
import { TextEditor } from '../render/TextEditor';
import { keyFromHash, pageFromHash } from '../sync/key';
import { CanvasMenu } from '../ui/CanvasMenu';
import { CommentsPanel } from '../ui/CommentsPanel';
import { Header } from '../ui/Header';
import { PageTabs } from '../ui/PageTabs';
import { StatusBanner } from '../ui/StatusBanner';
import { ToastHost } from '../ui/ToastHost';
import { Toolbar } from '../ui/Toolbar';
import { useClipboard } from '../ui/useClipboard';
import { useShortcuts } from '../ui/useShortcuts';
import { ZoomControls } from '../ui/ZoomControls';
import { type BoardSession, createBoardSession } from './session';

function BoardView({ session }: { session: BoardSession }) {
  useShortcuts(session);
  useClipboard(session);
  const type = useStore(session.doc, (d) => d.pages.find((p) => p.id === d.activePage)?.type);
  const hasPages = useStore(session.doc, (d) => d.pages.length > 0);
  const canEdit = useStore(session.conn.clock, (c) => c.role === 'edit');
  return (
    <div className="fixed inset-0 flex flex-col bg-paper">
      <Header session={session} />
      <PageTabs session={session} />
      {type === 'board' ? (
        <div className="relative flex-1 overflow-hidden">
          <Canvas session={session} />
          <RemoteCursors session={session} />
          <CommentLayer session={session} />
          <TextEditor session={session} />
          <ColumnTitleEditor session={session} />
          <CommentComposer session={session} />
          <Toolbar session={session} />
          <ZoomControls session={session} />
          <Minimap session={session} />
          <CommentsPanel session={session} />
          <CanvasMenu session={session} />
          <StatusBanner session={session} />
        </div>
      ) : (
        <div className="relative flex-1">
          {hasPages ? (
            <div
              data-testid="unsupported-page"
              className="grid h-full place-items-center px-4 text-center font-mono text-xs"
            >
              This page type is not available in this version yet.
            </div>
          ) : (
            <div
              data-testid="no-pages"
              className="flex h-full flex-col items-center justify-center gap-3 px-4 font-mono text-xs"
            >
              <p>No pages yet</p>
              {canEdit && (
                <button
                  type="button"
                  className="border-2 border-ink bg-white px-3 py-1.5 font-mono text-xs uppercase hover:bg-sun"
                  onClick={() => session.setPage(session.controller.createPage('board'))}
                >
                  New board
                </button>
              )}
            </div>
          )}
          <StatusBanner session={session} />
        </div>
      )}
      <ToastHost />
    </div>
  );
}

export function Board({ roomId }: { roomId: string }) {
  const [session, setSession] = useState<BoardSession | null>(null);

  useEffect(() => {
    const s = createBoardSession(
      roomId,
      keyFromHash(window.location.hash),
      pageFromHash(window.location.hash),
    );
    setSession(s);
    return () => s.destroy();
  }, [roomId]);

  return session ? <BoardView session={session} /> : null;
}
