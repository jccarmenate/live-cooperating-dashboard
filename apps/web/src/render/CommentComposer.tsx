import { worldToScreen } from '@relay/core';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';

export function CommentComposer({ session }: { session: BoardSession }) {
  const { controller } = session;
  const composer = useStore(controller.ui, (s) => s.composer);
  const camera = useStore(controller.ui, (s) => s.camera);
  const role = useStore(session.conn.clock, (c) => c.role);
  if (!composer || role !== 'edit') return null;
  const p = worldToScreen(camera, composer.at);
  return (
    <div
      className="absolute left-0 top-0 z-20 w-64 border-2 border-ink bg-white p-2 shadow-hard"
      style={{ transform: `translate(${p.x + 12}px, ${p.y - 8}px)` }}
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
