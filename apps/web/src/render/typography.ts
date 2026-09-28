import type { FontRole, Shape, ShapeType, TextSize } from '@relay/core';

/**
 * Case, weight and line height per type, shared by ShapeView (read) and
 * TextEditor (edit) so the textarea lines up exactly with the rendered text.
 * The family and size come from the shape's style (see `textStyle`).
 */
export const TEXT_STYLE: Record<ShapeType, string> = {
  rect: 'font-bold uppercase leading-snug text-center',
  ellipse: 'font-bold uppercase leading-snug text-center',
  line: '',
  sticky: 'font-semibold leading-snug',
  text: 'uppercase leading-tight',
  code: 'leading-relaxed',
  frame: 'font-bold uppercase tracking-wider',
};

/** Text size in px at size 'm'. */
export const BASE_SIZE: Record<ShapeType, number> = {
  rect: 13,
  ellipse: 13,
  line: 13,
  sticky: 14,
  text: 28,
  code: 12,
  frame: 13,
};

export const SIZE_SCALE: Record<TextSize, number> = { s: 0.8, m: 1, l: 1.5 };

export const FONT_CLASS: Record<FontRole, string> = {
  sans: 'font-sans',
  mono: 'font-mono',
  display: 'font-display',
};

/** Class names and font size (px) for a shape's text. */
export function textStyle(s: Pick<Shape, 'type' | 'style'>): {
  className: string;
  fontSize: number;
} {
  return {
    className: `${FONT_CLASS[s.style.font]} ${TEXT_STYLE[s.type]}`,
    fontSize: BASE_SIZE[s.type] * SIZE_SCALE[s.style.size ?? 'm'],
  };
}

/** Padding of the text box inside the shape. */
export const TEXT_BOX: Record<ShapeType, string> = {
  rect: 'px-2',
  ellipse: 'px-6',
  line: '',
  sticky: 'p-3',
  text: '',
  code: 'px-3 pt-8 pb-3',
  frame: 'px-3 pt-2.5',
};

/** Height of the dark header strip on code blocks (fits under `pt-8`). */
export const CODE_HEADER = 22;

/** Shapes whose label is vertically centred. */
export const isCentered = (type: ShapeType) => type === 'rect' || type === 'ellipse';
