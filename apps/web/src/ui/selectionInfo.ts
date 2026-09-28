import {
  type Connector,
  connectorPath,
  type FontRole,
  type Rect,
  type Routing,
  type Shape,
  shapeBounds,
  TEXT_TYPES,
  type TextSize,
  unionRects,
} from '@relay/core';

export interface SelectionInfo {
  shapes: Shape[];
  connectors: Connector[];
  /** Every selected shape is locked (there is at least one). */
  allLocked: boolean;
  /** A text-bearing shape is among the styleable ones. */
  textual: boolean;
  /** Values shared by every styleable shape (unlocked ones, or all when all are locked); null when mixed. */
  fill: string | null;
  stroke: string | null;
  font: FontRole | null;
  size: TextSize | null;
  routing: Routing | null;
  head: Connector['head'] | null;
  /** World bounds of the selected shapes and connector paths. */
  bounds: Rect | null;
}

function common<T>(values: T[]): T | null {
  const [first] = values;
  return first !== undefined && values.every((v) => v === first) ? first : null;
}

export function selectionInfo(
  selection: readonly string[],
  shapes: Readonly<Record<string, Shape>>,
  connectors: Readonly<Record<string, Connector>>,
): SelectionInfo {
  const ss = selection.flatMap((id) => {
    const s = shapes[id];
    return s ? [s] : [];
  });
  const cs = selection.flatMap((id) => {
    const c = connectors[id];
    return c ? [c] : [];
  });
  const unlocked = ss.filter((s) => !s.locked);
  const styled = unlocked.length > 0 ? unlocked : ss;
  const rects: Rect[] = ss.map(shapeBounds);
  for (const c of cs) {
    for (const p of connectorPath(c, shapes) ?? []) rects.push({ x: p.x, y: p.y, w: 0, h: 0 });
  }
  return {
    shapes: ss,
    connectors: cs,
    allLocked: ss.length > 0 && unlocked.length === 0,
    textual: styled.some((s) => TEXT_TYPES.has(s.type)),
    fill: common(styled.map((s) => s.style.fill)),
    stroke: common(styled.map((s) => s.style.stroke)),
    font: common(styled.map((s) => s.style.font)),
    size: common(styled.map((s) => s.style.size ?? 'm')),
    routing: common(cs.map((c) => c.routing)),
    head: common(cs.map((c) => c.head)),
    bounds: unionRects(rects),
  };
}

const GAP = 12;
/** Below the target the bar clears the W × H label. */
const BELOW_GAP = 36;
const MARGIN = 8;

/** Where the bar goes (container px): centred above the target, else below, always inside the viewport. */
export function barPosition(
  target: Rect,
  bar: { w: number; h: number },
  viewport: { w: number; h: number },
): { left: number; top: number } {
  let top = target.y - bar.h - GAP;
  if (top < MARGIN) top = target.y + target.h + BELOW_GAP;
  top = Math.max(MARGIN, Math.min(top, viewport.h - bar.h - MARGIN));
  const left = Math.max(
    MARGIN,
    Math.min(target.x + target.w / 2 - bar.w / 2, viewport.w - bar.w - MARGIN),
  );
  return { left, top };
}
