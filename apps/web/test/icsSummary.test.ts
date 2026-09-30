import { describe, expect, it } from 'vitest';
import { capWarnings } from '../src/calendar/icsSummary';

const warnings = (n: number) =>
  Array.from({ length: n }, (_, i) => ({ line: i + 1, message: `w${i}` }));

describe('import summary warnings', () => {
  it('lists up to 100 warnings, then says how many more there are', () => {
    expect(capWarnings(warnings(3))).toEqual({ shown: warnings(3), more: 0 });
    expect(capWarnings(warnings(100))).toEqual({ shown: warnings(100), more: 0 });
    const capped = capWarnings(warnings(250));
    expect(capped.shown).toEqual(warnings(100));
    expect(capped.more).toBe(150);
  });
});
