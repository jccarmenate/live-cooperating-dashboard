import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { toast } from '../ui/toasts';
import { CellEditor } from './CellEditor';
import { FormatBar } from './FormatBar';
import { FormulaBar } from './FormulaBar';
import { SheetGrid } from './SheetGrid';
import { createSheetController, type SheetController } from './sheetController';
import { useSheetClipboard } from './useSheetClipboard';
import { useSheetKeys } from './useSheetKeys';

export function SheetPage({ session }: { session: BoardSession }) {
  const canEdit = useStore(session.conn.clock, (c) => c.role === 'edit');
  const hasSheet = useStore(session.sheet, (s) => s.sheet !== null);
  const [ctl, setCtl] = useState<SheetController | null>(null);

  useEffect(() => {
    const c = createSheetController({
      sheet: session.sheet,
      commit: session.controller.commit,
      canEdit: () => session.conn.clock.getState().role === 'edit',
      notify: toast,
    });
    // Publish only real changes: draft keystrokes change `editing` but not what peers see.
    let last = '';
    const publish = () => {
      const { anchor, focus, editing } = c.ui.getState();
      const next =
        anchor && focus
          ? {
              anchor: [anchor.row, anchor.col] as [string, string],
              focus: [focus.row, focus.col] as [string, string],
              editing: editing !== null,
            }
          : null;
      const key = JSON.stringify(next);
      if (key === last) return;
      last = key;
      session.publisher.setSheet(next);
    };
    publish();
    const unsubscribe = c.ui.subscribe(publish);
    setCtl(c);
    return () => {
      unsubscribe();
      session.publisher.setSheet(null);
      c.destroy();
    };
  }, [session]);

  useSheetKeys(session, ctl);
  useSheetClipboard(session, ctl);

  if (!ctl) return null;
  if (!hasSheet) {
    return (
      <div
        data-testid="unsupported-page"
        className="grid h-full place-items-center px-4 text-center font-mono text-xs"
      >
        This sheet could not be loaded.
      </div>
    );
  }
  return (
    <div data-testid="sheet-page" className="flex h-full min-h-0 flex-col">
      {canEdit && <FormatBar session={session} ctl={ctl} />}
      <FormulaBar session={session} ctl={ctl} canEdit={canEdit} />
      <SheetGrid
        session={session}
        ctl={ctl}
        canEdit={canEdit}
        overlay={<CellEditor session={session} ctl={ctl} />}
      />
    </div>
  );
}
