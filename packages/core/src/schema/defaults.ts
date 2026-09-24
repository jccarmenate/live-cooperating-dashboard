import type { ShapeType, Style } from './types';

export const PALETTE = {
  paper: '#F4F1EA',
  ink: '#111111',
  sun: '#F5D547',
  cobalt: '#3B3BF5',
  flame: '#E85A1B',
  white: '#FFFFFF',
} as const;

export const DEFAULT_STYLE: Record<ShapeType, Style> = {
  rect: { fill: PALETTE.white, stroke: PALETTE.ink, font: 'sans' },
  ellipse: { fill: PALETTE.white, stroke: PALETTE.ink, font: 'sans' },
  line: { fill: 'none', stroke: PALETTE.ink, font: 'sans' },
  text: { fill: 'none', stroke: 'none', font: 'display' },
  sticky: { fill: PALETTE.sun, stroke: PALETTE.ink, font: 'sans' },
  code: { fill: PALETTE.white, stroke: PALETTE.ink, font: 'mono' },
  frame: { fill: PALETTE.white, stroke: PALETTE.ink, font: 'mono' },
};

export const DEFAULT_SIZE: Record<'rect' | 'sticky' | 'text', { w: number; h: number }> = {
  rect: { w: 160, h: 96 },
  sticky: { w: 180, h: 140 },
  text: { w: 320, h: 56 },
};
