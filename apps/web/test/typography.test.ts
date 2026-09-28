import { DEFAULT_STYLE } from '@relay/core';
import { describe, expect, it } from 'vitest';
import { textStyle } from '../src/render/typography';

describe('textStyle', () => {
  it('keeps the default look of each type', () => {
    expect(textStyle({ type: 'sticky', style: DEFAULT_STYLE.sticky })).toEqual({
      className: 'font-sans font-semibold leading-snug',
      fontSize: 14,
    });
    expect(textStyle({ type: 'text', style: DEFAULT_STYLE.text }).className).toContain(
      'font-display',
    );
    expect(textStyle({ type: 'code', style: DEFAULT_STYLE.code })).toMatchObject({ fontSize: 12 });
  });

  it('follows the style font and size', () => {
    const s = textStyle({
      type: 'rect',
      style: { ...DEFAULT_STYLE.rect, font: 'mono', size: 'l' },
    });
    expect(s.className.startsWith('font-mono ')).toBe(true);
    expect(s.fontSize).toBe(19.5);
    expect(
      textStyle({ type: 'rect', style: { ...DEFAULT_STYLE.rect, size: 's' } }).fontSize,
    ).toBeCloseTo(10.4);
  });
});
