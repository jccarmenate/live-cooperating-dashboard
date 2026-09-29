import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  addDays,
  dayNumber,
  daysInMonth,
  formatDate,
  formatWall,
  fromDayNumber,
  fromWallMinutes,
  isValidZone,
  parseDate,
  parseWall,
  safeZone,
  todayIn,
  toInstant,
  toWall,
  wallMinutes,
  weekday,
  zoneOffset,
} from '../src';

const ZONES = [
  'UTC',
  'Europe/Madrid',
  'America/Havana',
  'America/New_York',
  'Australia/Sydney',
  'America/Santiago',
  'Asia/Kolkata',
  'Australia/Lord_Howe',
];

describe('dates and wall times', () => {
  it('parses and formats valid dates, and rejects impossible ones', () => {
    expect(parseDate('2026-02-28')).toEqual({ y: 2026, m: 2, d: 28 });
    expect(parseDate('2028-02-29')).toEqual({ y: 2028, m: 2, d: 29 });
    expect(parseDate('2026-02-29')).toBeNull();
    expect(parseDate('2026-13-01')).toBeNull();
    expect(parseDate('1899-12-31')).toBeNull();
    expect(parseDate('2026-2-1')).toBeNull();
    expect(parseDate(20260101)).toBeNull();
    expect(formatDate({ y: 2026, m: 3, d: 8 })).toBe('2026-03-08');
    expect(parseWall('2026-03-08T23:59')).toEqual({ y: 2026, m: 3, d: 8, hh: 23, mm: 59 });
    expect(parseWall('2026-03-08T24:00')).toBeNull();
    expect(parseWall('2026-01-01T12:60')).toBeNull();
    expect(parseDate('2201-01-01')).toBeNull();
    expect(formatWall({ y: 2026, m: 3, d: 8, hh: 9, mm: 5 })).toBe('2026-03-08T09:05');
  });

  it('does day arithmetic across months, years and leap days', () => {
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(daysInMonth(2000, 2)).toBe(29);
    expect(daysInMonth(1900, 2)).toBe(28);
    expect(addDays({ y: 2026, m: 12, d: 31 }, 1)).toEqual({ y: 2027, m: 1, d: 1 });
    expect(addDays({ y: 2028, m: 3, d: 1 }, -1)).toEqual({ y: 2028, m: 2, d: 29 });
    expect(fromDayNumber(dayNumber({ y: 2031, m: 7, d: 4 }))).toEqual({ y: 2031, m: 7, d: 4 });
    expect(weekday({ y: 2026, m: 9, d: 28 })).toBe(0); // a Monday
    expect(weekday({ y: 2026, m: 10, d: 4 })).toBe(6); // a Sunday
    const w = { y: 2026, m: 9, d: 28, hh: 23, mm: 30 };
    expect(fromWallMinutes(wallMinutes(w) + 45)).toEqual({ y: 2026, m: 9, d: 29, hh: 0, mm: 15 });
  });
});

describe('zones', () => {
  it('validates zones and falls back to UTC', () => {
    expect(isValidZone('Europe/Madrid')).toBe(true);
    expect(isValidZone('Mars/Olympus')).toBe(false);
    expect(isValidZone('')).toBe(false);
    expect(isValidZone(42)).toBe(false);
    expect(safeZone('Romance Standard Time')).toBe('UTC');
    expect(isValidZone('+05:30')).toBe(false);
    expect(isValidZone('x'.repeat(65))).toBe(false);
    expect(isValidZone('Etc/GMT+5')).toBe(true);
  });

  it('canonicalises zone names', () => {
    expect(safeZone('europe/madrid')).toBe('Europe/Madrid');
    expect(safeZone('Europe/Madrid')).toBe('Europe/Madrid');
    expect(safeZone('UTC')).toBe('UTC');
  });

  it('reads offsets and today in a zone', () => {
    expect(zoneOffset(Date.UTC(2026, 6, 1, 12, 0), 'Europe/Madrid')).toBe(120);
    // 23:30 UTC on 28 September is already the 29th in Kolkata (+05:30), still the 28th in Havana.
    const t = Date.UTC(2026, 8, 28, 23, 30);
    expect(todayIn(t, 'Asia/Kolkata')).toBe('2026-09-29');
    expect(todayIn(t, 'America/Havana')).toBe('2026-09-28');
  });

  it('never throws on a non-finite instant', () => {
    expect(zoneOffset(Number.NaN, 'Europe/Madrid')).toBe(0);
    expect(zoneOffset(Number.POSITIVE_INFINITY, 'Europe/Madrid')).toBe(0);
    expect(() => toWall(Number.NaN, 'Europe/Madrid')).not.toThrow();
    expect(() =>
      toInstant({ y: Number.NaN, m: 1, d: 1, hh: 0, mm: 0 }, 'Europe/Madrid'),
    ).not.toThrow();
  });

  it('keeps converting valid zones after a flood of junk and many real zones', () => {
    for (let i = 0; i < 300; i++) isValidZone(`Junk/Zone${i}`);
    for (const tz of Intl.supportedValuesOf('timeZone')) zoneOffset(0, tz); // forces eviction
    for (let i = 0; i < 300; i++) safeZone(`Junk/Zone${i}`);
    expect(isValidZone('Europe/Madrid')).toBe(true);
    expect(toInstant({ y: 2026, m: 7, d: 1, hh: 9, mm: 0 }, 'Europe/Madrid')).toBe(
      Date.UTC(2026, 6, 1, 7, 0),
    );
    expect(isValidZone('Junk/Zone7')).toBe(false);
  });

  it('converts a plain wall time both ways', () => {
    const t = toInstant({ y: 2026, m: 7, d: 1, hh: 9, mm: 0 }, 'Europe/Madrid');
    expect(t).toBe(Date.UTC(2026, 6, 1, 7, 0));
    expect(toWall(t, 'America/Havana')).toEqual({ y: 2026, m: 7, d: 1, hh: 3, mm: 0 });
  });

  it('moves a wall time in the spring-forward gap forward by the gap (Madrid)', () => {
    // 2026-03-29 02:00 CET jumps to 03:00 CEST.
    const t = toInstant({ y: 2026, m: 3, d: 29, hh: 2, mm: 30 }, 'Europe/Madrid');
    expect(toWall(t, 'Europe/Madrid')).toEqual({ y: 2026, m: 3, d: 29, hh: 3, mm: 30 });
  });

  it('takes the earlier instant of an ambiguous wall time (Madrid fall-back)', () => {
    // 2026-10-25 03:00 CEST falls back to 02:00 CET: 02:30 happens twice.
    const t = toInstant({ y: 2026, m: 10, d: 25, hh: 2, mm: 30 }, 'Europe/Madrid');
    expect(t).toBe(Date.UTC(2026, 9, 25, 0, 30));
  });

  it('handles Havana, whose spring change at midnight means 00:00 does not exist that day', () => {
    // Find the day in March 2026 whose 00:30 cannot be represented, without hard-coding tzdata.
    const gaps: string[] = [];
    for (let d = 1; d <= 31; d++) {
      const w = { y: 2026, m: 3, d, hh: 0, mm: 30 };
      const back = toWall(toInstant(w, 'America/Havana'), 'America/Havana');
      if (wallMinutes(back) !== wallMinutes(w)) {
        expect(wallMinutes(back) - wallMinutes(w)).toBe(60);
        gaps.push(formatDate(w));
      }
    }
    expect(gaps).toHaveLength(1);
  });

  it('round-trips instants and wall times in every zone (property)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ZONES),
        fc.integer({ min: Date.UTC(2000, 0, 1), max: Date.UTC(2060, 0, 1) }),
        (tz, raw) => {
          const t = raw - (raw % 60_000); // whole minutes
          const w = toWall(t, tz);
          const back = toInstant(w, tz);
          // Exact, unless t is the later of two instants with the same wall time.
          expect(back <= t).toBe(true);
          expect(wallMinutes(toWall(back, tz))).toBe(wallMinutes(w));
        },
      ),
      { numRuns: 300 },
    );
  });

  it('never moves a wall time backwards, and only forward by at most an hour (property)', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...ZONES),
        fc.integer({
          min: dayNumber({ y: 2000, m: 1, d: 1 }),
          max: dayNumber({ y: 2060, m: 1, d: 1 }),
        }),
        fc.integer({ min: 0, max: 23 }),
        fc.integer({ min: 0, max: 59 }),
        (tz, day, hh, mm) => {
          const w = { ...fromDayNumber(day), hh, mm };
          const shift = wallMinutes(toWall(toInstant(w, tz), tz)) - wallMinutes(w);
          expect(shift >= 0 && shift <= 60).toBe(true);
        },
      ),
      { numRuns: 300 },
    );
  });
});
