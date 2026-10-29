import type { MenuItem } from '../ui/ContextMenu';

interface Box {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}

/** Whether `cell` (a one-cell range) lies inside the selection `range`. */
export function insideRange(range: Box | null, cell: Box | null): boolean {
  if (!range || !cell) return false;
  return cell.r0 >= range.r0 && cell.r1 <= range.r1 && cell.c0 >= range.c0 && cell.c1 <= range.c1;
}

/**
 * The menu of the selected cells (right-click, or press and hold on a touch screen, where there
 * is no Ctrl+C, Ctrl+V or Delete). Viewers can only copy; on a full board an editor can also
 * clear.
 */
export function cellMenu(
  canEdit: boolean,
  a: { cut(): void; copy(): void; paste(): void; clear(): void },
  canDelete: boolean = canEdit,
): MenuItem[] {
  const copy: MenuItem = {
    label: 'Copy',
    hint: 'Ctrl C',
    testId: 'cell-menu-copy',
    onSelect: a.copy,
  };
  const clear: MenuItem = {
    label: 'Clear contents',
    hint: 'Del',
    testId: 'cell-menu-clear',
    onSelect: a.clear,
  };
  if (!canEdit) return canDelete ? [copy, clear] : [copy];
  return [
    { label: 'Cut', hint: 'Ctrl X', testId: 'cell-menu-cut', onSelect: a.cut },
    copy,
    { label: 'Paste', hint: 'Ctrl V', testId: 'cell-menu-paste', onSelect: a.paste },
    clear,
  ];
}
