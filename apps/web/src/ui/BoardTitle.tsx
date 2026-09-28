import { MAX_BOARD_TITLE } from '@relay/core';
import { useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';

export function BoardTitle({ session }: { session: BoardSession }) {
  const title = useStore(session.doc, (d) => d.meta.title);
  const canEdit = useStore(session.conn.clock, (c) => c.role === 'edit');
  const [editing, setEditing] = useState(false);
  // One edit session commits at most once, whichever of Enter, Escape or blur comes first
  // (the input also blurs as it unmounts after Enter or Escape).
  const finished = useRef(false);

  const startEdit = () => {
    finished.current = false;
    setEditing(true);
  };

  /** Ends the edit, committing `value` unless it is null, empty or unchanged. */
  const finishEdit = (value: string | null) => {
    if (finished.current) return;
    finished.current = true;
    const text = value?.trim();
    if (text && text !== title) session.controller.renameBoard(text);
    setEditing(false);
  };

  if (editing) {
    return (
      <input
        // biome-ignore lint/a11y/noAutofocus: editing starts typing right away
        autoFocus
        data-testid="board-title-input"
        aria-label="Board title"
        defaultValue={title}
        maxLength={MAX_BOARD_TITLE}
        className="w-48 border-2 border-ink px-1 font-mono text-xs font-semibold outline-none"
        onKeyDown={(e) => {
          e.stopPropagation();
          // Enter that confirms an IME composition is not a commit.
          if (e.nativeEvent.isComposing) return;
          if (e.key === 'Enter') finishEdit(e.currentTarget.value);
          else if (e.key === 'Escape') finishEdit(null);
        }}
        onBlur={(e) => finishEdit(e.currentTarget.value)}
      />
    );
  }
  return canEdit ? (
    <button
      type="button"
      data-testid="board-title"
      title="Rename board"
      className="font-mono text-xs font-semibold hover:underline"
      onClick={startEdit}
    >
      {title}
    </button>
  ) : (
    <span data-testid="board-title" className="font-mono text-xs font-semibold">
      {title}
    </span>
  );
}
