'use client';

import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { CalendarPage } from '../calendar/CalendarPage';
import { Canvas } from '../render/Canvas';
import { ColumnTitleEditor } from '../render/ColumnTitleEditor';
import { CommentComposer } from '../render/CommentComposer';
import { CommentLayer } from '../render/CommentLayer';
import { ConnectorLabelEditor } from '../render/ConnectorLabelEditor';
import { EmptyHint } from '../render/EmptyHint';
import { Minimap } from '../render/Minimap';
import { RemoteCursors } from '../render/RemoteCursors';
import { TextEditor } from '../render/TextEditor';
import { SheetPage } from '../sheet/SheetPage';
import { mayEdit } from '../sync/clock';
import { keyFromHash, pageFromHash } from '../sync/key';
import { AddToCalendarDialog } from '../ui/AddToCalendarDialog';
import { AlgorithmsPanel } from '../ui/AlgorithmsPanel';
import { CanvasMenu } from '../ui/CanvasMenu';
import { CommentsPanel } from '../ui/CommentsPanel';
import { FullNotice } from '../ui/FullNotice';
import { Header } from '../ui/Header';
import { HelpDialog } from '../ui/HelpDialog';
import { NewGraphDialog } from '../ui/NewGraphDialog';
import { PageTabs } from '../ui/PageTabs';
import { PropertiesBar } from '../ui/PropertiesBar';
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
  const canEdit = useStore(session.conn.clock, mayEdit);
  return (
    <div className="safe-area fixed inset-0 flex flex-col bg-paper">
      <Header session={session} />
      <PageTabs session={session} />
      <FullNotice session={session} />
      {type === 'board' ? (
        <div className="relative flex-1 overflow-hidden">
          <Canvas session={session} />
          <EmptyHint session={session} />
          <RemoteCursors session={session} />
          <CommentLayer session={session} />
          <TextEditor session={session} />
          <ConnectorLabelEditor session={session} />
          <ColumnTitleEditor session={session} />
          <CommentComposer session={session} />
          <Toolbar session={session} />
          <PropertiesBar session={session} />
          <ZoomControls session={session} />
          <Minimap session={session} />
          <CommentsPanel session={session} />
          <AlgorithmsPanel session={session} />
          <CanvasMenu session={session} />
          <HelpDialog session={session} />
          <NewGraphDialog session={session} />
          <AddToCalendarDialog session={session} />
          <StatusBanner session={session} />
        </div>
      ) : type === 'sheet' ? (
        <div className="relative min-h-0 flex-1">
          <SheetPage session={session} />
          <StatusBanner session={session} />
        </div>
      ) : type === 'calendar' ? (
        <div className="relative min-h-0 flex-1">
          <CalendarPage session={session} />
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
                  className="border-2 border-ink bg-white px-3 py-1.5 pointer-coarse:py-2.5 font-mono text-xs uppercase hover:bg-sun"
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
