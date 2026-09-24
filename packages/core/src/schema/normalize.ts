import type { Shape } from './types';

/** Total order on shapes: fractional-index z (plain string compare), then id. */
export function compareZ(a: Pick<Shape, 'z' | 'id'>, b: Pick<Shape, 'z' | 'id'>): number {
  if (a.z !== b.z) return a.z < b.z ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

export interface Normalized {
  shapes: Record<string, Shape>;
  order: string[];
}

/**
 * Read-side normalization (spec: "normalize on read, not on write").
 * A parentId that does not point to an existing frame is treated as root.
 * Untouched shapes keep object identity so per-shape selectors stay stable.
 */
export function normalizeShapes(raw: Readonly<Record<string, Shape>>): Normalized {
  const shapes: Record<string, Shape> = {};
  for (const s of Object.values(raw)) {
    if (s.parentId !== undefined && raw[s.parentId]?.type !== 'frame') {
      const { parentId: _parent, columnId: _column, ...rest } = s;
      shapes[s.id] = rest;
    } else {
      shapes[s.id] = s;
    }
  }
  const order = Object.values(shapes)
    .sort(compareZ)
    .map((s) => s.id);
  return { shapes, order };
}
