import { worldToScreen } from '@relay/core';
import { useLayoutEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { mayEdit } from '../sync/clock';
import { clampBox } from './popover';

export function CommentComposer({ session }: { session: BoardSession }) {
  const { controller } = session;
  const composer = useStore(controller.ui, (s) => s.composer);
  const camera = useStore(controller.ui, (s) => s.camera);
  const viewport = useStore(controller.ui, (s) => s.viewport);
  const editable = useStore(session.conn.clock, mayEdit);
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 256, h: 80 });

  // Measured, so a comment placed near an edge opens wholly inside the board.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
  });

  if (!composer || !editable) return null;
  const p = worldToScreen(camera, composer.at);
  const want = { x: p.x + 12, y: p.y - 8 };
  const at = viewport ? clampBox(want, size, viewport) : want;
  return (
    <div
      ref={ref}
      className="absolute left-0 top-0 z-20 w-64 max-w-[calc(100%-1rem)] border-2 border-ink bg-white p-2 shadow-hard"
      style={{ transform: `translate(${at.x}px, ${at.y}px)` }}
    >
      <textarea
        // biome-ignore lint/a11y/noAutofocus: the composer exists to be typed into right away
        autoFocus
        data-testid="comment-composer"
        data-scroll-region
        aria-label="New comment"
        rows={3}
        placeholder="Add a comment… (Enter to post)"
        className="w-full resize-none bg-transparent font-mono text-xs outline-none"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault();
            controller.addComment(e.currentTarget.value);
          } else if (e.key === 'Escape') {
            controller.cancelComposer();
          }
        }}
      />
    </div>
  );
}
