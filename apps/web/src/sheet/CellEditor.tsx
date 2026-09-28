import { MAX_CELL_SRC } from '@relay/core';
import { useLayoutEffect, useRef } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { colOffsets, rangeBox } from './layout';
import { rangeOf, type SheetController } from './sheetController';

/** The inline editor over the active cell (edits that start in the grid). */
export function CellEditor({ session, ctl }: { session: BoardSession; ctl: SheetController }) {
  const sheet = useStore(session.sheet, (s) => s.sheet);
  const anchor = useStore(ctl.ui, (s) => s.anchor);
  const editing = useStore(ctl.ui, (s) => s.editing);
  const ref = useRef<HTMLInputElement>(null);
  const open = editing?.origin === 'cell';

  // Layout effect: the editor must hold focus before the next keystroke arrives (typing
  // "=A1*2" starts the edit with "=" and the rest must land in this input, not the window).
  useLayoutEffect(() => {
    if (!open) return;
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [open]);

  if (!open || !sheet || !anchor) return null;
  const r = rangeOf(sheet, anchor, anchor);
  if (!r) return null;
  const box = rangeBox(r, colOffsets(sheet.cols));
  return (
    <input
      ref={ref}
      data-testid="cell-editor"
      aria-label="Edit cell"
      value={editing.draft}
      maxLength={MAX_CELL_SRC}
      className="absolute z-20 border-2 border-cobalt bg-white px-1.5 font-mono text-xs outline-none"
      style={{ ...box, minWidth: box.width }}
      onChange={(e) => ctl.setDraft(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        // An IME composition uses Enter/Tab to pick a candidate: never commit mid-composition.
        if (e.nativeEvent.isComposing) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          ctl.commitEdit({ dRow: e.shiftKey ? -1 : 1, dCol: 0 });
        } else if (e.key === 'Tab') {
          e.preventDefault();
          ctl.commitEdit({ dRow: 0, dCol: e.shiftKey ? -1 : 1 });
        } else if (e.key === 'Escape') {
          e.preventDefault();
          ctl.cancelEdit();
        }
      }}
      onBlur={() => {
        if (ctl.ui.getState().editing?.origin === 'cell') ctl.commitEdit();
      }}
    />
  );
}
