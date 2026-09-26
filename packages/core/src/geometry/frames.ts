import { compareZ } from '../schema/normalize';
import type { FrameColumn, Point, Rect, Shape } from '../schema/types';
import { containsPoint } from './rect';

/** Height of a frame's title band (its grab handle). */
export const FRAME_TITLE_H = 36;
/** Height of a column header strip under the title band. */
export const COLUMN_HEADER_H = 28;

export interface ColumnRect extends Rect {
  id: string;
  title: string;
}

type Shapes = Readonly<Record<string, Shape>>;

/** Equal-width columns filling the frame body under the title band. */
export function frameColumns(f: Pick<Shape, 'x' | 'y' | 'w' | 'h' | 'columns'>): ColumnRect[] {
  const cols: FrameColumn[] = f.columns ?? [];
  if (cols.length === 0) return [];
  const w = f.w / cols.length;
  const h = Math.max(0, f.h - FRAME_TITLE_H);
  return cols.map((c, i) => ({
    id: c.id,
    title: c.title,
    x: f.x + i * w,
    y: f.y + FRAME_TITLE_H,
    w,
    h,
  }));
}

/** Topmost frame (by z) containing `p`, and the column under `p` if any. */
export function dropTarget(
  shapes: Shapes,
  p: Point,
  exclude: ReadonlySet<string>,
): { parentId: string; columnId: string | null } | null {
  const frames = Object.values(shapes)
    .filter((s) => s.type === 'frame' && !exclude.has(s.id))
    .sort(compareZ)
    .reverse();
  for (const f of frames) {
    if (!containsPoint(f, p)) continue;
    // findLast: columns are contiguous and abut exactly at shared edges, so a
    // point on a shared boundary matches both neighbors under an inclusive
    // containsPoint; the later (rightward) column wins the tie.
    const column = frameColumns(f).findLast((c) => containsPoint(c, p));
    return { parentId: f.id, columnId: column?.id ?? null };
  }
  return null;
}

/** Number of children per column (derived, never stored). */
export function columnCounts(shapes: Shapes, frameId: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const s of Object.values(shapes)) {
    if (s.parentId === frameId && s.columnId) counts[s.columnId] = (counts[s.columnId] ?? 0) + 1;
  }
  return counts;
}

export function childrenOf(shapes: Shapes, frameId: string): string[] {
  return Object.values(shapes)
    .filter((s) => s.parentId === frameId)
    .map((s) => s.id)
    .sort();
}

export function rectContains(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.w <= outer.x + outer.w &&
    inner.y + inner.h <= outer.y + outer.h
  );
}
