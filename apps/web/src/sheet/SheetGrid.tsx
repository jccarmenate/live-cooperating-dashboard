import { type CellValue, cellKey, colLetters, defaultAlign, formatValue } from '@relay/core';
import { memo, type ReactNode, useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { onPage } from '../render/pageFilter';
import { colOffsets, HEADER_H, ROW_H, ROW_HEADER_W, rangeBox, visibleRows } from './layout';
import { type CellPos, rangeOf, type SheetController } from './sheetController';

const EMPTY: CellValue = { t: 'empty' };

const Cell = memo(function Cell({
  address,
  row,
  col,
  width,
  text,
  align,
  bold,
}: {
  address: string;
  row: string;
  col: string;
  width: number;
  text: string;
  align: 'left' | 'center' | 'right';
  bold: boolean;
}) {
  return (
    <div
      data-cell
      data-row={row}
      data-col={col}
      data-testid={`cell-${address}`}
      className={`shrink-0 truncate border-b border-r border-ink/15 px-1.5 font-mono text-xs leading-[27px] ${bold ? 'font-bold' : ''}`}
      style={{ width, height: ROW_H, textAlign: align }}
    >
      {text}
    </div>
  );
});

/** Reads the cell under a client point. */
export function cellFromPoint(x: number, y: number): CellPos | null {
  const el = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-cell]');
  const row = el?.dataset.row;
  const col = el?.dataset.col;
  return row && col ? { row, col } : null;
}

export function SheetGrid({
  session,
  ctl,
  canEdit,
  headers,
  overlay,
}: {
  session: BoardSession;
  ctl: SheetController;
  canEdit: boolean;
  /** Column and row header renderers (Task 10 adds menus, reorder and resize). */
  headers?: {
    col(index: number, id: string, width: number): ReactNode;
    row(index: number, id: string): ReactNode;
  };
  /** Extra content drawn over the grid (cell editor, fill handle). */
  overlay?: ReactNode;
}) {
  const sheet = useStore(session.sheet, (s) => s.sheet);
  const values = useStore(session.sheet, (s) => s.values);
  const pageId = useStore(session.sheet, (s) => s.pageId);
  const anchor = useStore(ctl.ui, (s) => s.anchor);
  const focus = useStore(ctl.ui, (s) => s.focus);
  const peers = useStore(session.presence, (s) => s.peers);
  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, height: 800 });
  const dragging = useRef(false);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setView({ top: el.scrollTop, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (!sheet) return null;
  const offsets = colOffsets(sheet.cols);
  const totalW = ROW_HEADER_W + (offsets.at(-1) ?? 0);
  const totalH = HEADER_H + sheet.rows.length * ROW_H;
  const { start, end } = visibleRows(view.top, view.height, sheet.rows.length);
  const selection = anchor && focus ? rangeOf(sheet, anchor, focus) : null;
  const peerRanges = peers.flatMap((p) => {
    if (!pageId || !onPage(p, pageId) || !p.sheet) return [];
    const r = rangeOf(
      sheet,
      { row: p.sheet.anchor[0], col: p.sheet.anchor[1] },
      { row: p.sheet.focus[0], col: p.sheet.focus[1] },
    );
    return r ? [{ peer: p, box: rangeBox(r, offsets), editing: p.sheet.editing }] : [];
  });

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a pointer surface for cell selection; the formula bar is the accessible editor
    <div
      ref={scroller}
      data-scroll-region
      data-testid="sheet-grid"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the grid takes keyboard focus so arrows/Tab/Enter drive the selection; as in spreadsheets, Tab moves between cells and Escape leaves the grid
      tabIndex={0}
      className="relative min-h-0 flex-1 select-none overflow-auto bg-white"
      onScroll={(e) =>
        setView({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })
      }
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const p = cellFromPoint(e.clientX, e.clientY);
        if (!p) return;
        // A stale page-text selection would make Ctrl+C copy that text instead of the cells.
        window.getSelection()?.removeAllRanges();
        const active = document.activeElement;
        if (active instanceof HTMLElement && active !== document.body) active.blur();
        if (ctl.ui.getState().editing) ctl.commitEdit();
        // Keyboard focus follows the click onto the grid, not a leftover button or select.
        e.currentTarget.focus({ preventScroll: true });
        ctl.select(p, e.shiftKey);
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        if (!dragging.current) return;
        const p = cellFromPoint(e.clientX, e.clientY);
        if (p) ctl.select(p, true);
      }}
      onPointerUp={(e) => {
        dragging.current = false;
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
      }}
      onDoubleClick={(e) => {
        if (!canEdit || !cellFromPoint(e.clientX, e.clientY)) return;
        ctl.startEdit();
      }}
    >
      <div className="relative" style={{ width: totalW, height: totalH }}>
        <div
          className="sticky top-0 z-20 flex bg-paper"
          style={{ height: HEADER_H, width: totalW }}
        >
          <button
            type="button"
            aria-label="Select all"
            className="sticky left-0 z-30 shrink-0 border-b-2 border-r-2 border-ink bg-paper"
            style={{ width: ROW_HEADER_W, height: HEADER_H }}
            onClick={() => ctl.selectAll()}
          />
          {sheet.cols.map((c, i) =>
            headers ? (
              headers.col(i, c.id, c.width)
            ) : (
              <div
                key={c.id}
                data-testid={`col-header-${colLetters(i)}`}
                className="grid shrink-0 place-items-center border-b-2 border-r border-ink font-mono text-[11px] font-bold"
                style={{ width: c.width, height: HEADER_H }}
              >
                {colLetters(i)}
              </div>
            ),
          )}
        </div>
        {sheet.rows.slice(start, end).map((r, k) => {
          const i = start + k;
          return (
            <div
              key={r.id}
              className="absolute left-0 flex"
              style={{ top: HEADER_H + i * ROW_H, height: ROW_H }}
            >
              {headers ? (
                headers.row(i, r.id)
              ) : (
                <div
                  data-testid={`row-header-${i + 1}`}
                  className="sticky left-0 z-10 grid shrink-0 place-items-center border-b border-r-2 border-ink bg-paper font-mono text-[11px]"
                  style={{ width: ROW_HEADER_W, height: ROW_H }}
                >
                  {i + 1}
                </div>
              )}
              {sheet.cols.map((c, j) => {
                const key = cellKey(r.id, c.id);
                const cell = sheet.cells[key];
                const value = values.get(key) ?? EMPTY;
                return (
                  <Cell
                    key={c.id}
                    address={`${colLetters(j)}${i + 1}`}
                    row={r.id}
                    col={c.id}
                    width={c.width}
                    text={formatValue(value, cell?.fmt)}
                    align={cell?.fmt?.align ?? defaultAlign(value)}
                    bold={cell?.fmt?.bold === true}
                  />
                );
              })}
            </div>
          );
        })}
        {peerRanges.map(({ peer, box, editing }) => (
          <div
            key={peer.clientId}
            data-testid="sheet-peer-range"
            className="pointer-events-none absolute z-10 border-2"
            style={{ ...box, borderColor: peer.user.color }}
          >
            <span
              className="absolute -top-4 left-0 whitespace-nowrap px-1 font-mono text-[9px] font-bold text-white"
              style={{ background: peer.user.color }}
            >
              {editing ? `${peer.user.name} · typing…` : peer.user.name}
            </span>
          </div>
        ))}
        {selection && (
          <div
            data-testid="sheet-selection"
            className="pointer-events-none absolute z-10 border-2 border-cobalt bg-cobalt/10"
            style={rangeBox(selection, offsets)}
          />
        )}
        {overlay}
      </div>
    </div>
  );
}
