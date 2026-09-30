import { type CellValue, cellKey, colLetters, defaultAlign, formatValue } from '@relay/core';
import { memo, type ReactNode, useEffect, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { onPage } from '../render/pageFilter';
import { LONG_PRESS_MS, moved } from '../render/touch';
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
  // Touch: a drag scrolls the grid. A tap selects a cell and a tap on the selected cell edits
  // it; a finger held still starts a range selection that follows it.
  const touch = useRef<{
    pointerId: number;
    cell: CellPos;
    start: { x: number; y: number };
    range: boolean;
    timer: number;
  } | null>(null);
  // After a finger, the browser's own dblclick is ignored: the second tap already edits.
  const lastPointer = useRef('mouse');

  const endTouch = () => {
    if (touch.current) window.clearTimeout(touch.current.timer);
    touch.current = null;
  };

  // Non-passive, so a range selection can stop the grid scrolling under the finger.
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const onMove = (e: TouchEvent) => {
      if (touch.current?.range) e.preventDefault();
    };
    el.addEventListener('touchmove', onMove, { passive: false });
    return () => {
      el.removeEventListener('touchmove', onMove);
      if (touch.current) window.clearTimeout(touch.current.timer);
    };
  }, []);

  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const measure = () => setView({ top: el.scrollTop, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Opening a sheet (e.g. from its page tab) hands the keyboard to the grid.
  const loaded = sheet !== null;
  useEffect(() => {
    if (pageId && loaded) scroller.current?.focus({ preventScroll: true });
  }, [pageId, loaded]);

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
      data-sheet-grid
      data-testid="sheet-grid"
      // biome-ignore lint/a11y/noNoninteractiveTabindex: the grid takes keyboard focus so arrows/Tab/Enter drive the selection; as in spreadsheets, Tab moves between cells and Escape leaves the grid
      tabIndex={0}
      className="relative min-h-0 flex-1 select-none overflow-auto bg-white"
      onScroll={(e) =>
        setView({ top: e.currentTarget.scrollTop, height: e.currentTarget.clientHeight })
      }
      onPointerDown={(e) => {
        lastPointer.current = e.pointerType;
        if (e.button !== 0) return;
        const p = cellFromPoint(e.clientX, e.clientY);
        if (!p) return;
        // A stale page-text selection would make Ctrl+C copy that text instead of the cells.
        window.getSelection()?.removeAllRanges();
        if (ctl.ui.getState().editing) {
          ctl.commitEdit();
          // A refused commit keeps the edit open: stay in it rather than move its draft.
          if (ctl.ui.getState().editing) {
            e.preventDefault();
            return;
          }
        }
        const active = document.activeElement;
        if (active instanceof HTMLElement && active !== document.body) active.blur();
        // Keyboard focus follows the click onto the grid, not a leftover button or select.
        e.currentTarget.focus({ preventScroll: true });
        if (e.pointerType === 'touch') {
          // No mouse events after the finger: their mousedown would take focus off the
          // editor a tap opens. What the tap does waits for the finger to lift.
          e.preventDefault();
          endTouch();
          const id = e.pointerId;
          const timer = window.setTimeout(() => {
            const t = touch.current;
            if (t?.pointerId !== id) return;
            t.range = true;
            ctl.select(t.cell, false);
          }, LONG_PRESS_MS);
          touch.current = {
            pointerId: id,
            cell: p,
            start: { x: e.clientX, y: e.clientY },
            range: false,
            timer,
          };
          return;
        }
        ctl.select(p, e.shiftKey);
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const t = touch.current;
        if (t?.pointerId === e.pointerId) {
          const at = { x: e.clientX, y: e.clientY };
          if (!t.range) {
            // Moving before the hold completes is a scroll, not a press.
            if (moved(t.start, at)) endTouch();
            return;
          }
          const p = cellFromPoint(at.x, at.y);
          if (p) ctl.select(p, true);
          return;
        }
        if (!dragging.current) return;
        const p = cellFromPoint(e.clientX, e.clientY);
        if (p) ctl.select(p, true);
      }}
      onPointerUp={(e) => {
        dragging.current = false;
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
        const t = touch.current;
        if (t?.pointerId !== e.pointerId) return;
        endTouch();
        if (t.range) return;
        const { anchor, focus } = ctl.ui.getState();
        const here = (c: CellPos | null) => c?.row === t.cell.row && c?.col === t.cell.col;
        // flushSync: the editor takes focus inside the tap, or iOS shows no keyboard.
        if (canEdit && here(anchor) && here(focus)) flushSync(() => ctl.startEdit());
        else ctl.select(t.cell, false);
      }}
      onPointerCancel={() => {
        // The browser took the finger for a scroll or a pinch.
        dragging.current = false;
        endTouch();
      }}
      onDoubleClick={(e) => {
        if (!canEdit || lastPointer.current === 'touch' || !cellFromPoint(e.clientX, e.clientY))
          return;
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
            // Keys keep driving the grid: the button never takes focus, the scroller does.
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              // The editor keeps focus through this press: commit it where it is first.
              if (ctl.ui.getState().editing) {
                ctl.commitEdit();
                if (ctl.ui.getState().editing) return;
              }
              ctl.selectAll();
              scroller.current?.focus({ preventScroll: true });
            }}
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
