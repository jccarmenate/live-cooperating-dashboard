import {
  COL_WIDTH_MAX,
  COL_WIDTH_MIN,
  colLetters,
  MAX_SHEET_COLS,
  MAX_SHEET_ROWS,
} from '@relay/core';
import {
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useRef,
  useState,
} from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { ContextMenu, type MenuItem } from '../ui/ContextMenu';
import { useLongPress } from '../ui/useLongPress';
import { colOffsets, HEADER_H, ROW_H, ROW_HEADER_W, rangeBox } from './layout';
import { cellFromPoint } from './SheetGrid';
import { rangeOf, type SheetController } from './sheetController';

const DRAG_PX = 4;

type Drag = { kind: 'row' | 'col'; id: string; startX: number; startY: number; moved: boolean };

/** Header renderers with selection, context menus, drag-to-reorder and column resize. */
export function useSheetHeaders(session: BoardSession, ctl: SheetController, canEdit: boolean) {
  const sheet = useStore(session.sheet, (s) => s.sheet);
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null);
  const [resize, setResize] = useState<{ id: string; width: number } | null>(null);
  const drag = useRef<Drag | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const longPress = useLongPress();

  const inSelection = (kind: 'row' | 'col', index: number) => {
    const r = ctl.range();
    if (!r) return false;
    return kind === 'row' ? index >= r.r0 && index <= r.r1 : index >= r.c0 && index <= r.c1;
  };

  const openMenu = (kind: 'row' | 'col', index: number, id: string, x: number, y: number) => {
    if (!canEdit) return;
    if (!inSelection(kind, index)) {
      if (kind === 'row') ctl.selectRow(id);
      else ctl.selectCol(id);
    }
    // Inserting adds as many rows (columns) as are selected: disable it when that passes the cap.
    const s = session.sheet.getState().sheet;
    const r = ctl.range();
    const full =
      !s ||
      !r ||
      (kind === 'row'
        ? s.rows.length + (r.r1 - r.r0 + 1) > MAX_SHEET_ROWS
        : s.cols.length + (r.c1 - r.c0 + 1) > MAX_SHEET_COLS);
    const items: MenuItem[] =
      kind === 'row'
        ? [
            {
              label: 'Insert row above',
              testId: 'sheet-menu-insert-above',
              disabled: full,
              onSelect: () => ctl.insertRows('above'),
            },
            {
              label: 'Insert row below',
              testId: 'sheet-menu-insert-below',
              disabled: full,
              onSelect: () => ctl.insertRows('below'),
            },
            // Moving by menu works by touch, where a header drag scrolls the grid instead.
            {
              label: 'Move row up',
              testId: 'sheet-menu-move-up',
              disabled: index === 0,
              onSelect: () => ctl.moveRow(id, index - 1),
            },
            {
              label: 'Move row down',
              testId: 'sheet-menu-move-down',
              disabled: !s || index >= s.rows.length - 1,
              onSelect: () => ctl.moveRow(id, index + 1),
            },
            {
              label: 'Delete rows',
              testId: 'sheet-menu-delete-rows',
              danger: true,
              onSelect: () => ctl.deleteRows(),
            },
          ]
        : [
            {
              label: 'Insert column left',
              testId: 'sheet-menu-insert-left',
              disabled: full,
              onSelect: () => ctl.insertCols('left'),
            },
            {
              label: 'Insert column right',
              testId: 'sheet-menu-insert-right',
              disabled: full,
              onSelect: () => ctl.insertCols('right'),
            },
            {
              label: 'Move column left',
              testId: 'sheet-menu-move-left',
              disabled: index === 0,
              onSelect: () => ctl.moveCol(id, index - 1),
            },
            {
              label: 'Move column right',
              testId: 'sheet-menu-move-right',
              disabled: !s || index >= s.cols.length - 1,
              onSelect: () => ctl.moveCol(id, index + 1),
            },
            {
              label: 'Delete columns',
              testId: 'sheet-menu-delete-cols',
              danger: true,
              onSelect: () => ctl.deleteCols(),
            },
          ];
    setMenu({ x, y, items });
  };

  const pointerHandlers = (kind: 'row' | 'col', index: number, id: string) => {
    // Touch: press and hold opens the header menu (iOS has no long-press contextmenu).
    const hold = longPress((at) => openMenu(kind, index, id, at.x, at.y));
    return {
      onPointerDown: (e: ReactPointerEvent<HTMLDivElement>) => {
        hold.onPointerDown(e);
        if (e.button !== 0) return;
        e.stopPropagation();
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
        // Keyboard focus stays on the grid (not a leftover button, tab or editor).
        document.querySelector<HTMLElement>('[data-sheet-grid]')?.focus({ preventScroll: true });
        drag.current = { kind, id, startX: e.clientX, startY: e.clientY, moved: false };
        e.currentTarget.setPointerCapture(e.pointerId);
        if (kind === 'row') ctl.selectRow(id, e.shiftKey);
        else ctl.selectCol(id, e.shiftKey);
      },
      onPointerMove: (e: ReactPointerEvent<HTMLDivElement>) => {
        hold.onPointerMove(e);
        const d = drag.current;
        if (!d || !canEdit) return;
        if (!d.moved && Math.hypot(e.clientX - d.startX, e.clientY - d.startY) < DRAG_PX) return;
        d.moved = true;
      },
      onPointerUp: (e: ReactPointerEvent<HTMLDivElement>) => {
        hold.onPointerUp();
        const d = drag.current;
        drag.current = null;
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
        if (!d?.moved || !canEdit || !sheet) return;
        // Drop onto the row or column header under the pointer: the moved one takes its index.
        const el = document
          .elementFromPoint(e.clientX, e.clientY)
          ?.closest<HTMLElement>('[data-header-index]');
        const to = el?.dataset.headerKind === d.kind ? Number(el.dataset.headerIndex) : -1;
        if (to < 0) return;
        if (d.kind === 'row') ctl.moveRow(d.id, to);
        else ctl.moveCol(d.id, to);
      },
      // The browser took the finger for a scroll: no reorder, no menu.
      onPointerCancel: () => {
        hold.onPointerCancel();
        drag.current = null;
      },
    };
  };

  const headers = {
    col(index: number, id: string, width: number): ReactNode {
      const letters = colLetters(index);
      const w = resize?.id === id ? resize.width : width;
      return (
        // biome-ignore lint/a11y/noStaticElementInteractions: a pointer surface inside the keyboard-driven grid (select, reorder, menu); keys select through the grid
        <div
          key={id}
          data-testid={`col-header-${letters}`}
          data-header-kind="col"
          data-header-index={index}
          className="relative grid shrink-0 cursor-default place-items-center border-b-2 border-r border-ink font-mono text-[11px] font-bold hover:bg-sun/40"
          style={{ width: w, height: HEADER_H }}
          onContextMenu={(e) => {
            e.preventDefault();
            openMenu('col', index, id, e.clientX, e.clientY);
          }}
          {...pointerHandlers('col', index, id)}
        >
          {letters}
          {canEdit && (
            <div
              data-testid={`col-resize-${letters}`}
              aria-hidden
              // Touch: the drag is the handle's own (no scroll) and the target is finger-sized.
              className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize touch-none pointer-coarse:-right-3 pointer-coarse:w-6"
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.stopPropagation();
                e.currentTarget.setPointerCapture(e.pointerId);
                const startX = e.clientX;
                const start = w;
                const onMove = (ev: PointerEvent) =>
                  setResize({
                    id,
                    width: Math.min(
                      COL_WIDTH_MAX,
                      Math.max(COL_WIDTH_MIN, start + ev.clientX - startX),
                    ),
                  });
                const target = e.currentTarget;
                const stop = () => {
                  target.removeEventListener('pointermove', onMove);
                  target.removeEventListener('pointerup', onUp);
                  target.removeEventListener('pointercancel', onCancel);
                };
                // A cancelled gesture ends the preview without committing a width.
                const onCancel = () => {
                  stop();
                  setResize(null);
                };
                const onUp = (ev: PointerEvent) => {
                  stop();
                  const final = Math.min(
                    COL_WIDTH_MAX,
                    Math.max(COL_WIDTH_MIN, start + ev.clientX - startX),
                  );
                  setResize(null);
                  if (final !== start) ctl.setColWidth(id, final);
                };
                target.addEventListener('pointermove', onMove);
                target.addEventListener('pointerup', onUp);
                target.addEventListener('pointercancel', onCancel);
              }}
            />
          )}
        </div>
      );
    },
    row(index: number, id: string): ReactNode {
      return (
        // biome-ignore lint/a11y/noStaticElementInteractions: a pointer surface inside the keyboard-driven grid (select, reorder, menu); keys select through the grid
        <div
          data-testid={`row-header-${index + 1}`}
          data-header-kind="row"
          data-header-index={index}
          className="sticky left-0 z-10 grid shrink-0 cursor-default place-items-center border-b border-r-2 border-ink bg-paper font-mono text-[11px] hover:bg-sun/40"
          style={{ width: ROW_HEADER_W, height: ROW_H }}
          onContextMenu={(e) => {
            e.preventDefault();
            openMenu('row', index, id, e.clientX, e.clientY);
          }}
          {...pointerHandlers('row', index, id)}
        >
          {index + 1}
        </div>
      );
    },
  };

  const menuElement = menu ? (
    <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />
  ) : null;
  return { headers, menu: menuElement };
}

/** The square at the selection's bottom-right corner: drag it down or right to fill. */
export function FillHandle({ session, ctl }: { session: BoardSession; ctl: SheetController }) {
  const sheet = useStore(session.sheet, (s) => s.sheet);
  const anchor = useStore(ctl.ui, (s) => s.anchor);
  const focus = useStore(ctl.ui, (s) => s.focus);
  const editing = useStore(ctl.ui, (s) => s.editing);
  if (!sheet || !anchor || !focus || editing) return null;
  const r = rangeOf(sheet, anchor, focus);
  if (!r) return null;
  const box = rangeBox(r, colOffsets(sheet.cols));
  return (
    <div
      data-testid="fill-handle"
      aria-hidden
      // Touch: the drag is the handle's own (no scroll), and a pseudo-element widens the
      // 10px square into a target a finger can hit.
      className="absolute z-20 size-2.5 cursor-crosshair touch-none border border-white bg-cobalt pointer-coarse:before:absolute pointer-coarse:before:-inset-3"
      style={{ left: box.left + box.width - 5, top: box.top + box.height - 5 }}
      onPointerDown={(e) => {
        e.stopPropagation();
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerUp={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId))
          e.currentTarget.releasePointerCapture(e.pointerId);
        const target = cellFromPoint(e.clientX, e.clientY);
        if (target) ctl.fillTo(target);
      }}
    />
  );
}
