import { PALETTE } from '@relay/core';

/** "No fill / no stroke": transparent keeps the shape clickable, unlike SVG's `none`. */
export const NONE = 'transparent';

export interface Swatch {
  name: string;
  label: string;
  color: string;
}

export const FILL_SWATCHES: readonly Swatch[] = [
  { name: 'white', label: 'White', color: PALETTE.white },
  { name: 'paper', label: 'Paper', color: PALETTE.paper },
  { name: 'sun', label: 'Sun', color: PALETTE.sun },
  { name: 'cobalt', label: 'Cobalt', color: PALETTE.cobalt },
  { name: 'flame', label: 'Flame', color: PALETTE.flame },
  { name: 'none', label: 'None', color: NONE },
];

export const STROKE_SWATCHES: readonly Swatch[] = [
  { name: 'ink', label: 'Ink', color: PALETTE.ink },
  { name: 'cobalt', label: 'Cobalt', color: PALETTE.cobalt },
  { name: 'flame', label: 'Flame', color: PALETTE.flame },
  { name: 'sun', label: 'Sun', color: PALETTE.sun },
  { name: 'none', label: 'None', color: NONE },
];

const norm = (c: string) => (c === 'none' ? NONE : c.toLowerCase());

/** Colour equality that treats SVG `none` as transparent and ignores hex case. */
export const sameColor = (a: string | null, b: string): boolean =>
  a !== null && norm(a) === norm(b);

/** What a swatch button paints: the colour, or a red slash for none. */
export const swatchBackground = (color: string): string =>
  color === NONE
    ? `linear-gradient(to top right, transparent 44%, ${PALETTE.flame} 44% 56%, transparent 56%), ${PALETTE.white}`
    : color;
