import { cellKey, gridOf, MAX_CELL_SRC, toDisplay } from '@relay/core';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { addressOf } from './layout';
import type { SheetController } from './sheetController';

/** The active cell's address and source (A1 form); editors edit it here too. */
export function FormulaBar({
  session,
  ctl,
  canEdit,
}: {
  session: BoardSession;
  ctl: SheetController;
  canEdit: boolean;
}) {
  const sheet = useStore(session.sheet, (s) => s.sheet);
  const anchor = useStore(ctl.ui, (s) => s.anchor);
  const editing = useStore(ctl.ui, (s) => s.editing);
  const address = sheet && anchor ? addressOf(sheet, anchor) : '';
  const stored = sheet && anchor ? (sheet.cells[cellKey(anchor.row, anchor.col)]?.src ?? '') : '';
  const shown = editing ? editing.draft : sheet ? toDisplay(stored, gridOf(sheet)) : '';
  return (
    <div className="flex h-9 shrink-0 items-center gap-2 border-b-2 border-ink bg-white px-2">
      <span data-testid="sheet-address" className="w-14 shrink-0 font-mono text-xs font-bold">
        {address}
      </span>
      <span className="font-mono text-xs text-ink/50" aria-hidden>
        fx
      </span>
      <input
        data-testid="formula-bar"
        aria-label="Cell contents"
        readOnly={!canEdit}
        value={shown}
        maxLength={MAX_CELL_SRC}
        className="min-w-0 flex-1 bg-transparent font-mono text-xs outline-none"
        onFocus={() => {
          if (canEdit && !ctl.ui.getState().editing) ctl.startEdit(undefined, 'bar');
        }}
        onChange={(e) => ctl.setDraft(e.target.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          // An IME composition uses Enter/Escape itself (Safari reports keyCode 229): leave them to it.
          if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
          if (e.key === 'Enter') {
            e.preventDefault();
            ctl.commitEdit({ dRow: e.shiftKey ? -1 : 1, dCol: 0 });
            e.currentTarget.blur();
          } else if (e.key === 'Escape') {
            ctl.cancelEdit();
            e.currentTarget.blur();
          }
        }}
        onBlur={() => {
          if (ctl.ui.getState().editing?.origin === 'bar') ctl.commitEdit();
        }}
      />
    </div>
  );
}
