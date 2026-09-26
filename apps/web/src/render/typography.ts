import type { ShapeType } from '@relay/core';

/**
 * Text styles shared by ShapeView (read) and TextEditor (edit) so the
 * textarea lines up exactly with the rendered text.
 */
export const TEXT_STYLE: Record<ShapeType, string> = {
  rect: 'text-[13px] font-bold uppercase leading-snug text-center',
  ellipse: 'text-[13px] font-bold uppercase leading-snug text-center',
  line: '',
  sticky: 'text-[14px] font-semibold leading-snug',
  text: 'font-display text-[28px] uppercase leading-tight',
  code: 'font-mono text-[12px] leading-relaxed',
  frame: 'font-mono text-[11px] uppercase',
};

/** Padding of the text box inside the shape. */
export const TEXT_BOX: Record<ShapeType, string> = {
  rect: 'px-2',
  ellipse: 'px-6',
  line: '',
  sticky: 'p-3',
  text: '',
  code: 'px-3 pt-8 pb-3',
  frame: 'p-3',
};

/** Height of the dark header strip on code blocks (fits under `pt-8`). */
export const CODE_HEADER = 22;

/** Shapes whose label is vertically centred. */
export const isCentered = (type: ShapeType) => type === 'rect' || type === 'ellipse';
