import { describe, expect, it } from 'vitest';
import { withMaximumScale } from '../src/ui/responsive';

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
