import { Redo2, Undo2 } from 'lucide-react';
import type { PointerEvent } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';

// Focus stays where it is: a press never blurs (and so commits) a cell or text being edited.
const keepFocus = (e: PointerEvent) => e.preventDefault();

const button =
  'grid size-ctl-sm place-items-center border-2 border-ink bg-white hover:bg-sun disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white';

/**
 * Undo and redo for this user's own steps, on every page type. On a touch screen they are the
 * only way to undo: Ctrl+Z needs a keyboard.
 */
export function UndoRedo({ session }: { session: BoardSession }) {
  const { controller } = session;
  const canUndo = useStore(controller.ui, (s) => s.canUndo);
  const canRedo = useStore(controller.ui, (s) => s.canRedo);
  const canEdit = useStore(session.conn.clock, (c) => c.role === 'edit');
  if (!canEdit) return null;
  return (
    <div className="flex h-row shrink-0 items-end gap-1 border-b-2 border-ink bg-paper pr-3 pb-0.5 pl-1">
      <button
        type="button"
        data-testid="undo"
        aria-label="Undo (Ctrl+Z)"
        title="Undo (Ctrl+Z)"
        disabled={!canUndo}
        className={button}
        onPointerDown={keepFocus}
        onClick={() => controller.undo()}
      >
        <Undo2 size={14} />
      </button>
      <button
        type="button"
        data-testid="redo"
        aria-label="Redo (Ctrl+Shift+Z)"
        title="Redo (Ctrl+Shift+Z)"
        disabled={!canRedo}
        className={button}
        onPointerDown={keepFocus}
        onClick={() => controller.redo()}
      >
        <Redo2 size={14} />
      </button>
    </div>
  );
}
