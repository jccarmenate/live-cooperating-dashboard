import { MAX_ICS_BYTES } from '@relay/core';
import { ChevronLeft, ChevronRight, Ellipsis, Plus } from 'lucide-react';
import { type ChangeEvent, useCallback, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { ContextMenu, type MenuEntry } from '../ui/ContextMenu';
import { MEDIA, useMediaQuery } from '../ui/responsive';
import { toast } from '../ui/toasts';
import type { CalendarController } from './calendarController';
import { IcsImport, type IcsImportResult } from './IcsImport';
import { periodTitle } from './layout';

/** Hands `text` to the browser as a download named `<title>.ics`. */
function download(text: string, title: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title.replace(/[^\p{L}\p{N} ._-]+/gu, '_') || 'calendar'}.ics`;
  a.click();
  // Revoked after the click has been handled: some browsers cancel a download revoked at once.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** A header button without a background: one bg class each, so none overrides another. */
const base =
  'grid h-ctl place-items-center border-2 border-ink px-2 font-mono text-xs uppercase hover:bg-paper';
const btn = `${base} bg-white`;

export function CalendarHeader({
  session,
  ctl,
}: {
  session: BoardSession;
  ctl: CalendarController;
}) {
  const view = useStore(ctl.ui, (s) => s.view);
  const anchor = useStore(ctl.ui, (s) => s.anchor);
  const canEdit = useStore(session.conn.clock, (c) => c.role === 'edit');
  const title = useStore(
    session.doc,
    (d) => d.pages.find((p) => p.id === d.activePage)?.title ?? 'Calendar',
  );
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [result, setResult] = useState<IcsImportResult | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const closeResult = useCallback(() => setResult(null), []);
  // Matches the `max-sm:` and `short:` that hide the zone label in the header.
  const small = useMediaQuery(`${MEDIA.compact}, ${MEDIA.short}`);

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const file = input.files?.[0];
    // Cleared at once, so choosing the same file again fires another change.
    input.value = '';
    if (!file) return;
    if (file.size > MAX_ICS_BYTES) {
      toast('This file is larger than 1 MB');
      return;
    }
    // Reading is asynchronous: the import only lands on the calendar it was started from.
    const page = session.calendar.getState().pageId ?? undefined;
    const imported = ctl.importIcs(await file.text(), page);
    if (imported) setResult(imported);
  };

  const items: MenuEntry[] = [
    ...(small
      ? [
          {
            label: `Times in ${ctl.zone}`,
            testId: 'cal-menu-zone',
            disabled: true,
            onSelect: () => {},
          },
          { separator: true as const },
        ]
      : []),
    {
      label: 'Export .ics',
      testId: 'cal-export',
      onSelect: () => {
        const text = ctl.exportIcs(title);
        if (text !== null) download(text, title);
      },
    },
    ...(canEdit
      ? [
          {
            label: 'Import .ics…',
            testId: 'cal-import',
            onSelect: () => fileInput.current?.click(),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 border-b-2 border-ink bg-white px-3 py-2">
      <button
        type="button"
        data-testid="cal-prev"
        aria-label="Previous"
        className={btn}
        onClick={() => ctl.step(-1)}
      >
        <ChevronLeft size={14} />
      </button>
      <button type="button" data-testid="cal-today" className={btn} onClick={() => ctl.today()}>
        Today
      </button>
      <button
        type="button"
        data-testid="cal-next"
        aria-label="Next"
        className={btn}
        onClick={() => ctl.step(1)}
      >
        <ChevronRight size={14} />
      </button>
      <div className="flex">
        {(['month', 'week'] as const).map((v) => (
          <button
            key={v}
            type="button"
            data-testid={`cal-view-${v}`}
            aria-pressed={view === v}
            className={`${base} ${view === v ? 'bg-sun' : 'bg-white'} -ml-0.5 first:ml-0`}
            onClick={() => ctl.setView(v)}
          >
            {v === 'month' ? 'Month' : 'Week'}
          </button>
        ))}
      </div>
      <h2 data-testid="cal-title" className="min-w-40 font-display text-base">
        {periodTitle(view, anchor)}
      </h2>
      <div className="ml-auto flex items-center gap-3">
        {canEdit && (
          <button
            type="button"
            data-testid="cal-new"
            className={`${base} bg-sun`}
            onClick={() => ctl.newEvent()}
          >
            <span className="flex items-center gap-1">
              <Plus size={12} /> New event
            </span>
          </button>
        )}
        {/* Phones and short screens: in the ⋯ menu instead, so the header keeps to one row. */}
        <span
          data-testid="cal-zone"
          className="font-mono text-[11px] text-ink/60 max-sm:hidden short:hidden"
        >
          Times in {ctl.zone}
        </span>
        <button
          type="button"
          data-testid="cal-menu"
          aria-label="More calendar actions"
          aria-haspopup="menu"
          aria-expanded={menu !== null}
          className={btn}
          onClick={(e) => {
            // The menu keeps itself inside the viewport, so it lines up under the button's right.
            const r = e.currentTarget.getBoundingClientRect();
            setMenu({ x: r.left, y: r.bottom + 4 });
          }}
        >
          <Ellipsis size={14} />
        </button>
      </div>
      {canEdit && (
        <input
          ref={fileInput}
          type="file"
          accept=".ics,text/calendar"
          data-testid="cal-import-input"
          className="hidden"
          onChange={(e) => void onFile(e)}
        />
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={closeMenu} />}
      <IcsImport result={result} onClose={closeResult} />
    </div>
  );
}
