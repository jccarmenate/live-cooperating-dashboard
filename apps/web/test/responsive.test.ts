import { describe, expect, it } from 'vitest';
import { overflowEdges, withMaximumScale } from '../src/ui/responsive';

describe('withMaximumScale', () => {
  it('adds maximum-scale=1 once, keeping the other settings', () => {
    const base = 'width=device-width, initial-scale=1, viewport-fit=cover';
    expect(withMaximumScale(base)).toBe(`${base}, maximum-scale=1`);
    expect(withMaximumScale(withMaximumScale(base))).toBe(`${base}, maximum-scale=1`);
    expect(withMaximumScale('width=device-width, maximum-scale=5')).toBe(
      'width=device-width, maximum-scale=1',
    );
  });
});

describe('overflowEdges', () => {
  it('flags the edges that hide content', () => {
    expect(overflowEdges(0, 300, 300)).toEqual({ left: false, right: false });
    expect(overflowEdges(0, 300, 500)).toEqual({ left: false, right: true });
    expect(overflowEdges(100, 300, 500)).toEqual({ left: true, right: true });
    expect(overflowEdges(199.5, 300, 500)).toEqual({ left: true, right: false });
  });
});
