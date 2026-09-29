# Relay F4·P5 Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `calendar` page type to Relay: a shared calendar with month and week views, repeating events with per-occurrence exceptions, per-viewer time zones, RSVP, `.ics` export/import, and "Add to calendar…" from a board sticky.

**Architecture:**
- **Core (`packages/core/src/calendar/`)**, pure and dependency-free:
  - `time.ts`: dates, wall times, and IANA zones via `Intl`.
  - `model.ts`: the stored shape and defensive readers.
  - `recurrence.ts`: expanding a series into the occurrences of a window.
  - `ics.ts`: `.ics` writer and parser.
  - `budget.ts`: the update-size check.
  - The calendar commands are added to `commands/`.
- **Web (`apps/web/src/calendar/`):**
  - A calendar store projects the active calendar page, the way the sheet store does.
  - A calendar controller holds view state and turns user intent into commands, committed through the board controller's `commit` (LOCAL, one undo step).
  - React components render the month and week views, the event editor and the dialogs.

**Tech Stack:** TypeScript 5.9, Yjs 13.6, Zustand 5, React 19 / Next.js 16, Tailwind 4, Vitest + fast-check, Playwright (Chrome channel for headed runs), Biome.

**Spec:** `docs/superpowers/specs/2026-09-24-relay-design.md`. The main section is "### Calendar (F4·P5)". The spec also covers the calendar in:
- the Yjs Document (`calendars`);
- Awareness (`calEvent`);
- Commands and Undo;
- Pages ("+" menu, DeletePage);
- the Canvas UX context menu ("Add to calendar…").

## Global Constraints

- **Budget and dependencies:** $0, and no new runtime or dev dependency. Time zones use `Intl.DateTimeFormat` only.
- **Branch:** `feat/p5-calendar`. The spec is already committed (6ebd632).
- **README:** do not edit it, except in Task 12.
- **Windows:** never create two files whose names differ only by case.
- **Model:** `calendars[pageId].events[eventId]` is a `Y.Map` with keys:
  - `title`, `notes?`, `color`, `when` (atomic), `rule?` (atomic);
  - `exceptions` (`Y.Map<'YYYY-MM-DD', atomic>`) and `rsvp` (`Y.Map<userId, atomic>`);
  - `link?` (atomic), `uid?`, `createdBy`, `createdAt`.
- **`when`:**
  - all-day: `{ allDay: true, start: 'YYYY-MM-DD', end: 'YYYY-MM-DD' }`, end inclusive;
  - timed: `{ allDay: false, start: 'YYYY-MM-DDTHH:mm', end: 'YYYY-MM-DDTHH:mm', tz: IANA }`, as wall time in the creator's zone.
- **`rule`:** `{ freq: 'daily'|'weekly'|'monthly'|'yearly', interval: 1–99, byDay?: (0–6)[] (0 = Monday), until?: 'YYYY-MM-DD', count?: 1–999 }`.
- **Limits:**
  - 500 events per calendar page. Creating at the cap gives the toast "This calendar is full (500 events)".
  - 200 exceptions per series. Over the cap: "Too many changes to this series".
  - 1000 occurrences per view. Over the cap, the view shows "Showing the first 1000 events".
  - Title ≤ 120 characters, notes ≤ 2000, RSVP name ≤ 40, `uid` ≤ 200, link ids 1–64 characters.
  - A timed event lasts at most 14 days and an all-day event at most 366 days.
  - An `.ics` file is at most 1 MB. A batch over 192 KiB gives the toast "Too much to paste at once".
- **Origins:**
  - All calendar commands use `LOCAL` (undoable; each user action is one undo step), except `SetRsvp`, which uses `SESSION`.
  - Page commands stay `SESSION`.
  - The undo manager tracks `calendars` too.
- **Time zones:**
  - A nonexistent wall time moves forward by the gap; an ambiguous one takes the earlier instant; an unknown zone reads as `UTC`.
  - Formatting uses the `en-GB` locale (24 h), and weeks start on Monday.
- **Editing:** week-view drags snap to 15 minutes, and an event lasts at least 15 minutes.
- **Series:**
  - Acting on one occurrence of a series asks "Only this event" / "All events".
  - A whole-series change of the start date, the time of day or the rule clears the exceptions. The dialog warns first.
- **Roles:** viewers can navigate, open events read-only and export `.ics`. They cannot create, edit, move, delete, import or RSVP.
- **Commits:** end every commit message with a blank line, then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- **Browser:** the user may be using the app in the Claude browser pane, so never drive it. Browser checks use throwaway `e2e/zz-scratch-*.spec.ts` files, deleted before committing.

## File Structure

**Core, new files** in `packages/core/src/calendar/`:

| File | Responsibility |
|---|---|
| `time.ts` | `Ymd`/`Wall` parsing and formatting, day arithmetic, weekday (Monday = 0), zone validation, `toWall`/`toInstant`, `viewerZone` |
| `model.ts` | Constants, types, `readWhen`/`readRule`/`readException`/`readCalendar`, `newEventId` |
| `recurrence.ts` | `whenRange`, `expand`, `expandAll`, `isOccurrence` |
| `ics.ts` | `writeIcs`, `parseIcs` |
| `budget.ts` | `importUpdateSize` |

**Core, modified files:**
- `schema/doc.ts`: the `calendars` root.
- `commands/types.ts` and `commands/apply.ts`: the calendar commands, plus calendar handling in `CreatePage`/`DeletePage`.
- `commands/undo.ts`: track `calendars`.
- `presence/state.ts`: `calEvent`.
- `index.ts`: exports.

**Web, new files:**
- `store/calendarStore.ts`
- In `calendar/`: `layout.ts`, `calendarController.ts`, `CalendarPage.tsx`, `CalendarHeader.tsx`, `MonthView.tsx`, `WeekView.tsx`, `EventEditor.tsx`, `SeriesDialog.tsx`, `useCalendarKeys.ts`, `IcsImport.tsx`
- `ui/AddToCalendarDialog.tsx`

**Web, modified files:**
- `board/session.ts`: the calendar store.
- `board/Board.tsx`: the calendar page branch and the Add-to-calendar dialog.
- `board/controller.ts`: `createPage('calendar')`, `commitSession`, `revealShape`, `addToCalendar` UI state.
- `ui/PageTabs.tsx`: enable Calendar in the "+" menu.
- `ui/pageKind.ts`: `onCalendarPage`.
- `sync/presence.ts`: `setCalEvent`.
- `ui/canvasMenuItems.ts` and `ui/CanvasMenu.tsx`: "Add to calendar…".

**Tests, new files:**
- Core: `packages/core/test/calendar-time.test.ts`, `calendar-model.test.ts`, `calendar-commands.test.ts`, `calendar-recurrence.test.ts`, `calendar-ics.test.ts`.
- Web: `apps/web/test/calendarStore.test.ts`, `calendarLayout.test.ts`, `calendarController.test.ts`.
- E2E: `e2e/calendar.spec.ts`.

---
### Task 1: Core time — dates, wall times and IANA zones

**Files:**
- Create: `packages/core/src/calendar/time.ts`
- Modify: `packages/core/src/index.ts` (add `export * from './calendar/time';`)
- Test: `packages/core/test/calendar-time.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces (every later task relies on these names):
  - Types:
    - `interface Ymd { y: number; m: number; d: number }` (m is 1–12)
    - `interface Wall extends Ymd { hh: number; mm: number }`
  - Constants: `MIN_YEAR = 1900`, `MAX_YEAR = 2200`.
  - Parsing and formatting:
    - `parseDate(v: unknown): Ymd | null` reads `'YYYY-MM-DD'` and rejects impossible dates or years outside the range.
    - `parseWall(v: unknown): Wall | null` reads `'YYYY-MM-DDTHH:mm'`.
    - `formatDate(d: Ymd): string` and `formatWall(w: Wall): string`.
  - Calendar arithmetic:
    - `isLeap(y)` and `daysInMonth(y, m)`;
    - `dayNumber(d: Ymd): number` (days since 1970-01-01) and `fromDayNumber(n): Ymd`;
    - `addDays(d, n): Ymd`;
    - `weekday(d): number` (0 = Monday … 6 = Sunday);
    - `wallMinutes(w): number` and `fromWallMinutes(n): Wall`.
  - Zones:
    - `isValidZone(tz: unknown): tz is string` and `safeZone(tz: unknown): string` (falls back to `'UTC'`);
    - `zoneOffset(ms, tz): number` (minutes, east positive);
    - `toWall(ms, tz): Wall` and `toInstant(w, tz): number`;
    - `viewerZone(): string` and `todayIn(ms, tz): string`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/calendar-time.test.ts
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
  toInstant,
  toWall,
  wallMinutes,
  weekday,
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
        fc.integer({ min: dayNumber({ y: 2000, m: 1, d: 1 }), max: dayNumber({ y: 2060, m: 1, d: 1 }) }),
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @relay/core -- calendar-time`
Expected: FAIL. The imports are not exported from `../src`.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/calendar/time.ts
/** Calendar dates and wall times, and conversion between wall time in an IANA zone and instants. */

export interface Ymd {
  y: number;
  /** 1–12 */
  m: number;
  d: number;
}

export interface Wall extends Ymd {
  hh: number;
  mm: number;
}

export const MIN_YEAR = 1900;
export const MAX_YEAR = 2200;
const DAY_MS = 86_400_000;
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const WALL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

export function daysInMonth(y: number, m: number): number {
  if (m === 2) return isLeap(y) ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}

const validYmd = (y: number, m: number, d: number): boolean =>
  y >= MIN_YEAR && y <= MAX_YEAR && m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);

export function parseDate(v: unknown): Ymd | null {
  if (typeof v !== 'string') return null;
  const r = DATE_RE.exec(v);
  if (!r) return null;
  const y = Number(r[1]);
  const m = Number(r[2]);
  const d = Number(r[3]);
  return validYmd(y, m, d) ? { y, m, d } : null;
}

export function parseWall(v: unknown): Wall | null {
  if (typeof v !== 'string') return null;
  const r = WALL_RE.exec(v);
  if (!r) return null;
  const y = Number(r[1]);
  const m = Number(r[2]);
  const d = Number(r[3]);
  const hh = Number(r[4]);
  const mm = Number(r[5]);
  return validYmd(y, m, d) && hh <= 23 && mm <= 59 ? { y, m, d, hh, mm } : null;
}

const p2 = (n: number): string => String(n).padStart(2, '0');
export const formatDate = (d: Ymd): string => `${String(d.y).padStart(4, '0')}-${p2(d.m)}-${p2(d.d)}`;
export const formatWall = (w: Wall): string => `${formatDate(w)}T${p2(w.hh)}:${p2(w.mm)}`;

/** Days since 1970-01-01. */
export const dayNumber = (d: Ymd): number => Math.floor(Date.UTC(d.y, d.m - 1, d.d) / DAY_MS);

export function fromDayNumber(n: number): Ymd {
  const t = new Date(n * DAY_MS);
  return { y: t.getUTCFullYear(), m: t.getUTCMonth() + 1, d: t.getUTCDate() };
}

export const addDays = (d: Ymd, n: number): Ymd => fromDayNumber(dayNumber(d) + n);

/** 0 = Monday … 6 = Sunday. */
export const weekday = (d: Ymd): number => (new Date(dayNumber(d) * DAY_MS).getUTCDay() + 6) % 7;

/** A wall time as minutes since 1970-01-01T00:00 (no zone): for wall arithmetic and comparison. */
export const wallMinutes = (w: Wall): number => dayNumber(w) * 1440 + w.hh * 60 + w.mm;

export function fromWallMinutes(n: number): Wall {
  const day = Math.floor(n / 1440);
  const rest = n - day * 1440;
  return { ...fromDayNumber(day), hh: Math.floor(rest / 60), mm: rest % 60 };
}

// One formatter per zone. Zone names can come from peers, so the cache is bounded.
const MAX_CACHED_ZONES = 200;
const formatters = new Map<string, Intl.DateTimeFormat | null>();

function makeFormatter(tz: string): Intl.DateTimeFormat | null {
  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
    });
  } catch {
    return null;
  }
}

function formatter(tz: string): Intl.DateTimeFormat | null {
  const cached = formatters.get(tz);
  if (cached !== undefined) return cached;
  const f = makeFormatter(tz);
  if (formatters.size < MAX_CACHED_ZONES) formatters.set(tz, f);
  return f;
}

export const isValidZone = (tz: unknown): tz is string =>
  typeof tz === 'string' && tz.length > 0 && tz.length <= 64 && formatter(tz) !== null;

export const safeZone = (tz: unknown): string => (isValidZone(tz) ? tz : 'UTC');

/** Offset of `tz` from UTC at instant `ms`, in minutes (east positive). */
export function zoneOffset(ms: number, tz: string): number {
  const f = formatter(tz) ?? formatter('UTC');
  if (!f) return 0;
  const parts = f.formatToParts(new Date(ms));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour') % 24,
    get('minute'),
    get('second'),
  );
  return Math.round((asUtc - Math.floor(ms / 1000) * 1000) / 60_000);
}

export function toWall(ms: number, tz: string): Wall {
  const t = new Date(ms + zoneOffset(ms, tz) * 60_000);
  return {
    y: t.getUTCFullYear(),
    m: t.getUTCMonth() + 1,
    d: t.getUTCDate(),
    hh: t.getUTCHours(),
    mm: t.getUTCMinutes(),
  };
}

/**
 * The instant a wall time names in `tz`. A wall time that happens twice (fall-back overlap)
 * takes the earlier instant; one that does not exist (spring-forward gap) moves forward by
 * the length of the gap.
 */
export function toInstant(w: Wall, tz: string): number {
  const guess = Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm);
  const before = zoneOffset(guess - DAY_MS, tz);
  const after = zoneOffset(guess + DAY_MS, tz);
  const target = wallMinutes(w);
  const hits = [before, after]
    .map((o) => guess - o * 60_000)
    .filter((t) => wallMinutes(toWall(t, tz)) === target);
  if (hits.length > 0) return Math.min(...hits);
  // In a gap: with the offset from before the change, the instant lands just past it.
  return guess - before * 60_000;
}

/** The viewer's own zone (UTC when the runtime cannot tell). */
export function viewerZone(): string {
  try {
    return safeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return 'UTC';
  }
}

/** Today's date in `tz`. */
export const todayIn = (ms: number, tz: string): string => formatDate(toWall(ms, tz));
```

Also add `export * from './calendar/time';` to `packages/core/src/index.ts`, keeping the alphabetical order: it goes right after the `./clipboard/clip` line.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @relay/core -- calendar-time`
Expected: PASS (8 tests).

If the Havana test finds no gap, the runtime's tzdata no longer has Cuban DST. In that case change the zone in that one test to `America/Santiago` with the scan over September, and explain the change in the report. Do not delete the test.

- [ ] **Step 5: Run the suite, typecheck and lint, then commit**

Run: `npm test -w @relay/core && npm run typecheck && npm run lint`

```bash
git add packages/core/src/calendar/time.ts packages/core/src/index.ts packages/core/test/calendar-time.test.ts
git commit -m "feat(core): calendar dates, wall times and IANA zone conversion"
```

---

### Task 2: Core calendar model, root and page lifecycle

**Files:**
- Create: `packages/core/src/calendar/model.ts`
- Modify:
  - `packages/core/src/schema/doc.ts` (the `calendars` root)
  - `packages/core/src/commands/undo.ts` (track `calendars`)
  - `packages/core/src/commands/apply.ts` (`CreatePage` / `DeletePage`)
  - `packages/core/src/index.ts` (add `export * from './calendar/model';`)
- Test: `packages/core/test/calendar-model.test.ts`

**Interfaces:**
- Consumes (Task 1): `parseDate`, `parseWall`, `formatDate`, `formatWall`, `addDays`, `dayNumber`, `wallMinutes`, `fromWallMinutes`, `safeZone`.
- Produces:
  - Constants:
    - `MAX_EVENTS = 500`, `MAX_EXCEPTIONS = 200`, `MAX_OCCURRENCES = 1000`
    - `MAX_EVENT_TITLE = 120`, `MAX_EVENT_NOTES = 2000`, `MAX_RSVP_NAME = 40`, `MAX_UID = 200`
    - `MAX_TIMED_DAYS = 14`, `MAX_ALLDAY_DAYS = 366`, `MIN_EVENT_MINUTES = 15`
    - `EVENT_COLORS: readonly string[]` (cobalt, flame, sun, ink)
    - `FREQS`
  - Types:
    - `Freq`, `When`, `Rule`, `Exception`, `RsvpStatus`, `Rsvp`, `EventLink`
    - `CalendarEvent` with `{ id, title, notes, color, when, rule?, exceptions: Record<string, Exception>, rsvp: Record<string, Rsvp>, link?, uid?, createdBy, createdAt }`
    - `CalendarSnapshot { events: CalendarEvent[] }`, sorted by id
    - `EventFields { title, notes?, color, when, rule?, link?, uid?, createdBy, createdAt }`
  - Readers and ids:
    - `readWhen(v): When | null`
    - `readRule(v): Rule | undefined`
    - `readException(v): Exception | null`
    - `readCalendar(v: unknown): CalendarSnapshot | null`
    - `newEventId(): string`
  - The `calendars` root in `Roots`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/calendar-model.test.ts
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyCommand,
  createUndo,
  EVENT_COLORS,
  getRoots,
  LOCAL_ORIGIN,
  MAX_EVENT_TITLE,
  readCalendar,
  readRule,
  readWhen,
  SESSION_ORIGIN,
} from '../src';

const page = (id: string, type: 'board' | 'sheet' | 'calendar') => ({
  type: 'CreatePage' as const,
  page: { id, type, title: 'Cal', order: 'a1', createdBy: 'u1', createdAt: 1 },
});

function calendarDoc() {
  const doc = new Y.Doc();
  applyCommand(doc, page('cal', 'calendar'), SESSION_ORIGIN);
  const events = getRoots(doc).calendars.get('cal')?.get('events');
  if (!(events instanceof Y.Map)) throw new Error('no events map');
  return { doc, events: events as Y.Map<unknown> };
}

function putEvent(events: Y.Map<unknown>, id: string, fields: Record<string, unknown>) {
  const m = new Y.Map<unknown>();
  events.set(id, m);
  for (const [k, v] of Object.entries(fields)) m.set(k, v);
  if (!m.has('exceptions')) m.set('exceptions', new Y.Map());
  if (!m.has('rsvp')) m.set('rsvp', new Y.Map());
  return m;
}

describe('calendar page lifecycle', () => {
  it('creates an empty calendar with a calendar page, and deletes it with the page', () => {
    const { doc } = calendarDoc();
    expect(readCalendar(getRoots(doc).calendars.get('cal'))).toEqual({ events: [] });
    applyCommand(doc, { type: 'DeletePage', id: 'cal' }, SESSION_ORIGIN);
    expect(getRoots(doc).calendars.has('cal')).toBe(false);
  });

  it('creates no calendar for other page types', () => {
    const doc = new Y.Doc();
    applyCommand(doc, page('b', 'board'), SESSION_ORIGIN);
    expect(getRoots(doc).calendars.size).toBe(0);
  });

  it('is tracked by the undo manager for LOCAL edits', () => {
    const { doc, events } = calendarDoc();
    const undo = createUndo(doc);
    doc.transact(() => {
      putEvent(events, 'e1', {
        title: 'Standup',
        color: EVENT_COLORS[0],
        when: { allDay: true, start: '2026-09-28', end: '2026-09-28' },
      });
    }, LOCAL_ORIGIN);
    expect(readCalendar(getRoots(doc).calendars.get('cal'))?.events).toHaveLength(1);
    undo.undo();
    expect(readCalendar(getRoots(doc).calendars.get('cal'))?.events).toHaveLength(0);
  });
});

describe('reading untrusted calendar data', () => {
  it('normalizes whens', () => {
    expect(readWhen({ allDay: true, start: '2026-09-28', end: '2026-09-26' })).toEqual({
      allDay: true,
      start: '2026-09-28',
      end: '2026-09-28',
    });
    expect(readWhen({ allDay: true, start: '2026-01-01', end: '2028-01-01' })?.end).toBe(
      '2027-01-01',
    );
    expect(
      readWhen({ allDay: false, start: '2026-09-28T10:00', end: '2026-09-28T09:00', tz: 'X/Y' }),
    ).toEqual({ allDay: false, start: '2026-09-28T10:00', end: '2026-09-28T11:00', tz: 'UTC' });
    expect(
      readWhen({ allDay: false, start: '2026-09-01T10:00', end: '2026-10-30T10:00', tz: 'UTC' })
        ?.end,
    ).toBe('2026-09-15T10:00');
    expect(readWhen({ allDay: true, start: 'soon', end: '2026-09-28' })).toBeNull();
    expect(readWhen({ start: '2026-09-28' })).toBeNull();
    expect(readWhen('2026-09-28')).toBeNull();
  });

  it('clamps rules and drops unknown frequencies', () => {
    expect(readRule({ freq: 'weekly', interval: 500, byDay: [3, 1, 1, 9, 'x'], count: 5000 })).toEqual(
      { freq: 'weekly', interval: 99, byDay: [1, 3], count: 999 },
    );
    expect(readRule({ freq: 'daily', byDay: [1] })).toEqual({ freq: 'daily', interval: 1 });
    expect(readRule({ freq: 'hourly', interval: 1 })).toBeUndefined();
    expect(readRule({ freq: 'monthly', interval: 2, until: 'never' })).toEqual({
      freq: 'monthly',
      interval: 2,
    });
  });

  it('reads events defensively: caps, defaults, invalid parts dropped', () => {
    const { doc, events } = calendarDoc();
    const m = putEvent(events, 'e1', {
      title: 'x'.repeat(500),
      notes: 42,
      color: 'url(evil)',
      when: { allDay: true, start: '2026-09-28', end: '2026-09-29' },
      rule: { freq: 'daily', interval: 1 },
      link: { pageId: 'main', shapeId: 's'.repeat(80) },
      uid: 'u'.repeat(300),
      createdBy: 'u1',
      createdAt: 'yesterday',
    });
    const ex = m.get('exceptions') as Y.Map<unknown>;
    ex.set('2026-09-30', { cancelled: true });
    ex.set('not-a-date', { cancelled: true });
    ex.set('2026-10-01', { when: { allDay: true, start: '2026-10-02', end: '2026-10-02' }, title: 'Moved' });
    ex.set('2026-10-03', { title: 'no when' });
    const rsvp = m.get('rsvp') as Y.Map<unknown>;
    rsvp.set('u1', { status: 'yes', name: 'N'.repeat(99) });
    rsvp.set('u2', { status: 'perhaps', name: 'B' });
    putEvent(events, 'e0', { title: '', when: { allDay: false, start: 'bad', end: 'bad' } });
    putEvent(events, 'e2', { title: '   ', color: EVENT_COLORS[1], when: { allDay: true, start: '2026-09-01', end: '2026-09-01' } });

    const cal = readCalendar(getRoots(doc).calendars.get('cal'));
    expect(cal?.events.map((e) => e.id)).toEqual(['e1', 'e2']);
    const [e1, e2] = cal?.events ?? [];
    expect(e1?.title).toHaveLength(MAX_EVENT_TITLE);
    expect(e1?.notes).toBe('');
    expect(e1?.color).toBe(EVENT_COLORS[0]);
    expect(e1?.link).toBeUndefined();
    expect(e1?.uid).toHaveLength(200);
    expect(e1?.createdAt).toBe(0);
    expect(Object.keys(e1?.exceptions ?? {})).toEqual(['2026-09-30', '2026-10-01']);
    expect(e1?.rsvp).toEqual({ u1: { status: 'yes', name: 'N'.repeat(40) } });
    expect(e2?.title).toBe('Untitled');
    expect(e2?.color).toBe(EVENT_COLORS[1]);
  });

  it('reads only the first 500 events by id, and a malformed calendar as null', () => {
    const { doc, events } = calendarDoc();
    doc.transact(() => {
      for (let i = 0; i < 520; i++) {
        putEvent(events, `e${String(i).padStart(3, '0')}`, {
          title: 'T',
          when: { allDay: true, start: '2026-09-28', end: '2026-09-28' },
        });
      }
    });
    const cal = readCalendar(getRoots(doc).calendars.get('cal'));
    expect(cal?.events).toHaveLength(500);
    expect(cal?.events.at(-1)?.id).toBe('e499');
    expect(readCalendar(new Y.Map())).toBeNull();
    expect(readCalendar('nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @relay/core -- calendar-model`
Expected: FAIL. The names are not exported, and `calendars` is not a root.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/calendar/model.ts
import * as Y from 'yjs';
import { PALETTE } from '../schema/defaults';
import { sheetId } from '../sheet/model';
import {
  addDays,
  dayNumber,
  formatDate,
  formatWall,
  fromWallMinutes,
  parseDate,
  parseWall,
  safeZone,
  wallMinutes,
} from './time';

export const MAX_EVENTS = 500;
export const MAX_EXCEPTIONS = 200;
export const MAX_OCCURRENCES = 1000;
export const MAX_EVENT_TITLE = 120;
export const MAX_EVENT_NOTES = 2000;
export const MAX_RSVP_NAME = 40;
export const MAX_UID = 200;
export const MAX_TIMED_DAYS = 14;
export const MAX_ALLDAY_DAYS = 366;
export const MIN_EVENT_MINUTES = 15;
const MAX_LINK_ID = 64;

/** Event colours: the board palette colours that read on paper. The first is the default. */
export const EVENT_COLORS: readonly string[] = [
  PALETTE.cobalt,
  PALETTE.flame,
  PALETTE.sun,
  PALETTE.ink,
];

export const FREQS = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export type Freq = (typeof FREQS)[number];

export type When =
  | { allDay: true; start: string; end: string }
  | { allDay: false; start: string; end: string; tz: string };

export interface Rule {
  freq: Freq;
  interval: number;
  /** Weekly only: 0 = Monday … 6 = Sunday, ascending, unique. */
  byDay?: number[];
  until?: string;
  count?: number;
}

export type Exception =
  | { cancelled: true }
  | { when: When; title?: string; notes?: string; color?: string };

export type RsvpStatus = 'yes' | 'maybe' | 'no';
export const RSVP_STATUSES: readonly RsvpStatus[] = ['yes', 'maybe', 'no'];

export interface Rsvp {
  status: RsvpStatus;
  name: string;
}

export interface EventLink {
  pageId: string;
  shapeId: string;
}

export interface CalendarEvent {
  id: string;
  title: string;
  notes: string;
  color: string;
  when: When;
  rule?: Rule;
  /** Keyed by the occurrence's original date ('YYYY-MM-DD'). */
  exceptions: Record<string, Exception>;
  /** Keyed by user id. */
  rsvp: Record<string, Rsvp>;
  link?: EventLink;
  uid?: string;
  createdBy: string;
  createdAt: number;
}

export interface CalendarSnapshot {
  /** Sorted by id. */
  events: CalendarEvent[];
}

/** What CreateEvent writes (exceptions and RSVP start empty). */
export interface EventFields {
  title: string;
  notes?: string;
  color: string;
  when: When;
  rule?: Rule;
  link?: EventLink;
  uid?: string;
  createdBy: string;
  createdAt: number;
}

export const newEventId = (): string => sheetId();

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

export function readWhen(v: unknown): When | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (o.allDay === true) {
    const s = parseDate(o.start);
    if (!s) return null;
    const e = parseDate(o.end);
    let end = e && dayNumber(e) >= dayNumber(s) ? e : s;
    if (dayNumber(end) - dayNumber(s) > MAX_ALLDAY_DAYS - 1) end = addDays(s, MAX_ALLDAY_DAYS - 1);
    return { allDay: true, start: formatDate(s), end: formatDate(end) };
  }
  if (o.allDay === false) {
    const s = parseWall(o.start);
    if (!s) return null;
    const e = parseWall(o.end);
    const sm = wallMinutes(s);
    let em = e ? wallMinutes(e) : sm + 60;
    if (em < sm) em = sm + 60;
    em = Math.min(em, sm + MAX_TIMED_DAYS * 1440);
    return {
      allDay: false,
      start: formatWall(s),
      end: formatWall(fromWallMinutes(em)),
      tz: safeZone(o.tz),
    };
  }
  return null;
}

const clampInt = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v)
    ? Math.min(hi, Math.max(lo, Math.round(v)))
    : undefined;

export function readRule(v: unknown): Rule | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  const freq = FREQS.find((f) => f === o.freq);
  if (!freq) return undefined;
  const rule: Rule = { freq, interval: clampInt(o.interval, 1, 99) ?? 1 };
  if (freq === 'weekly' && Array.isArray(o.byDay)) {
    const days = [
      ...new Set(
        o.byDay.filter((d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6),
      ),
    ].sort((a, b) => a - b);
    if (days.length > 0) rule.byDay = days;
  }
  const until = parseDate(o.until);
  if (until) rule.until = formatDate(until);
  const count = clampInt(o.count, 1, 999);
  if (count !== undefined) rule.count = count;
  return rule;
}

const readColor = (v: unknown): string | undefined =>
  typeof v === 'string' && EVENT_COLORS.includes(v) ? v : undefined;

export function readException(v: unknown): Exception | null {
  if (!v || typeof v !== 'object') return null;
  const o = v as Record<string, unknown>;
  if (o.cancelled === true) return { cancelled: true };
  const when = readWhen(o.when);
  if (!when) return null;
  const ex: Exception = { when };
  const title = str(o.title)?.slice(0, MAX_EVENT_TITLE);
  if (title) ex.title = title;
  const notes = str(o.notes)?.slice(0, MAX_EVENT_NOTES);
  if (notes !== undefined) ex.notes = notes;
  const color = readColor(o.color);
  if (color) ex.color = color;
  return ex;
}

const isLinkId = (v: unknown): v is string =>
  typeof v === 'string' && v.length > 0 && v.length <= MAX_LINK_ID;

function readLink(v: unknown): EventLink | undefined {
  if (!v || typeof v !== 'object') return undefined;
  const o = v as Record<string, unknown>;
  return isLinkId(o.pageId) && isLinkId(o.shapeId)
    ? { pageId: o.pageId, shapeId: o.shapeId }
    : undefined;
}

function readEvent(id: string, m: Y.Map<unknown>): CalendarEvent | null {
  const when = readWhen(m.get('when'));
  if (!when) return null;
  const title = (str(m.get('title')) ?? '').slice(0, MAX_EVENT_TITLE);
  const createdAt = m.get('createdAt');
  const ev: CalendarEvent = {
    id,
    title: title.trim() ? title : 'Untitled',
    notes: (str(m.get('notes')) ?? '').slice(0, MAX_EVENT_NOTES),
    color: readColor(m.get('color')) ?? (EVENT_COLORS[0] as string),
    when,
    exceptions: {},
    rsvp: {},
    createdBy: (str(m.get('createdBy')) ?? '').slice(0, MAX_LINK_ID),
    createdAt: typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : 0,
  };
  const rule = readRule(m.get('rule'));
  if (rule) ev.rule = rule;
  const link = readLink(m.get('link'));
  if (link) ev.link = link;
  const uid = str(m.get('uid'));
  if (uid) ev.uid = uid.slice(0, MAX_UID);
  const exceptions: unknown = m.get('exceptions');
  if (exceptions instanceof Y.Map) {
    const keys = [...exceptions.keys()].filter((k) => parseDate(k) !== null).sort();
    for (const key of keys.slice(0, MAX_EXCEPTIONS)) {
      const ex = readException(exceptions.get(key));
      if (ex) ev.exceptions[key] = ex;
    }
  }
  const rsvp: unknown = m.get('rsvp');
  if (rsvp instanceof Y.Map) {
    for (const [userId, raw] of rsvp.entries()) {
      if (!isLinkId(userId) || !raw || typeof raw !== 'object') continue;
      const o = raw as Record<string, unknown>;
      const status = RSVP_STATUSES.find((s) => s === o.status);
      if (!status) continue;
      ev.rsvp[userId] = { status, name: (str(o.name) ?? '').slice(0, MAX_RSVP_NAME) };
    }
  }
  return ev;
}

/** Immutable, normalized snapshot of a stored calendar; null if the value is not a calendar. */
export function readCalendar(v: unknown): CalendarSnapshot | null {
  if (!(v instanceof Y.Map)) return null;
  const events: unknown = v.get('events');
  if (!(events instanceof Y.Map)) return null;
  const ids = [...events.keys()].sort().slice(0, MAX_EVENTS);
  const out: CalendarEvent[] = [];
  for (const id of ids) {
    const m: unknown = events.get(id);
    if (!(m instanceof Y.Map)) continue;
    const ev = readEvent(id, m);
    if (ev) out.push(ev);
  }
  return { events: out };
}
```

Note: the test expects `e0` (bad `when`) to be dropped, and events with an empty or whitespace title to read as `'Untitled'`.

Changes to existing files:
- **`packages/core/src/schema/doc.ts`:**
  - Add to `Roots`:
    ```ts
    /** Calendar pages' events, keyed by page id (created with the page). */
    calendars: Y.Map<Y.Map<unknown>>;
    ```
  - Add to `getRoots`: `calendars: doc.getMap<Y.Map<unknown>>('calendars'),`.
- **`packages/core/src/commands/undo.ts`:** destructure `calendars` too, and track `[shapes, connectors, sheets, calendars]`.
- **`packages/core/src/commands/apply.ts`:**
  - Destructure `calendars` in `apply`.
  - In `case 'CreatePage'`, after the sheet block:
    ```ts
    if (cmd.page.type === 'calendar' && !calendars.has(cmd.page.id)) {
      const calendar = new Y.Map<unknown>();
      calendars.set(cmd.page.id, calendar);
      calendar.set('events', new Y.Map<unknown>());
    }
    ```
  - In `case 'DeletePage'`, next to the sheets delete: `if (calendars.has(cmd.id)) calendars.delete(cmd.id);`.
- **`packages/core/src/index.ts`:** add `export * from './calendar/model';` after the `./calendar/time` line. Order the two calendar lines alphabetically: `model` before `time`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @relay/core -- calendar-model`
Expected: PASS (7 tests).

- [ ] **Step 5: Run the core suite, typecheck and lint, then commit**

Run: `npm test -w @relay/core && npm run typecheck && npm run lint`
Expected: all green. The existing page and undo tests must still pass.

```bash
git add packages/core/src/calendar/model.ts packages/core/src/schema/doc.ts packages/core/src/commands/undo.ts packages/core/src/commands/apply.ts packages/core/src/index.ts packages/core/test/calendar-model.test.ts
git commit -m "feat(core): calendar model, defensive reader, calendars root created and deleted with its page"
```

---
### Task 3: Core calendar commands, import budget and convergence

**Files:**
- Create: `packages/core/src/calendar/budget.ts`
- Modify:
  - `packages/core/src/commands/types.ts`
  - `packages/core/src/commands/apply.ts`
  - `packages/core/src/index.ts` (add `export * from './calendar/budget';`)
- Test: `packages/core/test/calendar-commands.test.ts`

**Interfaces:**
- Consumes:
  - From Task 2: `EventFields`, `Exception`, `Rule`, `RsvpStatus`, `When`, `MAX_EVENTS`, `MAX_EXCEPTIONS`, `MAX_EVENT_TITLE`, `MAX_EVENT_NOTES`, `MAX_RSVP_NAME`, `MAX_UID`, `readCalendar`, and the `calendars` root.
- Produces, as new `Command` variants:
  - `{ type: 'CreateEvent'; pageId: string; id: string; fields: EventFields }`
  - `{ type: 'UpdateEvent'; pageId: string; id: string; patch: EventPatch; clearExceptions?: boolean }`
  - `{ type: 'DeleteEvent'; pageId: string; id: string }`
  - `{ type: 'SetOccurrence'; pageId: string; id: string; key: string; value: Exception }`
  - `{ type: 'ClearOccurrence'; pageId: string; id: string; key: string }`
  - `{ type: 'ImportEvents'; pageId: string; events: ImportedEventWrite[] }`
  - `{ type: 'SetRsvp'; pageId: string; id: string; userId: string; status: RsvpStatus | null; name: string }`
- Produces, as exported types:
  - `EventPatch = { title?: string; notes?: string; color?: string; when?: When; rule?: Rule | null }`. `rule: null` removes the rule.
  - `ImportedEventWrite = { id: string; fields: EventFields; exceptions: Record<string, Exception> }`.
- Produces `importUpdateSize(events: ImportedEventWrite[]): number` (bytes of the update the import would send).
- Behaviour on apply:
  - Any command on a missing calendar or event does nothing.
  - `CreateEvent` does nothing when the page already has `MAX_EVENTS` events or the id exists.
  - `SetOccurrence` does nothing when the series already has `MAX_EXCEPTIONS` exceptions and the key is new.
  - `ImportEvents` stops at the cap.
  - Strings are capped on write.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/calendar-commands.test.ts
declare const process: { env: Record<string, string | undefined> };

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  addDays,
  applyCommand,
  type Command,
  createUndo,
  EVENT_COLORS,
  type EventFields,
  formatDate,
  getRoots,
  importUpdateSize,
  LOCAL_ORIGIN,
  MAX_EVENTS,
  MAX_EXCEPTIONS,
  readCalendar,
  SESSION_ORIGIN,
} from '../src';

const RUNS = Number(process.env.RELAY_FC_RUNS ?? 100);

const fields = (over: Partial<EventFields> = {}): EventFields => ({
  title: 'Standup',
  color: EVENT_COLORS[0] as string,
  when: { allDay: false, start: '2026-09-28T09:00', end: '2026-09-28T09:15', tz: 'Europe/Madrid' },
  createdBy: 'u1',
  createdAt: 1,
  ...over,
});

function setup() {
  const doc = new Y.Doc();
  applyCommand(
    doc,
    {
      type: 'CreatePage',
      page: { id: 'cal', type: 'calendar', title: 'Cal', order: 'a1', createdBy: 'u1', createdAt: 1 },
    },
    SESSION_ORIGIN,
  );
  const run = (c: Command) => applyCommand(doc, c, LOCAL_ORIGIN);
  const read = () => readCalendar(getRoots(doc).calendars.get('cal'))?.events ?? [];
  return { doc, run, read };
}

describe('calendar commands', () => {
  it('creates, updates and deletes an event', () => {
    const { run, read } = setup();
    run({ type: 'CreateEvent', pageId: 'cal', id: 'e1', fields: fields({ rule: { freq: 'weekly', interval: 1 } }) });
    expect(read()[0]).toMatchObject({ id: 'e1', title: 'Standup', rule: { freq: 'weekly', interval: 1 } });
    run({ type: 'UpdateEvent', pageId: 'cal', id: 'e1', patch: { title: 'Daily', rule: null, notes: 'n' } });
    expect(read()[0]).toMatchObject({ title: 'Daily', notes: 'n' });
    expect(read()[0]?.rule).toBeUndefined();
    run({ type: 'DeleteEvent', pageId: 'cal', id: 'e1' });
    expect(read()).toHaveLength(0);
  });

  it('caps text on write and ignores missing calendars and events', () => {
    const { run, read } = setup();
    run({ type: 'CreateEvent', pageId: 'cal', id: 'e1', fields: fields({ title: 'x'.repeat(300), notes: 'y'.repeat(3000) }) });
    expect(read()[0]?.title).toHaveLength(120);
    expect(read()[0]?.notes).toHaveLength(2000);
    run({ type: 'CreateEvent', pageId: 'nope', id: 'e2', fields: fields() });
    run({ type: 'UpdateEvent', pageId: 'cal', id: 'ghost', patch: { title: 'boo' } });
    run({ type: 'SetOccurrence', pageId: 'cal', id: 'ghost', key: '2026-09-28', value: { cancelled: true } });
    expect(read().map((e) => e.id)).toEqual(['e1']);
  });

  it('writes and clears occurrence exceptions, and clears them all on request', () => {
    const { run, read } = setup();
    run({ type: 'CreateEvent', pageId: 'cal', id: 'e1', fields: fields({ rule: { freq: 'daily', interval: 1 } }) });
    run({ type: 'SetOccurrence', pageId: 'cal', id: 'e1', key: '2026-09-29', value: { cancelled: true } });
    run({
      type: 'SetOccurrence',
      pageId: 'cal',
      id: 'e1',
      key: '2026-09-30',
      value: { when: fields().when, title: 'Moved' },
    });
    expect(Object.keys(read()[0]?.exceptions ?? {})).toEqual(['2026-09-29', '2026-09-30']);
    run({ type: 'ClearOccurrence', pageId: 'cal', id: 'e1', key: '2026-09-29' });
    expect(Object.keys(read()[0]?.exceptions ?? {})).toEqual(['2026-09-30']);
    run({ type: 'UpdateEvent', pageId: 'cal', id: 'e1', patch: { when: fields().when }, clearExceptions: true });
    expect(read()[0]?.exceptions).toEqual({});
  });

  it('refuses a new event at the page cap, and a new exception at the series cap', () => {
    const { doc, run, read } = setup();
    doc.transact(() => {
      for (let i = 0; i < MAX_EVENTS; i++) run({ type: 'CreateEvent', pageId: 'cal', id: `e${i}`, fields: fields() });
    });
    run({ type: 'CreateEvent', pageId: 'cal', id: 'extra', fields: fields() });
    expect(read().some((e) => e.id === 'extra')).toBe(false);
    doc.transact(() => {
      for (let i = 0; i < MAX_EXCEPTIONS + 5; i++) {
        const key = formatDate(addDays({ y: 2027, m: 1, d: 1 }, i));
        run({ type: 'SetOccurrence', pageId: 'cal', id: 'e0', key, value: { cancelled: true } });
      }
    });
    const m = getRoots(doc).calendars.get('cal')?.get('events') as Y.Map<Y.Map<unknown>>;
    expect((m.get('e0')?.get('exceptions') as Y.Map<unknown>).size).toBe(MAX_EXCEPTIONS);
  });

  it('imports events with exceptions in one step, stopping at the cap', () => {
    const { doc, run, read } = setup();
    const undo = createUndo(doc);
    run({
      type: 'ImportEvents',
      pageId: 'cal',
      events: [
        { id: 'a', fields: fields({ uid: 'x@y', rule: { freq: 'daily', interval: 1 } }), exceptions: { '2026-09-29': { cancelled: true } } },
        { id: 'b', fields: fields({ title: 'B' }), exceptions: {} },
      ],
    });
    expect(read().map((e) => [e.id, e.uid ?? null])).toEqual([['a', 'x@y'], ['b', null]]);
    expect(read()[0]?.exceptions).toEqual({ '2026-09-29': { cancelled: true } });
    undo.undo();
    expect(read()).toHaveLength(0);
  });

  it('sets and removes RSVP answers; SESSION answers are not undoable', () => {
    const { doc, run, read } = setup();
    run({ type: 'CreateEvent', pageId: 'cal', id: 'e1', fields: fields() });
    const undo = createUndo(doc);
    applyCommand(doc, { type: 'SetRsvp', pageId: 'cal', id: 'e1', userId: 'u2', status: 'maybe', name: 'B'.repeat(80) }, SESSION_ORIGIN);
    expect(read()[0]?.rsvp).toEqual({ u2: { status: 'maybe', name: 'B'.repeat(40) } });
    expect(undo.canUndo()).toBe(false);
    applyCommand(doc, { type: 'SetRsvp', pageId: 'cal', id: 'e1', userId: 'u2', status: null, name: '' }, SESSION_ORIGIN);
    expect(read()[0]?.rsvp).toEqual({});
  });

  it('measures an import update', () => {
    const small = importUpdateSize([{ id: 'a', fields: fields(), exceptions: {} }]);
    const big = importUpdateSize(
      Array.from({ length: 50 }, (_, i) => ({ id: `e${i}`, fields: fields({ notes: 'z'.repeat(1900) }), exceptions: {} })),
    );
    expect(small).toBeGreaterThan(0);
    expect(big).toBeGreaterThan(90_000);
  });
});

// Three replicas apply random calendar commands and deliver updates in random order; they converge.
type Step =
  | { kind: 'create'; r: number; e: number }
  | { kind: 'title'; r: number; e: number; t: string }
  | { kind: 'delete'; r: number; e: number }
  | { kind: 'cancel'; r: number; e: number; day: number }
  | { kind: 'rsvp'; r: number; e: number; s: 'yes' | 'no' | null }
  | { kind: 'deliver'; from: number; to: number };

const N = 3;
const r = fc.integer({ min: 0, max: N - 1 });
const e = fc.integer({ min: 0, max: 3 });
const stepArb: fc.Arbitrary<Step> = fc.oneof(
  fc.record({ kind: fc.constant('create' as const), r, e }),
  fc.record({ kind: fc.constant('title' as const), r, e, t: fc.string({ maxLength: 5 }) }),
  fc.record({ kind: fc.constant('delete' as const), r, e }),
  fc.record({ kind: fc.constant('cancel' as const), r, e, day: fc.integer({ min: 1, max: 5 }) }),
  fc.record({ kind: fc.constant('rsvp' as const), r, e, s: fc.constantFrom('yes' as const, 'no' as const, null) }),
  fc.record({ kind: fc.constant('deliver' as const), from: r, to: r }),
);

describe('calendar convergence', () => {
  it('three replicas converge under random calendar edits', () => {
    fc.assert(
      fc.property(fc.array(stepArb, { maxLength: 40 }), (steps) => {
        const base = setup().doc;
        const docs = Array.from({ length: N }, () => {
          const d = new Y.Doc();
          Y.applyUpdate(d, Y.encodeStateAsUpdate(base));
          return d;
        });
        for (const s of steps) {
          if (s.kind === 'deliver') {
            const from = docs[s.from] as Y.Doc;
            const to = docs[s.to] as Y.Doc;
            Y.applyUpdate(to, Y.encodeStateAsUpdate(from, Y.encodeStateVector(to)));
            continue;
          }
          const doc = docs[s.r] as Y.Doc;
          const id = `e${s.e}`;
          const c: Command =
            s.kind === 'create'
              ? { type: 'CreateEvent', pageId: 'cal', id, fields: fields() }
              : s.kind === 'title'
                ? { type: 'UpdateEvent', pageId: 'cal', id, patch: { title: s.t } }
                : s.kind === 'delete'
                  ? { type: 'DeleteEvent', pageId: 'cal', id }
                  : s.kind === 'cancel'
                    ? { type: 'SetOccurrence', pageId: 'cal', id, key: `2026-10-0${s.day}`, value: { cancelled: true } }
                    : { type: 'SetRsvp', pageId: 'cal', id, userId: `u${s.r}`, status: s.s, name: 'N' };
          applyCommand(doc, c, s.kind === 'rsvp' ? SESSION_ORIGIN : LOCAL_ORIGIN);
        }
        for (const a of docs) for (const b of docs) Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
        const snaps = docs.map((d) => JSON.stringify(readCalendar(getRoots(d).calendars.get('cal'))));
        expect(new Set(snaps).size).toBe(1);
      }),
      { numRuns: RUNS },
    );
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @relay/core -- calendar-commands`
Expected: FAIL at typecheck or runtime, because the commands and `importUpdateSize` do not exist yet.

- [ ] **Step 3: Write the implementation**

In `packages/core/src/commands/types.ts`:
- add `import type { EventFields, Exception, Rule, RsvpStatus, When } from '../calendar/model';`;
- add the two exported types:

```ts
export interface EventPatch {
  title?: string;
  notes?: string;
  color?: string;
  when?: When;
  /** null removes the rule (the event stops repeating). */
  rule?: Rule | null;
}

export interface ImportedEventWrite {
  id: string;
  fields: EventFields;
  exceptions: Record<string, Exception>;
}
```

Then append these variants to the `Command` union:

```ts
  | { type: 'CreateEvent'; pageId: string; id: string; fields: EventFields }
  | { type: 'UpdateEvent'; pageId: string; id: string; patch: EventPatch; clearExceptions?: boolean }
  | { type: 'DeleteEvent'; pageId: string; id: string }
  | { type: 'SetOccurrence'; pageId: string; id: string; key: string; value: Exception }
  | { type: 'ClearOccurrence'; pageId: string; id: string; key: string }
  | { type: 'ImportEvents'; pageId: string; events: ImportedEventWrite[] }
  | {
      type: 'SetRsvp';
      pageId: string;
      id: string;
      userId: string;
      status: RsvpStatus | null;
      name: string;
    }
```

In `packages/core/src/commands/apply.ts`, add the imports `MAX_EVENTS`, `MAX_EXCEPTIONS`, `MAX_EVENT_TITLE`, `MAX_EVENT_NOTES`, `MAX_RSVP_NAME`, `MAX_UID`, `type EventFields` and `type Exception` from `'../calendar/model'`. Then add the helpers above `function apply`:

```ts
/** A calendar page's events map; null when the page has no (well-formed) calendar. */
function eventsOf(calendars: Y.Map<Y.Map<unknown>>, pageId: string): Y.Map<unknown> | null {
  const cal: unknown = calendars.get(pageId);
  if (!(cal instanceof Y.Map)) return null;
  const events: unknown = cal.get('events');
  return events instanceof Y.Map ? events : null;
}

function eventOf(calendars: Y.Map<Y.Map<unknown>>, pageId: string, id: string): Y.Map<unknown> | null {
  const m: unknown = eventsOf(calendars, pageId)?.get(id);
  return m instanceof Y.Map ? m : null;
}

function writeEvent(
  events: Y.Map<unknown>,
  id: string,
  f: EventFields,
  exceptions: Record<string, Exception> = {},
): void {
  if (events.has(id) || events.size >= MAX_EVENTS) return;
  const m = new Y.Map<unknown>();
  events.set(id, m);
  m.set('title', f.title.slice(0, MAX_EVENT_TITLE));
  if (f.notes) m.set('notes', f.notes.slice(0, MAX_EVENT_NOTES));
  m.set('color', f.color);
  m.set('when', f.when);
  if (f.rule) m.set('rule', f.rule);
  if (f.link) m.set('link', f.link);
  if (f.uid) m.set('uid', f.uid.slice(0, MAX_UID));
  m.set('createdBy', f.createdBy);
  m.set('createdAt', f.createdAt);
  const ex = new Y.Map<unknown>();
  m.set('exceptions', ex);
  for (const [key, value] of Object.entries(exceptions).slice(0, MAX_EXCEPTIONS)) ex.set(key, value);
  m.set('rsvp', new Y.Map<unknown>());
}
```

Add `calendars` to the destructuring at the top of `apply`, and add these cases before `case 'RenameBoard'`:

```ts
    case 'CreateEvent': {
      const events = eventsOf(calendars, cmd.pageId);
      if (events) writeEvent(events, cmd.id, cmd.fields);
      return;
    }
    case 'UpdateEvent': {
      const m = eventOf(calendars, cmd.pageId, cmd.id);
      if (!m) return;
      const p = cmd.patch;
      if (p.title !== undefined) m.set('title', p.title.slice(0, MAX_EVENT_TITLE));
      if (p.notes !== undefined) {
        if (p.notes) m.set('notes', p.notes.slice(0, MAX_EVENT_NOTES));
        else if (m.has('notes')) m.delete('notes');
      }
      if (p.color !== undefined) m.set('color', p.color);
      if (p.when !== undefined) m.set('when', p.when);
      if (p.rule === null) {
        if (m.has('rule')) m.delete('rule');
      } else if (p.rule !== undefined) m.set('rule', p.rule);
      const ex: unknown = m.get('exceptions');
      if (cmd.clearExceptions && ex instanceof Y.Map) for (const k of [...ex.keys()]) ex.delete(k);
      return;
    }
    case 'DeleteEvent': {
      const events = eventsOf(calendars, cmd.pageId);
      if (events?.has(cmd.id)) events.delete(cmd.id);
      return;
    }
    case 'SetOccurrence': {
      const ex: unknown = eventOf(calendars, cmd.pageId, cmd.id)?.get('exceptions');
      if (!(ex instanceof Y.Map)) return;
      if (!ex.has(cmd.key) && ex.size >= MAX_EXCEPTIONS) return;
      ex.set(cmd.key, cmd.value);
      return;
    }
    case 'ClearOccurrence': {
      const ex: unknown = eventOf(calendars, cmd.pageId, cmd.id)?.get('exceptions');
      if (ex instanceof Y.Map && ex.has(cmd.key)) ex.delete(cmd.key);
      return;
    }
    case 'ImportEvents': {
      const events = eventsOf(calendars, cmd.pageId);
      if (!events) return;
      for (const e of cmd.events) writeEvent(events, e.id, e.fields, e.exceptions);
      return;
    }
    case 'SetRsvp': {
      const rsvp: unknown = eventOf(calendars, cmd.pageId, cmd.id)?.get('rsvp');
      if (!(rsvp instanceof Y.Map)) return;
      if (cmd.status === null) {
        if (rsvp.has(cmd.userId)) rsvp.delete(cmd.userId);
      } else rsvp.set(cmd.userId, { status: cmd.status, name: cmd.name.slice(0, MAX_RSVP_NAME) });
      return;
    }
```

```ts
// packages/core/src/calendar/budget.ts
import * as Y from 'yjs';
import { applyCommand } from '../commands/apply';
import type { ImportedEventWrite } from '../commands/types';

/** Bytes of the update an ImportEvents of `events` would send (measured on a scratch doc). */
export function importUpdateSize(events: ImportedEventWrite[]): number {
  const scratch = new Y.Doc();
  try {
    applyCommand(scratch, {
      type: 'CreatePage',
      page: { id: 'p', type: 'calendar', title: '', order: 'a0', createdBy: '', createdAt: 0 },
    });
    const before = Y.encodeStateVector(scratch);
    applyCommand(scratch, { type: 'ImportEvents', pageId: 'p', events });
    return Y.encodeStateAsUpdate(scratch, before).byteLength;
  } finally {
    scratch.destroy();
  }
}
```

In `packages/core/src/index.ts`, add `export * from './calendar/budget';` as the first calendar line (alphabetical order: budget, model, time).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @relay/core -- calendar-commands`
Expected: PASS (8 tests).

- [ ] **Step 5: Run the core suite, typecheck and lint, then commit**

Run: `npm test -w @relay/core && npm run typecheck && npm run lint`

```bash
git add packages/core/src/calendar/budget.ts packages/core/src/commands/types.ts packages/core/src/commands/apply.ts packages/core/src/index.ts packages/core/test/calendar-commands.test.ts
git commit -m "feat(core): calendar commands (events, occurrences, import, RSVP) with caps and convergence"
```

---
### Task 4: Core recurrence expansion

**Files:**
- Create: `packages/core/src/calendar/recurrence.ts`
- Modify: `packages/core/src/index.ts` (add `export * from './calendar/recurrence';`)
- Test: `packages/core/test/calendar-recurrence.test.ts`

**Interfaces:**
- Consumes:
  - From Task 1: `Ymd`, `parseDate`, `parseWall`, `formatDate`, `formatWall`, `addDays`, `dayNumber`, `fromDayNumber`, `daysInMonth`, `isLeap`, `weekday`, `toInstant`, `toWall`, `MAX_YEAR`.
  - From Task 2: `CalendarEvent`, `CalendarSnapshot`, `Rule`, `When`, `MAX_OCCURRENCES`.
- Produces:
  - `interface Window { from: number; to: number; zone: string }`. `from` and `to` are instants; `zone` is the viewer's zone, used to place all-day dates.
  - `interface Occurrence { eventId: string; key: string; when: When; start: number; end: number; title: string; notes: string; color: string; recurring: boolean; changed: boolean }`:
    - `when` is the effective `when`;
    - `start` and `end` are instants, with `end` exclusive; an all-day occurrence runs from 00:00 of its first date to 00:00 after its last date, in `Window.zone`;
    - `changed` is true when the occurrence has a non-cancelled exception.
  - `whenRange(w: When, zone: string): { start: number; end: number }`
  - `occurrenceWhen(base: When, date: Ymd): When`: the rule's occurrence on `date`, before any exception.
  - `isOccurrence(ev: CalendarEvent, date: Ymd): boolean`
  - `expand(ev: CalendarEvent, win: Window, limit?: number): Occurrence[]`: overlapping `[from, to)` and sorted by start.
  - `expandAll(cal: CalendarSnapshot, win: Window): { occurrences: Occurrence[]; truncated: boolean }`: at most `MAX_OCCURRENCES`, sorted by start, then event id, then key.

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/calendar-recurrence.test.ts
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  type CalendarEvent,
  EVENT_COLORS,
  expand,
  expandAll,
  isOccurrence,
  parseDate,
  type Rule,
  toInstant,
  type When,
} from '../src';

const MADRID = 'Europe/Madrid';
const at = (y: number, m: number, d: number, tz = 'UTC') => toInstant({ y, m, d, hh: 0, mm: 0 }, tz);

function ev(when: When, rule?: Rule, exceptions: CalendarEvent['exceptions'] = {}): CalendarEvent {
  return {
    id: 'e1',
    title: 'Series',
    notes: '',
    color: EVENT_COLORS[0] as string,
    when,
    ...(rule ? { rule } : {}),
    exceptions,
    rsvp: {},
    createdBy: 'u1',
    createdAt: 0,
  };
}

const timed = (start: string, end: string, tz = MADRID): When => ({ allDay: false, start, end, tz });
const keys = (e: CalendarEvent, from: number, to: number, zone = MADRID) =>
  expand(e, { from, to, zone }).map((o) => o.key);

describe('expand', () => {
  it('returns a single event once, when it overlaps the window', () => {
    const e = ev(timed('2026-09-28T09:00', '2026-09-28T10:00'));
    expect(keys(e, at(2026, 9, 28, MADRID), at(2026, 9, 29, MADRID))).toEqual(['2026-09-28']);
    expect(keys(e, at(2026, 9, 29, MADRID), at(2026, 9, 30, MADRID))).toEqual([]);
  });

  it('repeats daily with an interval and an inclusive until', () => {
    const e = ev(timed('2026-09-01T09:00', '2026-09-01T09:30'), { freq: 'daily', interval: 2, until: '2026-09-07' });
    expect(keys(e, at(2026, 8, 1), at(2026, 10, 1))).toEqual(['2026-09-01', '2026-09-03', '2026-09-05', '2026-09-07']);
  });

  it('repeats weekly on chosen weekdays, and counts cancelled occurrences toward count', () => {
    const e = ev(
      timed('2026-09-28T09:00', '2026-09-28T09:15'),
      { freq: 'weekly', interval: 1, byDay: [0, 2], count: 4 },
      { '2026-09-30': { cancelled: true } },
    );
    expect(keys(e, at(2026, 9, 1), at(2026, 12, 1))).toEqual(['2026-09-28', '2026-10-05', '2026-10-07']);
  });

  it('skips months without the day, and 29 February outside leap years', () => {
    const monthly = ev({ allDay: true, start: '2026-01-31', end: '2026-01-31' }, { freq: 'monthly', interval: 1, count: 4 });
    expect(keys(monthly, at(2026, 1, 1), at(2027, 1, 1))).toEqual(['2026-01-31', '2026-03-31', '2026-05-31', '2026-07-31']);
    const yearly = ev({ allDay: true, start: '2028-02-29', end: '2028-02-29' }, { freq: 'yearly', interval: 1 });
    expect(keys(yearly, at(2028, 1, 1), at(2037, 1, 1))).toEqual(['2028-02-29', '2032-02-29', '2036-02-29']);
  });

  it('keeps the wall time across a DST change', () => {
    const e = ev(timed('2026-10-19T09:00', '2026-10-19T10:00'), { freq: 'weekly', interval: 1 });
    const occ = expand(e, { from: at(2026, 10, 18), to: at(2026, 11, 3), zone: 'UTC' });
    expect(occ.map((o) => o.when.start)).toEqual(['2026-10-19T09:00', '2026-10-26T09:00', '2026-11-02T09:00']);
    // In UTC the same meeting moves from 07:00 to 08:00 when Madrid leaves summer time.
    expect(occ.map((o) => new Date(o.start).getUTCHours())).toEqual([7, 8, 8]);
  });

  it('applies exceptions: changed fields, and an occurrence moved into the window', () => {
    const e = ev(timed('2026-09-01T09:00', '2026-09-01T10:00'), { freq: 'daily', interval: 1, count: 10 }, {
      '2026-09-02': { when: timed('2026-09-20T12:00', '2026-09-20T13:00'), title: 'Moved' },
      '2026-09-03': { when: timed('2026-09-03T15:00', '2026-09-03T16:00'), color: EVENT_COLORS[1] as string },
    });
    const occ = expand(e, { from: at(2026, 9, 15, MADRID), to: at(2026, 9, 25, MADRID), zone: MADRID });
    expect(occ.map((o) => [o.key, o.title, o.changed])).toEqual([['2026-09-02', 'Moved', true]]);
    const third = expand(e, { from: at(2026, 9, 3, MADRID), to: at(2026, 9, 4, MADRID), zone: MADRID });
    expect(third.map((o) => [o.key, o.color, o.when.start])).toEqual([['2026-09-03', EVENT_COLORS[1], '2026-09-03T15:00']]);
  });

  it('places all-day events on the same dates in every zone', () => {
    const e = ev({ allDay: true, start: '2026-09-28', end: '2026-09-29' });
    for (const zone of ['Pacific/Auckland', 'America/Havana']) {
      const [o] = expand(e, { from: at(2026, 9, 27, zone), to: at(2026, 10, 1, zone), zone });
      expect(o?.start).toBe(at(2026, 9, 28, zone));
      expect(o?.end).toBe(at(2026, 9, 30, zone));
    }
  });

  it('includes an occurrence that started before the window and still runs', () => {
    const e = ev(timed('2026-09-01T22:00', '2026-09-02T02:00'), { freq: 'daily', interval: 1 });
    expect(keys(e, at(2026, 9, 10, MADRID), at(2026, 9, 11, MADRID))).toEqual(['2026-09-09', '2026-09-10']);
  });

  it('knows which dates are occurrences', () => {
    const e = ev(timed('2026-09-28T09:00', '2026-09-28T09:15'), { freq: 'weekly', interval: 2, byDay: [0, 4] });
    const d = (s: string) => parseDate(s) ?? { y: 0, m: 0, d: 0 };
    expect(isOccurrence(e, d('2026-10-02'))).toBe(true);
    expect(isOccurrence(e, d('2026-10-09'))).toBe(false);
    expect(isOccurrence(e, d('2026-10-12'))).toBe(true);
    expect(isOccurrence(e, d('2026-09-27'))).toBe(false);
  });

  it('expanding window by window equals expanding the whole range (property)', () => {
    const ruleArb = fc.record({
      freq: fc.constantFrom('daily' as const, 'weekly' as const, 'monthly' as const, 'yearly' as const),
      interval: fc.integer({ min: 1, max: 4 }),
      byDay: fc.option(fc.uniqueArray(fc.integer({ min: 0, max: 6 }), { minLength: 1, maxLength: 3 }), { nil: undefined }),
      count: fc.option(fc.integer({ min: 1, max: 40 }), { nil: undefined }),
    });
    fc.assert(
      fc.property(ruleArb, fc.integer({ min: 1, max: 28 }), fc.integer({ min: 1, max: 300 }), (raw, day, cut) => {
        const rule: Rule = { freq: raw.freq, interval: raw.interval };
        if (raw.freq === 'weekly' && raw.byDay) rule.byDay = [...raw.byDay].sort((a, b) => a - b);
        if (raw.count) rule.count = raw.count;
        const e = ev(timed(`2026-01-${String(day).padStart(2, '0')}T09:00`, `2026-01-${String(day).padStart(2, '0')}T10:00`), rule);
        const a = at(2026, 1, 1);
        const c = at(2027, 6, 1);
        const b = a + cut * 86_400_000;
        const whole = keys(e, a, c, 'UTC');
        const split = [...new Set([...keys(e, a, b, 'UTC'), ...keys(e, b, c, 'UTC')])];
        expect(split).toEqual(whole);
      }),
      { numRuns: 200 },
    );
  });
});

describe('expandAll', () => {
  it('caps the result and reports truncation', () => {
    const cal = {
      events: Array.from({ length: 3 }, (_, i) => ({
        ...ev({ allDay: true, start: '2026-01-01', end: '2026-01-01' }, { freq: 'daily', interval: 1 }),
        id: `e${i}`,
      })),
    };
    const res = expandAll(cal, { from: at(2026, 1, 1), to: at(2027, 1, 1), zone: 'UTC' });
    expect(res.occurrences).toHaveLength(1000);
    expect(res.truncated).toBe(true);
    const first = res.occurrences.slice(0, 3).map((o) => o.eventId);
    expect(first).toEqual(['e0', 'e1', 'e2']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @relay/core -- calendar-recurrence`
Expected: FAIL. `expand`, `expandAll` and `isOccurrence` are not exported.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/calendar/recurrence.ts
import {
  type CalendarEvent,
  type CalendarSnapshot,
  type Exception,
  MAX_OCCURRENCES,
  type Rule,
  type When,
} from './model';
import {
  addDays,
  dayNumber,
  daysInMonth,
  formatDate,
  formatWall,
  fromDayNumber,
  isLeap,
  MAX_YEAR,
  parseDate,
  parseWall,
  toInstant,
  toWall,
  type Wall,
  weekday,
  type Ymd,
} from './time';

export interface Window {
  from: number;
  to: number;
  /** The viewer's zone: all-day dates are placed in it. */
  zone: string;
}

export interface Occurrence {
  eventId: string;
  /** The occurrence's original date (its exception key). */
  key: string;
  /** The effective when, after the exception. */
  when: When;
  start: number;
  /** Exclusive. */
  end: number;
  title: string;
  notes: string;
  color: string;
  recurring: boolean;
  /** Changed by an exception. */
  changed: boolean;
}

const EPOCH: Wall = { y: 1970, m: 1, d: 1, hh: 0, mm: 0 };
const dateOf = (s: string): Ymd => parseDate(s) ?? EPOCH;
const wallOf = (s: string): Wall => parseWall(s) ?? EPOCH;
const LAST_DAY = dayNumber({ y: MAX_YEAR, m: 12, d: 31 });

/** The instants a when covers; all-day dates are read in `zone`. */
export function whenRange(w: When, zone: string): { start: number; end: number } {
  if (w.allDay) {
    return {
      start: toInstant({ ...dateOf(w.start), hh: 0, mm: 0 }, zone),
      end: toInstant({ ...addDays(dateOf(w.end), 1), hh: 0, mm: 0 }, zone),
    };
  }
  return { start: toInstant(wallOf(w.start), w.tz), end: toInstant(wallOf(w.end), w.tz) };
}

const startDate = (w: When): Ymd => (w.allDay ? dateOf(w.start) : wallOf(w.start));

/** The series' occurrence on `date` (before exceptions), with the first occurrence's duration. */
export function occurrenceWhen(base: When, date: Ymd): When {
  if (base.allDay) {
    const span = dayNumber(dateOf(base.end)) - dayNumber(dateOf(base.start));
    return { allDay: true, start: formatDate(date), end: formatDate(addDays(date, span)) };
  }
  const s = wallOf(base.start);
  const duration = toInstant(wallOf(base.end), base.tz) - toInstant(s, base.tz);
  const start = toInstant({ ...date, hh: s.hh, mm: s.mm }, base.tz);
  return {
    allDay: false,
    start: formatWall(toWall(start, base.tz)),
    end: formatWall(toWall(start + duration, base.tz)),
    tz: base.tz,
  };
}

/**
 * The rule's dates in order from the series start. Without a count, it jumps close to
 * `fromDay` (it may start earlier, never later); with a count it walks from the start so
 * that the count is right.
 */
function* ruleDates(start: Ymd, rule: Rule, fromDay: number): Generator<Ymd> {
  const s = dayNumber(start);
  const until = Math.min(rule.until ? dayNumber(dateOf(rule.until)) : LAST_DAY, LAST_DAY);
  const jump = rule.count === undefined;
  const i = rule.interval;
  switch (rule.freq) {
    case 'daily': {
      for (let k = jump ? Math.max(0, Math.floor((fromDay - s) / i)) : 0; ; k++) {
        const n = s + k * i;
        if (n > until) return;
        yield fromDayNumber(n);
      }
    }
    case 'weekly': {
      const days = rule.byDay && rule.byDay.length > 0 ? rule.byDay : [weekday(start)];
      const week0 = s - weekday(start);
      for (let w = jump ? Math.max(0, Math.floor((fromDay - week0) / (7 * i))) : 0; ; w++) {
        const monday = week0 + w * 7 * i;
        if (monday > until) return;
        for (const d of days) {
          const n = monday + d;
          if (n < s) continue;
          if (n > until) return;
          yield fromDayNumber(n);
        }
      }
    }
    case 'monthly': {
      const from = fromDayNumber(Math.max(fromDay, s));
      const months = (from.y - start.y) * 12 + (from.m - start.m);
      for (let k = jump ? Math.max(0, Math.floor(months / i)) : 0; ; k++) {
        const index = start.m - 1 + k * i;
        const y = start.y + Math.floor(index / 12);
        const m = (index % 12) + 1;
        if (y > MAX_YEAR || dayNumber({ y, m, d: 1 }) > until) return;
        if (start.d > daysInMonth(y, m)) continue;
        const date = { y, m, d: start.d };
        if (dayNumber(date) > until) return;
        yield date;
      }
    }
    case 'yearly': {
      const fromYear = fromDayNumber(Math.max(fromDay, s)).y;
      for (let k = jump ? Math.max(0, Math.floor((fromYear - start.y) / i)) : 0; ; k++) {
        const y = start.y + k * i;
        if (y > MAX_YEAR || dayNumber({ y, m: 1, d: 1 }) > until) return;
        if (start.m === 2 && start.d === 29 && !isLeap(y)) continue;
        const date = { y, m: start.m, d: start.d };
        if (dayNumber(date) > until) return;
        yield date;
      }
    }
  }
}

/** Whether `date` is one of the series' occurrences (before exceptions). */
export function isOccurrence(ev: CalendarEvent, date: Ymd): boolean {
  const n = dayNumber(date);
  const s = startDate(ev.when);
  if (!ev.rule) return n === dayNumber(s);
  let index = 0;
  for (const d of ruleDates(s, ev.rule, n)) {
    if (ev.rule.count !== undefined && index++ >= ev.rule.count) return false;
    const m = dayNumber(d);
    if (m === n) return true;
    if (m > n) return false;
  }
  return false;
}

const overlaps = (r: { start: number; end: number }, win: Window): boolean =>
  r.start < win.to && (r.end > win.from || (r.end === r.start && r.start >= win.from));

function occurrence(
  ev: CalendarEvent,
  key: string,
  date: Ymd,
  ex: Exception | undefined,
  win: Window,
): Occurrence | null {
  if (ex && 'cancelled' in ex) return null;
  const when = ex?.when ?? occurrenceWhen(ev.when, date);
  const r = whenRange(when, win.zone);
  if (!overlaps(r, win)) return null;
  return {
    eventId: ev.id,
    key,
    when,
    start: r.start,
    end: r.end,
    title: ex?.title ?? ev.title,
    notes: ex?.notes ?? ev.notes,
    color: ex?.color ?? ev.color,
    recurring: ev.rule !== undefined,
    changed: ex !== undefined,
  };
}

const byStart = (a: Occurrence, b: Occurrence): number =>
  a.start - b.start ||
  (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0) ||
  (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** The event's occurrences overlapping the window, sorted by start (at most `limit`). */
export function expand(ev: CalendarEvent, win: Window, limit = MAX_OCCURRENCES): Occurrence[] {
  const start = startDate(ev.when);
  if (!ev.rule) {
    const o = occurrence(ev, formatDate(start), start, undefined, win);
    return o ? [o] : [];
  }
  const first = whenRange(ev.when, win.zone);
  const span = Math.max(0, first.end - first.start);
  const frame = ev.when.allDay ? win.zone : ev.when.tz;
  const fromDay = dayNumber(toWall(win.from - span, frame)) - 1;
  const toDay = dayNumber(toWall(win.to, frame)) + 1;
  const out: Occurrence[] = [];
  const handled = new Set<string>();
  let index = 0;
  for (const date of ruleDates(start, ev.rule, fromDay)) {
    if (ev.rule.count !== undefined && index >= ev.rule.count) break;
    index++;
    const n = dayNumber(date);
    if (n > toDay || out.length >= limit) break;
    if (n < fromDay) continue;
    const key = formatDate(date);
    handled.add(key);
    const o = occurrence(ev, key, date, ev.exceptions[key], win);
    if (o) out.push(o);
  }
  // An exception can move its occurrence into the window from a date outside it.
  for (const [key, ex] of Object.entries(ev.exceptions)) {
    if (handled.has(key) || 'cancelled' in ex) continue;
    const date = parseDate(key);
    if (!date || !isOccurrence(ev, date)) continue;
    const o = occurrence(ev, key, date, ex, win);
    if (o) out.push(o);
  }
  return out.sort(byStart).slice(0, limit);
}

/** Every event's occurrences in the window, at most MAX_OCCURRENCES, sorted by start. */
export function expandAll(
  cal: CalendarSnapshot,
  win: Window,
): { occurrences: Occurrence[]; truncated: boolean } {
  const all = cal.events.flatMap((ev) => expand(ev, win, MAX_OCCURRENCES + 1)).sort(byStart);
  return { occurrences: all.slice(0, MAX_OCCURRENCES), truncated: all.length > MAX_OCCURRENCES };
}
```

Add `export * from './calendar/recurrence';` to `packages/core/src/index.ts`, alphabetically between `model` and `time`.

Notes for the implementer:
- **Biome and generators.** Biome may flag `for (;;)` or a generator `switch` whose cases never fall through. Keep the logic and satisfy the rule; for example, add `return;` after each loop if it asks for one.
- **The `continue` in `expand`.** `continue` for `n < fromDay` only happens with a `count`, because a count walks from the start. Those dates are not added to `handled`, so the exceptions loop still finds a moved occurrence among them.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @relay/core -- calendar-recurrence`
Expected: PASS (11 tests).

If the DST test's UTC hours differ, check the dates first. Madrid leaves summer time on 2026-10-25, so 09:00 is 07:00 UTC on 19 October and 08:00 UTC after the change.

- [ ] **Step 5: Run the core suite, typecheck and lint, then commit**

Run: `npm test -w @relay/core && npm run typecheck && npm run lint`

```bash
git add packages/core/src/calendar/recurrence.ts packages/core/src/index.ts packages/core/test/calendar-recurrence.test.ts
git commit -m "feat(core): recurrence expansion with exceptions, DST-stable wall times and window skipping"
```

---
### Task 5: Core `.ics` writer and parser

**Files:**
- Create: `packages/core/src/calendar/ics.ts`
- Modify: `packages/core/src/index.ts` (add `export * from './calendar/ics';`)
- Test: `packages/core/test/calendar-ics.test.ts`

**Interfaces:**
- Consumes:
  - Task 1: `parseDate`, `parseWall`, `formatDate`, `formatWall`, `addDays`, `dayNumber`, `wallMinutes`, `fromWallMinutes`, `isValidZone`, `toInstant`, `toWall`.
  - Task 2: `CalendarSnapshot`, `EventFields`, `Exception`, `Rule`, `When`, `readWhen`, `EVENT_COLORS`, `FREQS`, `MAX_EVENT_TITLE`, `MAX_EVENT_NOTES`, `MAX_UID`, `MAX_EXCEPTIONS`.
- Produces:
  - `MAX_ICS_BYTES = 1024 * 1024`
  - `writeIcs(cal: CalendarSnapshot, opts: { name: string; now: number }): string`, with CRLF line endings and lines folded at 75 octets.
  - `interface IcsEvent { uid: string; fields: Omit<EventFields, 'createdBy' | 'createdAt'>; exceptions: Record<string, Exception> }`
  - `interface IcsWarning { line: number; message: string }`
  - `parseIcs(text: string, opts: { zone: string }): { events: IcsEvent[]; warnings: IcsWarning[] }`
- Exact warning messages; later tasks show them to the user:
  - `Event without a valid start; skipped`
  - `Repeat rule not supported; only the first date was imported`
  - `A changed occurrence has no series; skipped`
  - `Duplicate event "<uid, up to 40 chars>"; skipped`
  - `Unknown time zone "<tzid, up to 40 chars>"; read as UTC`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/test/calendar-ics.test.ts
import { describe, expect, it } from 'vitest';
import { type CalendarEvent, type CalendarSnapshot, EVENT_COLORS, parseIcs, writeIcs } from '../src';

const base = (over: Partial<CalendarEvent>): CalendarEvent => ({
  id: 'e1',
  title: 'Standup',
  notes: '',
  color: EVENT_COLORS[0] as string,
  when: { allDay: false, start: '2026-09-28T09:00', end: '2026-09-28T09:15', tz: 'Europe/Madrid' },
  exceptions: {},
  rsvp: {},
  createdBy: 'u1',
  createdAt: 0,
  ...over,
});

const NOW = Date.UTC(2026, 8, 28, 12, 0, 0);

describe('writeIcs', () => {
  it('writes a calendar with zoned, all-day and repeating events', () => {
    const cal: CalendarSnapshot = {
      events: [
        base({
          notes: 'Line 1\nsemi; comma, back\\slash',
          rule: { freq: 'weekly', interval: 2, byDay: [0, 2], until: '2026-12-31' },
          exceptions: {
            '2026-09-30': { cancelled: true },
            '2026-10-12': { when: { allDay: false, start: '2026-10-12T10:00', end: '2026-10-12T10:15', tz: 'Europe/Madrid' }, title: 'Late' },
          },
        }),
        base({ id: 'e2', title: 'Trip', uid: 'trip@example.com', when: { allDay: true, start: '2026-10-01', end: '2026-10-03' } }),
      ],
    };
    const text = writeIcs(cal, { name: 'Team', now: NOW });
    expect(text.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Relay//Calendar//EN\r\n')).toBe(true);
    expect(text.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(text).toContain('UID:e1@relay\r\n');
    expect(text).toContain('DTSTAMP:20260928T120000Z\r\n');
    expect(text).toContain('DTSTART;TZID=Europe/Madrid:20260928T090000\r\n');
    expect(text).toContain('DTEND;TZID=Europe/Madrid:20260928T091500\r\n');
    expect(text).toContain('RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;UNTIL=20261231T225900Z\r\n');
    expect(text).toContain('EXDATE;TZID=Europe/Madrid:20260930T090000\r\n');
    expect(text).toContain('RECURRENCE-ID;TZID=Europe/Madrid:20261012T090000\r\n');
    expect(text).toContain('SUMMARY:Late\r\n');
    expect(text).toContain('DESCRIPTION:Line 1\\nsemi\\; comma\\, back\\\\slash\r\n');
    expect(text).toContain('UID:trip@example.com\r\n');
    expect(text).toContain('DTSTART;VALUE=DATE:20261001\r\n');
    expect(text).toContain('DTEND;VALUE=DATE:20261004\r\n');
  });

  it('folds long lines at 75 octets without splitting characters', () => {
    const text = writeIcs({ events: [base({ title: 'é'.repeat(100) })] }, { name: 'x', now: NOW });
    for (const line of text.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    const summary = parseIcs(text, { zone: 'UTC' }).events[0]?.fields.title;
    expect(summary).toBe('é'.repeat(100));
  });
});

describe('parseIcs', () => {
  it('round-trips what writeIcs writes', () => {
    const e = base({
      notes: 'a, b; c\nd',
      rule: { freq: 'monthly', interval: 1, count: 6 },
      exceptions: {
        '2026-10-28': { cancelled: true },
        '2026-11-28': { when: { allDay: false, start: '2026-11-29T11:00', end: '2026-11-29T11:30', tz: 'Europe/Madrid' }, title: 'Moved' },
      },
    });
    const { events, warnings } = parseIcs(writeIcs({ events: [e] }, { name: 'x', now: NOW }), { zone: 'America/Havana' });
    expect(warnings).toEqual([]);
    expect(events).toHaveLength(1);
    expect(events[0]).toEqual({
      uid: 'e1@relay',
      fields: { title: 'Standup', notes: 'a, b; c\nd', color: EVENT_COLORS[0], when: e.when, rule: e.rule },
      exceptions: e.exceptions,
    });
  });

  it('reads UTC and floating times in the importer zone, durations and missing ends', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:a',
      'DTSTART:20260928T070000Z',
      'DURATION:PT1H30M',
      'SUMMARY:UTC',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:b',
      'DTSTART:20260928T090000',
      'SUMMARY:Floating',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:c',
      'DTSTART;VALUE=DATE:20261001',
      'DTEND;VALUE=DATE:20261001',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\n');
    const { events } = parseIcs(ics, { zone: 'Europe/Madrid' });
    expect(events.map((e) => e.fields.when)).toEqual([
      { allDay: false, start: '2026-09-28T09:00', end: '2026-09-28T10:30', tz: 'Europe/Madrid' },
      { allDay: false, start: '2026-09-28T09:00', end: '2026-09-28T10:00', tz: 'Europe/Madrid' },
      { allDay: true, start: '2026-10-01', end: '2026-10-01' },
    ]);
    expect(events[2]?.fields.title).toBe('Untitled');
  });

  it('warns about what it cannot represent, and skips duplicates and orphans', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:r',
      'DTSTART;TZID=Romance Standard Time:20260928T090000',
      'RRULE:FREQ=MONTHLY;BYSETPOS=-1;BYDAY=FR',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:r',
      'DTSTART:20260929T090000Z',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:nobody',
      'RECURRENCE-ID:20261001T090000Z',
      'DTSTART:20261001T100000Z',
      'END:VEVENT',
      'BEGIN:VEVENT',
      'UID:nostart',
      'SUMMARY:No start',
      'END:VEVENT',
      'BEGIN:VTODO',
      'UID:todo',
      'END:VTODO',
      'END:VCALENDAR',
    ].join('\r\n');
    const { events, warnings } = parseIcs(ics, { zone: 'UTC' });
    expect(events.map((e) => [e.uid, e.fields.when.allDay ? '' : e.fields.when.tz, e.fields.rule ?? null])).toEqual([
      ['r', 'UTC', null],
    ]);
    expect(warnings).toEqual([
      { line: 4, message: 'Unknown time zone "Romance Standard Time"; read as UTC' },
      { line: 2, message: 'Repeat rule not supported; only the first date was imported' },
      { line: 7, message: 'Duplicate event "r"; skipped' },
      { line: 16, message: 'Event without a valid start; skipped' },
      { line: 11, message: 'A changed occurrence has no series; skipped' },
    ]);
  });

  it('unfolds lines and unescapes text, and ignores alarms inside events', () => {
    const ics = [
      'BEGIN:VCALENDAR',
      'BEGIN:VEVENT',
      'UID:x',
      'DTSTART;VALUE=DATE:20261005',
      'SUMMARY:Long ti',
      ' tle\\, folded',
      'BEGIN:VALARM',
      'DESCRIPTION:Not the event',
      'END:VALARM',
      'END:VEVENT',
      'END:VCALENDAR',
    ].join('\r\n');
    const [e] = parseIcs(ics, { zone: 'UTC' }).events;
    expect(e?.fields.title).toBe('Long title, folded');
    expect(e?.fields.notes).toBe('');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @relay/core -- calendar-ics`
Expected: FAIL. `writeIcs` and `parseIcs` are not exported.

- [ ] **Step 3: Write the implementation**

```ts
// packages/core/src/calendar/ics.ts
import {
  type CalendarEvent,
  type CalendarSnapshot,
  EVENT_COLORS,
  type EventFields,
  type Exception,
  FREQS,
  MAX_EVENT_NOTES,
  MAX_EVENT_TITLE,
  MAX_EXCEPTIONS,
  MAX_UID,
  type Rule,
  readWhen,
  type When,
} from './model';
import {
  addDays,
  dayNumber,
  formatDate,
  formatWall,
  fromWallMinutes,
  isValidZone,
  parseDate,
  parseWall,
  toInstant,
  toWall,
  type Wall,
  wallMinutes,
  type Ymd,
} from './time';

export const MAX_ICS_BYTES = 1024 * 1024;
const DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

export interface IcsEvent {
  uid: string;
  fields: Omit<EventFields, 'createdBy' | 'createdAt'>;
  exceptions: Record<string, Exception>;
}

export interface IcsWarning {
  line: number;
  message: string;
}

// ---------- writing ----------

const escapeText = (s: string): string =>
  s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

const encoder = new TextEncoder();

/** Folds a content line into lines of at most 75 octets, never splitting a character. */
function fold(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let bytes = 0;
  for (const ch of line) {
    const size = encoder.encode(ch).length;
    const max = out.length === 0 ? 75 : 74;
    if (bytes + size > max) {
      out.push(cur);
      cur = '';
      bytes = 0;
    }
    cur += ch;
    bytes += size;
  }
  out.push(cur);
  return out.map((l, i) => (i === 0 ? l : ` ${l}`));
}

const compactDate = (date: string): string => date.replace(/-/g, '');
const compactWall = (wall: string): string => `${wall.replace(/[-:]/g, '')}00`;
function utcStamp(ms: number): string {
  return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

function dtLines(w: When): string[] {
  if (w.allDay) {
    const end = addDays(parseDate(w.end) ?? { y: 1970, m: 1, d: 1 }, 1);
    return [`DTSTART;VALUE=DATE:${compactDate(w.start)}`, `DTEND;VALUE=DATE:${compactDate(formatDate(end))}`];
  }
  return [`DTSTART;TZID=${w.tz}:${compactWall(w.start)}`, `DTEND;TZID=${w.tz}:${compactWall(w.end)}`];
}

/** The occurrence on `key` as an EXDATE / RECURRENCE-ID value (with its parameters). */
function occurrenceRef(base: When, key: string): string {
  if (base.allDay) return `;VALUE=DATE:${compactDate(key)}`;
  return `;TZID=${base.tz}:${compactDate(key)}T${base.start.slice(11).replace(':', '')}00`;
}

function rruleText(rule: Rule, base: When): string {
  const parts = [`FREQ=${rule.freq.toUpperCase()}`];
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.freq === 'weekly' && rule.byDay) parts.push(`BYDAY=${rule.byDay.map((d) => DAYS[d]).join(',')}`);
  if (rule.count !== undefined) parts.push(`COUNT=${rule.count}`);
  else if (rule.until) {
    if (base.allDay) parts.push(`UNTIL=${compactDate(rule.until)}`);
    else {
      const last = parseDate(rule.until) ?? { y: 1970, m: 1, d: 1 };
      parts.push(`UNTIL=${utcStamp(toInstant({ ...last, hh: 23, mm: 59 }, base.tz))}`);
    }
  }
  return parts.join(';');
}

function eventLines(ev: CalendarEvent, stamp: string): string[] {
  const uid = escapeText(ev.uid ?? `${ev.id}@relay`);
  const lines = ['BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${stamp}`, ...dtLines(ev.when), `SUMMARY:${escapeText(ev.title)}`];
  if (ev.notes) lines.push(`DESCRIPTION:${escapeText(ev.notes)}`);
  if (ev.rule) {
    lines.push(`RRULE:${rruleText(ev.rule, ev.when)}`);
    for (const [key, ex] of Object.entries(ev.exceptions)) {
      if ('cancelled' in ex) lines.push(`EXDATE${occurrenceRef(ev.when, key)}`);
    }
  }
  lines.push('END:VEVENT');
  if (!ev.rule) return lines;
  for (const [key, ex] of Object.entries(ev.exceptions)) {
    if ('cancelled' in ex) continue;
    lines.push('BEGIN:VEVENT', `UID:${uid}`, `DTSTAMP:${stamp}`, `RECURRENCE-ID${occurrenceRef(ev.when, key)}`);
    lines.push(...dtLines(ex.when), `SUMMARY:${escapeText(ex.title ?? ev.title)}`);
    const notes = ex.notes ?? ev.notes;
    if (notes) lines.push(`DESCRIPTION:${escapeText(notes)}`);
    lines.push('END:VEVENT');
  }
  return lines;
}

/** An RFC 5545 calendar: IANA TZIDs without VTIMEZONE blocks, CRLF, folded at 75 octets. */
export function writeIcs(cal: CalendarSnapshot, opts: { name: string; now: number }): string {
  const stamp = utcStamp(opts.now);
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Relay//Calendar//EN',
    'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${escapeText(opts.name)}`,
    ...cal.events.flatMap((ev) => eventLines(ev, stamp)),
    'END:VCALENDAR',
  ];
  return `${lines.flatMap(fold).join('\r\n')}\r\n`;
}

// ---------- reading ----------

interface Prop {
  name: string;
  params: Record<string, string>;
  value: string;
  line: number;
}

function splitOutside(s: string, sep: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (const ch of s) {
    if (ch === '"') quoted = !quoted;
    if (ch === sep && !quoted) {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseLine(raw: string, line: number): Prop | null {
  let quoted = false;
  let colon = -1;
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '"') quoted = !quoted;
    else if (raw[i] === ':' && !quoted) {
      colon = i;
      break;
    }
  }
  if (colon <= 0) return null;
  const [name = '', ...rest] = splitOutside(raw.slice(0, colon), ';');
  const params: Record<string, string> = {};
  for (const p of rest) {
    const eq = p.indexOf('=');
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, '');
  }
  return { name: name.toUpperCase(), params, value: raw.slice(colon + 1), line };
}

/** Content lines with folded continuations joined; `line` is the first physical line (1-based). */
function contentLines(text: string): Prop[] {
  const physical = text.split(/\r\n|\n|\r/);
  const logical: { raw: string; line: number }[] = [];
  physical.forEach((l, i) => {
    const last = logical.at(-1);
    if ((l.startsWith(' ') || l.startsWith('\t')) && last) last.raw += l.slice(1);
    else if (l.length > 0) logical.push({ raw: l, line: i + 1 });
  });
  return logical.flatMap(({ raw, line }) => parseLine(raw, line) ?? []);
}

const unescapeText = (s: string): string =>
  s.replace(/\\([\\;,nN])/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));

type IcsTime = { kind: 'date'; date: Ymd } | { kind: 'time'; wall: Wall; tz: string };

function readTime(value: string, params: Record<string, string>, zone: string, warn: (m: string) => void): IcsTime | null {
  const v = value.trim();
  const d = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
  if (d) {
    const date = parseDate(`${d[1]}-${d[2]}-${d[3]}`);
    return date ? { kind: 'date', date } : null;
  }
  if (params.VALUE === 'DATE') return null;
  const t = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(v);
  if (!t) return null;
  const wall = parseWall(`${t[1]}-${t[2]}-${t[3]}T${t[4]}:${t[5]}`);
  if (!wall) return null;
  if (t[7] === 'Z') {
    return { kind: 'time', wall: toWall(Date.UTC(wall.y, wall.m - 1, wall.d, wall.hh, wall.mm), zone), tz: zone };
  }
  const tzid = params.TZID;
  if (tzid === undefined) return { kind: 'time', wall, tz: zone };
  if (isValidZone(tzid)) return { kind: 'time', wall, tz: tzid };
  warn(`Unknown time zone "${tzid.slice(0, 40)}"; read as UTC`);
  return { kind: 'time', wall, tz: 'UTC' };
}

/** The date of a time in `tz` (the zone an exception key is written in). */
function dateIn(t: IcsTime, tz: string | null): string {
  if (t.kind === 'date') return formatDate(t.date);
  if (tz === null || tz === t.tz) return formatDate(t.wall);
  return formatDate(toWall(toInstant(t.wall, t.tz), tz));
}

function durationMinutes(v: string): number | null {
  const r = /^\+?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(v.trim());
  if (!r) return null;
  const [w, d, h, m] = [r[1], r[2], r[3], r[4]].map((x) => Number(x ?? 0)) as [number, number, number, number];
  return ((w * 7 + d) * 24 + h) * 60 + m;
}

const KNOWN_RULE_PARTS = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'UNTIL', 'COUNT', 'WKST']);

function readRrule(value: string, start: IcsTime, zone: string): Rule | null {
  const parts = new Map<string, string>();
  for (const p of value.split(';')) {
    const eq = p.indexOf('=');
    if (eq <= 0) return null;
    parts.set(p.slice(0, eq).toUpperCase(), p.slice(eq + 1).toUpperCase());
  }
  if ([...parts.keys()].some((k) => !KNOWN_RULE_PARTS.has(k))) return null;
  const freq = FREQS.find((f) => f.toUpperCase() === parts.get('FREQ'));
  if (!freq) return null;
  const interval = parts.has('INTERVAL') ? Number(parts.get('INTERVAL')) : 1;
  if (!Number.isInteger(interval) || interval < 1 || interval > 99) return null;
  const rule: Rule = { freq, interval };
  const byDay = parts.get('BYDAY');
  if (byDay !== undefined) {
    if (freq !== 'weekly') return null;
    const days = byDay.split(',').map((d) => DAYS.indexOf(d));
    if (days.some((d) => d < 0)) return null;
    rule.byDay = [...new Set(days)].sort((a, b) => a - b);
  }
  const count = parts.get('COUNT');
  if (count !== undefined) {
    const n = Number(count);
    if (!Number.isInteger(n) || n < 1 || n > 999) return null;
    rule.count = n;
  }
  const until = parts.get('UNTIL');
  if (until !== undefined) {
    const t = readTime(until, {}, 'UTC', () => {});
    if (!t) return null;
    // A UTC UNTIL names an instant: its date is the one in the event's own zone.
    rule.until = t.kind === 'date' ? formatDate(t.date) : dateIn(t, start.kind === 'time' ? start.tz : zone);
  }
  return rule;
}

interface RawEvent {
  line: number;
  props: Prop[];
}

function components(lines: Prop[]): RawEvent[] {
  const out: RawEvent[] = [];
  let current: RawEvent | null = null;
  let nested = 0;
  for (const p of lines) {
    if (p.name === 'BEGIN' && p.value.toUpperCase() === 'VEVENT' && current === null) {
      current = { line: p.line, props: [] };
    } else if (current && p.name === 'BEGIN') nested++;
    else if (current && p.name === 'END' && nested > 0) nested--;
    else if (current && p.name === 'END' && p.value.toUpperCase() === 'VEVENT') {
      out.push(current);
      current = null;
    } else if (current && nested === 0) current.props.push(p);
  }
  return out;
}

function whenOf(props: Prop[], zone: string, warn: (line: number, m: string) => void): When | null {
  const get = (n: string) => props.find((p) => p.name === n);
  const ds = get('DTSTART');
  if (!ds) return null;
  const start = readTime(ds.value, ds.params, zone, (m) => warn(ds.line, m));
  if (!start) return null;
  const de = get('DTEND');
  const end = de ? readTime(de.value, de.params, zone, (m) => warn(de.line, m)) : null;
  const dur = get('DURATION');
  const minutes = dur ? durationMinutes(dur.value) : null;
  if (start.kind === 'date') {
    let last = start.date;
    if (end?.kind === 'date') last = addDays(end.date, -1);
    else if (minutes !== null) last = addDays(start.date, Math.max(1, Math.ceil(minutes / 1440)) - 1);
    if (dayNumber(last) < dayNumber(start.date)) last = start.date;
    return readWhen({ allDay: true, start: formatDate(start.date), end: formatDate(last) });
  }
  let endWall = fromWallMinutes(wallMinutes(start.wall) + 60);
  if (end?.kind === 'time') endWall = end.tz === start.tz ? end.wall : toWall(toInstant(end.wall, end.tz), start.tz);
  else if (minutes !== null) endWall = fromWallMinutes(wallMinutes(start.wall) + minutes);
  return readWhen({ allDay: false, start: formatWall(start.wall), end: formatWall(endWall), tz: start.tz });
}

/** Reads the subset of `.ics` Relay can represent; everything else becomes a warning. */
export function parseIcs(text: string, opts: { zone: string }): { events: IcsEvent[]; warnings: IcsWarning[] } {
  const warnings: IcsWarning[] = [];
  const warn = (line: number, message: string) => warnings.push({ line, message });
  const events: IcsEvent[] = [];
  const byUid = new Map<string, IcsEvent>();
  const overrides: { uid: string; raw: RawEvent }[] = [];
  for (const raw of components(contentLines(text))) {
    const get = (n: string) => raw.props.find((p) => p.name === n);
    const uid = unescapeText(get('UID')?.value ?? `import-${raw.line}`).slice(0, MAX_UID);
    if (get('RECURRENCE-ID')) {
      overrides.push({ uid, raw });
      continue;
    }
    if (byUid.has(uid)) {
      warn(raw.line, `Duplicate event "${uid.slice(0, 40)}"; skipped`);
      continue;
    }
    const when = whenOf(raw.props, opts.zone, warn);
    if (!when) {
      warn(raw.line, 'Event without a valid start; skipped');
      continue;
    }
    const summary = unescapeText(get('SUMMARY')?.value ?? '').trim().slice(0, MAX_EVENT_TITLE);
    const fields: IcsEvent['fields'] = {
      title: summary || 'Untitled',
      notes: unescapeText(get('DESCRIPTION')?.value ?? '').slice(0, MAX_EVENT_NOTES),
      color: EVENT_COLORS[0] as string,
      when,
    };
    const rr = get('RRULE');
    const tzOfEvent = when.allDay ? null : when.tz;
    if (rr) {
      const start: IcsTime = when.allDay
        ? { kind: 'date', date: parseDate(when.start) ?? { y: 1970, m: 1, d: 1 } }
        : { kind: 'time', wall: parseWall(when.start) ?? { y: 1970, m: 1, d: 1, hh: 0, mm: 0 }, tz: when.tz };
      const rule = readRrule(rr.value, start, opts.zone);
      if (rule) fields.rule = rule;
      else warn(raw.line, 'Repeat rule not supported; only the first date was imported');
    }
    const ev: IcsEvent = { uid, fields, exceptions: {} };
    if (fields.rule) {
      for (const p of raw.props.filter((x) => x.name === 'EXDATE')) {
        for (const v of p.value.split(',')) {
          const t = readTime(v, p.params, opts.zone, (m) => warn(p.line, m));
          if (t && Object.keys(ev.exceptions).length < MAX_EXCEPTIONS) ev.exceptions[dateIn(t, tzOfEvent)] = { cancelled: true };
        }
      }
    }
    byUid.set(uid, ev);
    events.push(ev);
  }
  for (const { uid, raw } of overrides) {
    const master = byUid.get(uid);
    const rid = raw.props.find((p) => p.name === 'RECURRENCE-ID');
    if (!master?.fields.rule || !rid) {
      warn(raw.line, 'A changed occurrence has no series; skipped');
      continue;
    }
    const t = readTime(rid.value, rid.params, opts.zone, (m) => warn(rid.line, m));
    const when = whenOf(raw.props, opts.zone, warn);
    if (!t || !when) {
      warn(raw.line, 'Event without a valid start; skipped');
      continue;
    }
    const key = dateIn(t, master.fields.when.allDay ? null : master.fields.when.tz);
    const ex: Exception = { when };
    const summary = unescapeText(raw.props.find((p) => p.name === 'SUMMARY')?.value ?? '').trim();
    if (summary && summary !== master.fields.title) ex.title = summary.slice(0, MAX_EVENT_TITLE);
    const desc = raw.props.find((p) => p.name === 'DESCRIPTION');
    if (desc) {
      const notes = unescapeText(desc.value).slice(0, MAX_EVENT_NOTES);
      if (notes !== master.fields.notes) ex.notes = notes;
    }
    if (Object.keys(master.exceptions).length < MAX_EXCEPTIONS || key in master.exceptions) master.exceptions[key] = ex;
  }
  return { events, warnings };
}
```

Add `export * from './calendar/ics';` to `packages/core/src/index.ts`, after `budget`.

Notes for the implementer:
- **Round-trip `notes`.** The round-trip test expects `fields.notes` to be present, even when it is `''`, as in the unfold test. It also expects `rule` to be absent when there is none. Keep `fields` built exactly as above so `toEqual` holds, and never set `rule: undefined`.
- **Warning order.** The expected warning order follows the parse order:
  1. zone warnings raised while reading `DTSTART`;
  2. rule warnings;
  3. duplicates;
  4. missing starts;
  5. orphan overrides, which are handled after all masters.

  If the implementation reorders them, fix the implementation, not the test. The line numbers in the test are the physical lines of the joined array (1-based).
- **Test fixes allowed.** If `toEqual` on the round trip fails only because an exception's optional `notes` is `''` versus absent, fix the parser: write `notes` only when it differs from the master's. Do not loosen the test.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @relay/core -- calendar-ics`
Expected: PASS (6 tests).

- [ ] **Step 5: Run the core suite, typecheck and lint, then commit**

Run: `npm test -w @relay/core && npm run typecheck && npm run lint`

```bash
git add packages/core/src/calendar/ics.ts packages/core/src/index.ts packages/core/test/calendar-ics.test.ts
git commit -m "feat(core): .ics export and a bounded, warning-reporting .ics import"
```

---
### Task 6: Web calendar store, presence field and pure layout

**Files:**
- Create:
  - `apps/web/src/store/calendarStore.ts`
  - `apps/web/src/calendar/layout.ts`
- Modify:
  - `apps/web/src/board/session.ts` (create and destroy the store; expose it as `session.calendar`)
  - `packages/core/src/presence/state.ts` (`calEvent`)
  - `apps/web/src/sync/presence.ts` (`setCalEvent`)
- Test:
  - `apps/web/test/calendarStore.test.ts`
  - `apps/web/test/calendarLayout.test.ts`
  - Extend `packages/core/test/presence.test.ts`.

**Interfaces:**
- Consumes (core): `readCalendar`, `CalendarSnapshot`, `getRoots`, `Occurrence`, `toInstant`, `toWall`, `parseDate`, `formatDate`, `addDays`, `dayNumber`, `weekday`, `wallMinutes`.
- Produces (store and presence):
  - `CalendarState { pageId: string | null; calendar: CalendarSnapshot | null }`
  - `createCalendarStore(doc, docStore): { store: StoreApi<CalendarState>; destroy(): void }`
  - `BoardSession.calendar: StoreApi<CalendarState>`
  - `PresenceState.calEvent?: string | null` (1–64 characters)
  - `PresencePublisher.setCalEvent(id: string | null): void`
- Produces from `layout.ts`:
  - Constants: `HOUR_PX = 48`, `SNAP_MIN = 15`, `MONTH_LINES = 3`.
  - Grid and dates:
    - `monthGrid(y, m, today): MonthCell[]`, where `MonthCell` is `{ date, day, inMonth, today }`; always 42 cells.
    - `weekDates(anchor: string): string[]`, Monday to Sunday.
    - `firstOfGrid(y, m): string`
  - Windows: `viewWindow(view: 'month' | 'week', anchor: string, zone: string): { from: number; to: number; zone: string }`
  - Occurrence spans: `occurrenceDays(o: Occurrence, zone: string): { first: number; last: number }` (day numbers in `zone`).
  - `monthLayout(occs, firstDate, zone): MonthLayout`, where:
    - `MonthLayout` is `{ bars: MonthBar[]; rowLanes: number[]; days: { chips: Occurrence[]; more: number }[] }`;
    - `MonthBar` is `{ occ, row, startCol, endCol, lane }`.
  - `weekLayout(occs, days, zone): WeekLayout`, where:
    - `WeekLayout` is `{ allDay: { occ, startCol, endCol, lane }[]; allDayLanes: number; boxes: WeekBox[] }`;
    - `WeekBox` is `{ occ, day, top, height, col, cols }`, with `top` and `height` in minutes.

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/test/calendarLayout.test.ts
import { type Occurrence, toInstant } from '@relay/core';
import { describe, expect, it } from 'vitest';
import { monthGrid, monthLayout, viewWindow, weekDates, weekLayout } from '../src/calendar/layout';

const Z = 'Europe/Madrid';
let n = 0;
function occ(when: Occurrence['when'], start: number, end: number): Occurrence {
  n++;
  return { eventId: `e${n}`, key: `k${n}`, when, start, end, title: `T${n}`, notes: '', color: '#3B3BF5', recurring: false, changed: false };
}
const allDay = (s: string, e: string) => {
  const [sy, sm, sd] = s.split('-').map(Number) as [number, number, number];
  const [ey, em, ed] = e.split('-').map(Number) as [number, number, number];
  return occ({ allDay: true, start: s, end: e }, toInstant({ y: sy, m: sm, d: sd, hh: 0, mm: 0 }, Z), toInstant({ y: ey, m: em, d: ed + 1, hh: 0, mm: 0 }, Z));
};
const timed = (d: number, h1: number, m1: number, h2: number, m2: number, d2 = d) =>
  occ(
    { allDay: false, start: '', end: '', tz: Z },
    toInstant({ y: 2026, m: 9, d, hh: h1, mm: m1 }, Z),
    toInstant({ y: 2026, m: 9, d: d2, hh: h2, mm: m2 }, Z),
  );

describe('grids and windows', () => {
  it('builds a 6-week month grid starting on the Monday on or before the 1st', () => {
    const cells = monthGrid(2026, 9, '2026-09-28');
    expect(cells).toHaveLength(42);
    expect(cells[0]).toEqual({ date: '2026-08-31', day: 31, inMonth: false, today: false });
    expect(cells[1]?.inMonth).toBe(true);
    expect(cells.find((c) => c.today)?.date).toBe('2026-09-28');
    expect(monthGrid(2026, 6, '2026-01-01')[0]?.date).toBe('2026-06-01');
  });

  it('lists a week from Monday and computes view windows in the viewer zone', () => {
    expect(weekDates('2026-10-01')).toEqual([
      '2026-09-28', '2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04',
    ]);
    const w = viewWindow('week', '2026-10-01', Z);
    expect(w.from).toBe(toInstant({ y: 2026, m: 9, d: 28, hh: 0, mm: 0 }, Z));
    expect(w.to).toBe(toInstant({ y: 2026, m: 10, d: 5, hh: 0, mm: 0 }, Z));
    const m = viewWindow('month', '2026-09-15', Z);
    expect(m.from).toBe(toInstant({ y: 2026, m: 8, d: 31, hh: 0, mm: 0 }, Z));
    expect(m.to).toBe(toInstant({ y: 2026, m: 10, d: 12, hh: 0, mm: 0 }, Z));
  });
});

describe('month layout', () => {
  it('splits bars at week rows, packs lanes, and counts what does not fit', () => {
    const long = allDay('2026-09-04', '2026-09-08'); // Fri..Tue: crosses a row boundary
    const a = allDay('2026-09-07', '2026-09-07');
    const b = allDay('2026-09-07', '2026-09-07');
    const c = allDay('2026-09-07', '2026-09-07');
    const chip = timed(7, 9, 0, 10, 0);
    const late = timed(15, 23, 0, 1, 0, 16); // crosses midnight: a chip on both days (row 2 has no bars)
    const layout = monthLayout([long, a, b, c, chip, late], '2026-08-31', Z);
    const longBars = layout.bars.filter((x) => x.occ === long);
    expect(longBars.map((x) => [x.row, x.startCol, x.endCol])).toEqual([[0, 4, 6], [1, 0, 1]]);
    // Row 1 has 4 bar lanes (long, a, b, c); 3 fit, so the 7th has one bar and the chip hidden.
    expect(layout.rowLanes[1]).toBe(4);
    const sept7 = layout.days[7];
    expect(sept7?.chips).toEqual([]);
    expect(sept7?.more).toBe(2);
    expect(layout.days[15]?.chips).toEqual([late]);
    expect(layout.days[16]?.chips).toEqual([late]);
  });
});

describe('week layout', () => {
  it('places boxes by wall time, splits at midnight and shares columns among overlaps', () => {
    const days = weekDates('2026-09-28');
    const x = timed(28, 9, 0, 10, 0);
    const y = timed(28, 9, 30, 11, 0);
    const z = timed(28, 10, 0, 10, 30);
    const night = timed(29, 23, 0, 1, 30, 30);
    const tiny = timed(30, 8, 0, 8, 5);
    const layout = weekLayout([x, y, z, night, tiny], days, Z);
    const box = (o: Occurrence) => layout.boxes.filter((b) => b.occ === o).map((b) => [b.day, b.top, b.height, b.col, b.cols]);
    expect(box(x)).toEqual([[0, 540, 60, 0, 2]]);
    expect(box(y)).toEqual([[0, 570, 90, 1, 2]]);
    expect(box(z)).toEqual([[0, 600, 30, 0, 2]]);
    expect(box(night)).toEqual([[1, 1380, 60, 0, 1], [2, 0, 90, 0, 1]]);
    expect(box(tiny)).toEqual([[2, 480, 15, 0, 1]]);
  });

  it('packs all-day occurrences into lanes across the week', () => {
    const days = weekDates('2026-09-28');
    const a = allDay('2026-09-27', '2026-09-29');
    const b = allDay('2026-09-29', '2026-10-01');
    const c = allDay('2026-10-03', '2026-10-06');
    const layout = weekLayout([a, b, c], days, Z);
    expect(layout.allDay.map((s) => [s.occ, s.startCol, s.endCol, s.lane])).toEqual([
      [a, 0, 1, 0],
      [b, 1, 3, 1],
      [c, 5, 6, 0],
    ]);
    expect(layout.allDayLanes).toBe(2);
  });
});
```

```ts
// apps/web/test/calendarStore.test.ts
import { applyCommand, EVENT_COLORS, LOCAL_ORIGIN } from '@relay/core';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createBoardController } from '../src/board/controller';
import { createActivityStore } from '../src/store/activityStore';
import { createCalendarStore } from '../src/store/calendarStore';
import { createDocStore } from '../src/store/docStore';

function setup() {
  const doc = new Y.Doc();
  const docs = createDocStore(doc);
  const activity = createActivityStore(doc);
  const controller = createBoardController({
    doc,
    docStore: docs.store,
    setPage: docs.setPage,
    activity: activity.store,
    user: { id: 'u1', name: 'Brisk Otter', color: '#E85A1B' },
  });
  const calendars = createCalendarStore(doc, docs.store);
  return { doc, controller, calendars };
}

describe('calendar store', () => {
  it('projects the active calendar page and follows edits; nothing on other pages', () => {
    const { doc, controller, calendars } = setup();
    expect(calendars.store.getState()).toEqual({ pageId: null, calendar: null });
    const id = controller.createPage('calendar');
    controller.setPage(id);
    expect(calendars.store.getState()).toEqual({ pageId: id, calendar: { events: [] } });
    applyCommand(
      doc,
      {
        type: 'CreateEvent',
        pageId: id,
        id: 'e1',
        fields: {
          title: 'Standup',
          color: EVENT_COLORS[0] as string,
          when: { allDay: true, start: '2026-09-28', end: '2026-09-28' },
          createdBy: 'u1',
          createdAt: 1,
        },
      },
      LOCAL_ORIGIN,
    );
    expect(calendars.store.getState().calendar?.events.map((e) => e.title)).toEqual(['Standup']);
    controller.setPage('main');
    expect(calendars.store.getState()).toEqual({ pageId: null, calendar: null });
    calendars.destroy();
  });
});
```

Add to `packages/core/test/presence.test.ts`. The test file already declares `alice`:

```ts
describe('calendar presence', () => {
  it('keeps a valid open event id and drops anything else', () => {
    expect(parsePresence({ user: alice, calEvent: 'e1' })?.calEvent).toBe('e1');
    expect(parsePresence({ user: alice, calEvent: 'x'.repeat(65) })?.calEvent).toBeUndefined();
    expect(parsePresence({ user: alice, calEvent: 7 })?.calEvent).toBeUndefined();
    expect(parsePresence({ user: alice, calEvent: null })?.calEvent).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @relay/web -- calendar` and `npm test -w @relay/core -- presence`
Expected: FAIL. The modules and the field do not exist yet.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/src/store/calendarStore.ts
import { type CalendarSnapshot, getRoots, readCalendar } from '@relay/core';
import type * as Y from 'yjs';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { type DocState, touchedIds } from './docStore';

export interface CalendarState {
  /** The active page when it is a calendar page, else null. */
  pageId: string | null;
  calendar: CalendarSnapshot | null;
}

/** Projects the active calendar page (if any) after every change to it. */
export function createCalendarStore(
  doc: Y.Doc,
  docStore: StoreApi<DocState>,
): { store: StoreApi<CalendarState>; destroy(): void } {
  const { calendars } = getRoots(doc);
  const store = createStore<CalendarState>(() => ({ pageId: null, calendar: null }));

  const refresh = () => {
    const { activePage, pages } = docStore.getState();
    const isCalendar = pages.find((p) => p.id === activePage)?.type === 'calendar';
    store.setState({
      pageId: isCalendar ? activePage : null,
      calendar: isCalendar ? readCalendar(calendars.get(activePage)) : null,
    });
  };

  const onCalendars = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
    if (touchedIds(events, calendars).has(docStore.getState().activePage)) refresh();
  };
  const unsubscribe = docStore.subscribe((s, prev) => {
    if (s.activePage !== prev.activePage || s.pages !== prev.pages) refresh();
  });
  calendars.observeDeep(onCalendars);
  refresh();

  return {
    store,
    destroy() {
      unsubscribe();
      calendars.unobserveDeep(onCalendars);
    },
  };
}
```

```ts
// apps/web/src/calendar/layout.ts
import {
  addDays,
  dayNumber,
  formatDate,
  fromDayNumber,
  type Occurrence,
  parseDate,
  toInstant,
  toWall,
  weekday,
  type Ymd,
} from '@relay/core';

export const HOUR_PX = 48;
export const SNAP_MIN = 15;
/** Lines of events a month-view day shows before "+N more". */
export const MONTH_LINES = 3;

export interface MonthCell {
  date: string;
  day: number;
  inMonth: boolean;
  today: boolean;
}

const dateOf = (s: string): Ymd => parseDate(s) ?? { y: 1970, m: 1, d: 1 };
const midnight = (date: string, zone: string): number => toInstant({ ...dateOf(date), hh: 0, mm: 0 }, zone);

export function firstOfGrid(y: number, m: number): string {
  const first = { y, m, d: 1 };
  return formatDate(addDays(first, -weekday(first)));
}

export function monthGrid(y: number, m: number, today: string): MonthCell[] {
  const start = dayNumber(dateOf(firstOfGrid(y, m)));
  return Array.from({ length: 42 }, (_, i) => {
    const d = fromDayNumber(start + i);
    const date = formatDate(d);
    return { date, day: d.d, inMonth: d.m === m && d.y === y, today: date === today };
  });
}

export function weekDates(anchor: string): string[] {
  const a = dateOf(anchor);
  const monday = dayNumber(a) - weekday(a);
  return Array.from({ length: 7 }, (_, i) => formatDate(fromDayNumber(monday + i)));
}

export function viewWindow(view: 'month' | 'week', anchor: string, zone: string) {
  const a = dateOf(anchor);
  const first = view === 'month' ? firstOfGrid(a.y, a.m) : (weekDates(anchor)[0] as string);
  const days = view === 'month' ? 42 : 7;
  return { from: midnight(first, zone), to: midnight(formatDate(addDays(dateOf(first), days)), zone), zone };
}

/** First and last local day (day numbers in `zone`) an occurrence covers. */
export function occurrenceDays(o: Occurrence, zone: string): { first: number; last: number } {
  if (o.when.allDay) return { first: dayNumber(dateOf(o.when.start)), last: dayNumber(dateOf(o.when.end)) };
  const first = dayNumber(toWall(o.start, zone));
  const last = o.end > o.start ? dayNumber(toWall(o.end - 1, zone)) : first;
  return { first, last };
}

/** Greedy interval lane packing: each item gets the first lane free from its start. */
function packLanes<T extends { start: number; end: number }>(items: T[]): { item: T; lane: number }[] {
  const sorted = [...items].sort((a, b) => a.start - b.start || b.end - a.end);
  const laneEnds: number[] = [];
  return sorted.map((item) => {
    let lane = laneEnds.findIndex((end) => end < item.start);
    if (lane === -1) lane = laneEnds.length;
    laneEnds[lane] = item.end;
    return { item, lane };
  });
}

export interface MonthBar {
  occ: Occurrence;
  row: number;
  startCol: number;
  endCol: number;
  lane: number;
}

export interface MonthLayout {
  /** Visible bars only (lane < MONTH_LINES). */
  bars: MonthBar[];
  /** Bar lanes used in each of the 6 rows (may exceed MONTH_LINES). */
  rowLanes: number[];
  /** Per grid cell: the visible timed chips and how many items did not fit. */
  days: { chips: Occurrence[]; more: number }[];
}

/** All-day occurrences are bars split at week rows; timed ones are chips on each local day. */
export function monthLayout(occs: Occurrence[], firstDate: string, zone: string): MonthLayout {
  const first = dayNumber(dateOf(firstDate));
  const rowLanes = [0, 0, 0, 0, 0, 0];
  const days = Array.from({ length: 42 }, () => ({ chips: [] as Occurrence[], more: 0 }));
  const barsOnDay = Array.from({ length: 42 }, () => 0);
  const bars: MonthBar[] = [];
  for (let row = 0; row < 6; row++) {
    const lo = row * 7;
    const segs = occs
      .filter((o) => o.when.allDay)
      .flatMap((o) => {
        const { first: f, last: l } = occurrenceDays(o, zone);
        const start = Math.max(f - first, lo);
        const end = Math.min(l - first, lo + 6);
        return start <= end ? [{ occ: o, start, end }] : [];
      });
    for (const { item, lane } of packLanes(segs)) {
      rowLanes[row] = Math.max(rowLanes[row] as number, lane + 1);
      for (let i = item.start; i <= item.end; i++) {
        if (lane >= MONTH_LINES) (days[i] as { more: number }).more++;
        barsOnDay[i] = (barsOnDay[i] as number) + 1;
      }
      if (lane < MONTH_LINES) bars.push({ occ: item.occ, row, startCol: item.start - lo, endCol: item.end - lo, lane });
    }
  }
  for (const o of occs) {
    if (o.when.allDay) continue;
    const { first: f, last: l } = occurrenceDays(o, zone);
    for (let d = Math.max(f, first); d <= Math.min(l, first + 41); d++) {
      const i = d - first;
      const cell = days[i] as { chips: Occurrence[]; more: number };
      const reserved = Math.min(rowLanes[Math.floor(i / 7)] as number, MONTH_LINES);
      if (cell.chips.length < MONTH_LINES - reserved) cell.chips.push(o);
      else cell.more++;
    }
  }
  return { bars, rowLanes, days };
}

export interface WeekBox {
  occ: Occurrence;
  /** 0 = Monday … 6 = Sunday of the shown week. */
  day: number;
  /** Minutes from midnight, and length in minutes (at least SNAP_MIN). */
  top: number;
  height: number;
  col: number;
  cols: number;
}

export interface WeekLayout {
  allDay: { occ: Occurrence; startCol: number; endCol: number; lane: number }[];
  allDayLanes: number;
  boxes: WeekBox[];
}

export function weekLayout(occs: Occurrence[], days: string[], zone: string): WeekLayout {
  const first = dayNumber(dateOf(days[0] as string));
  const allDaySegs = occs
    .filter((o) => o.when.allDay)
    .flatMap((o) => {
      const { first: f, last: l } = occurrenceDays(o, zone);
      const start = Math.max(f - first, 0);
      const end = Math.min(l - first, 6);
      return start <= end ? [{ occ: o, start, end }] : [];
    });
  const packed = packLanes(allDaySegs);
  const allDay = packed.map(({ item, lane }) => ({ occ: item.occ, startCol: item.start, endCol: item.end, lane }));
  const boxes: WeekBox[] = [];
  days.forEach((date, day) => {
    const dayStart = midnight(date, zone);
    const dayEnd = midnight(formatDate(addDays(dateOf(date), 1)), zone);
    const segs = occs
      .filter((o) => !o.when.allDay && o.start < dayEnd && (o.end > dayStart || (o.end === o.start && o.start >= dayStart)))
      .map((o) => {
        const s = Math.max(o.start, dayStart);
        const e = Math.min(o.end, dayEnd);
        const w = toWall(s, zone);
        const top = w.hh * 60 + w.mm;
        const bottom = e >= dayEnd ? 1440 : (() => { const x = toWall(e, zone); return x.hh * 60 + x.mm; })();
        return { occ: o, top, bottom: Math.max(bottom, top + SNAP_MIN) };
      })
      .sort((a, b) => a.top - b.top || b.bottom - a.bottom);
    // Clusters of transitively overlapping boxes share the day's width.
    let cluster: { occ: Occurrence; top: number; bottom: number; col: number }[] = [];
    let clusterEnd = -1;
    const flush = () => {
      const cols = cluster.reduce((n, b) => Math.max(n, b.col + 1), 0);
      for (const b of cluster) boxes.push({ occ: b.occ, day, top: b.top, height: b.bottom - b.top, col: b.col, cols });
      cluster = [];
    };
    for (const s of segs) {
      if (cluster.length > 0 && s.top >= clusterEnd) flush();
      const colEnds: number[] = [];
      for (const b of cluster) colEnds[b.col] = Math.max(colEnds[b.col] ?? 0, b.bottom);
      let col = colEnds.findIndex((end) => end <= s.top);
      if (col === -1) col = colEnds.length;
      cluster.push({ ...s, col });
      clusterEnd = Math.max(cluster.length === 1 ? s.bottom : clusterEnd, s.bottom);
    }
    if (cluster.length > 0) flush();
  });
  return {
    allDay,
    allDayLanes: packed.reduce((n, p) => Math.max(n, p.lane + 1), 0),
    boxes,
  };
}
```

`packLanes` with `end < item.start` treats day indexes as inclusive: a bar ending on day 1 blocks a bar starting on day 1. The all-day lane test expects `b` to go into lane 1 for exactly that reason.

In `packages/core/src/presence/state.ts`:
- add the field `calEvent?: string | null;` to `PresenceState`, with a doc comment ("Event open in the editor on a calendar page");
- in `parsePresence`, after the sheet block:
  ```ts
  if (typeof o.calEvent === 'string' && o.calEvent.length > 0 && o.calEvent.length <= 64) state.calEvent = o.calEvent;
  ```

In `apps/web/src/sync/presence.ts`:
- add `setCalEvent(id: string | null): void` to `PresencePublisher`;
- add `calEvent: null` to `initial`;
- add `setCalEvent: (id) => awareness.setLocalStateField('calEvent', id),` to the returned object.

In `apps/web/src/board/session.ts`:
- `import { type CalendarState, createCalendarStore } from '../store/calendarStore';`
- add the doc-commented field `/** Projection of the active calendar page (null calendar on other pages). */ calendar: StoreApi<CalendarState>;` to `BoardSession`;
- create it next to the sheet store with `const calendarStore = createCalendarStore(conn.doc, docStore.store);`;
- return it as `calendar: calendarStore.store`;
- call `calendarStore.destroy()` in `destroy()`, next to `sheetStore.destroy()`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @relay/web -- calendar && npm test -w @relay/core -- presence`
Expected: PASS, with 5 layout tests, 1 store test, and the presence tests.

If a hand-computed layout expectation proves wrong, recompute it from the rules in this task and report the correction. Never weaken an assertion to pass, because the numbers are the spec of the layout. For example, in the month test `c` lands in lane 3 because `long`, `a` and `b` take lanes 0–2 on 7 September.

- [ ] **Step 5: Run the suites, typecheck and lint, then commit**

Run: `npm test && npm run typecheck && npm run lint`

```bash
git add apps/web/src/store/calendarStore.ts apps/web/src/calendar/layout.ts apps/web/src/board/session.ts apps/web/src/sync/presence.ts packages/core/src/presence/state.ts apps/web/test/calendarStore.test.ts apps/web/test/calendarLayout.test.ts packages/core/test/presence.test.ts
git commit -m "feat(web): calendar store, calEvent presence and month/week layout"
```

---
### Task 7: Web calendar controller

**Files:**
- Create: `apps/web/src/calendar/calendarController.ts`
- Modify: `apps/web/src/board/controller.ts`. Expose `commitSession(command: Command): void` on `BoardController`, backed by the existing internal `commitSession`, with a doc comment: "Applies a command with the SESSION origin (never undoable)".
- Test: `apps/web/test/calendarController.test.ts`

**Interfaces:**
- Consumes:
  - From core: `expandAll`, `occurrenceWhen`, `whenRange`, `readCalendar` types, `newEventId`, `todayIn`, `toInstant`, `toWall`, `parseDate`, `parseWall`, `formatDate`, `formatWall`, `addDays`, `dayNumber`, `wallMinutes`, `fromWallMinutes`, and the `MAX_*` and `MIN_EVENT_MINUTES` constants.
  - From Task 6: `viewWindow`, `firstOfGrid`, `weekDates`, and `CalendarState`.
- Produces:
  - Types:
    - `CalView = 'month' | 'week'`
    - `Scope = 'one' | 'all'`
    - `OccRef { eventId: string; key: string }`
    - `EditorDraft { title, notes, color, allDay, startDate, startTime, endDate, endTime, repeat: 'none' | Freq, interval, byDay: number[], ends: 'never' | 'on' | 'after', until, count }`. Dates are `'YYYY-MM-DD'` and times `'HH:mm'`, both in the viewer's zone.
    - `EditorState { ref: OccRef | null; draft: EditorDraft; readOnly: boolean }`
    - `SeriesQuestion { action: 'save' | 'move' | 'delete'; drops: number }`
    - `CalendarUi { view, anchor, selected: OccRef | null, editor: EditorState | null, question: SeriesQuestion | null }`
  - `createCalendarController(opts: CalendarControllerOptions): CalendarController`, with options `{ calendar, commit, commitSession, canEdit, notify, user: { id, name }, zone, now, newId? }`.
  - `CalendarController` members:
    - `ui` and `zone`
    - `visible(): { occurrences: Occurrence[]; truncated: boolean }`
    - navigation: `setView(v)`, `today()`, `step(dir: -1 | 1)`, `goTo(date)`
    - `select(ref | null)`
    - editing:
      - `newEvent(at?: { date: string; start?: number; end?: number })`, where `start` and `end` are minutes from local midnight;
      - `openEditor(ref)`, `closeEditor()`, `save(draft)`
    - gestures:
      - `move(ref, to: { date: string; minutes?: number })`
      - `resize(ref, to: { date: string; minutes: number })`
      - `remove(ref)`
    - `answer(scope: Scope | null)` and `rsvp(eventId, status | null)`
    - `resolve(ref): { ev: CalendarEvent; when: When } | null`
    - `destroy()`
- User-facing messages, verbatim:
  - `This calendar is full (500 events)`
  - `Too many changes to this series`
  - `The end is before the start`
  - `An event lasts at least 15 minutes`
  - `An event can last at most 14 days`
  - `An all-day event can last at most 366 days`

- [ ] **Step 1: Write the failing test**

```ts
// apps/web/test/calendarController.test.ts
import { applyCommand, EVENT_COLORS, getRoots, readCalendar } from '@relay/core';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createBoardController } from '../src/board/controller';
import { createCalendarController } from '../src/calendar/calendarController';
import { createActivityStore } from '../src/store/activityStore';
import { createCalendarStore } from '../src/store/calendarStore';
import { createDocStore } from '../src/store/docStore';

const ZONE = 'Europe/Madrid';
const NOW = Date.UTC(2026, 8, 28, 10, 0); // Monday 28 Sep 2026, 12:00 in Madrid

function setup(opts: { canEdit?: boolean } = {}) {
  const doc = new Y.Doc();
  const docs = createDocStore(doc);
  const activity = createActivityStore(doc);
  const board = createBoardController({
    doc,
    docStore: docs.store,
    setPage: docs.setPage,
    activity: activity.store,
    user: { id: 'u1', name: 'Brisk Otter', color: '#E85A1B' },
  });
  const calendars = createCalendarStore(doc, docs.store);
  const page = board.createPage('calendar');
  board.setPage(page);
  const notify = vi.fn();
  let n = 0;
  const ctl = createCalendarController({
    calendar: calendars.store,
    commit: board.commit,
    commitSession: board.commitSession,
    canEdit: () => opts.canEdit ?? true,
    notify,
    user: { id: 'u1', name: 'Brisk Otter' },
    zone: ZONE,
    now: () => NOW,
    newId: () => `ev${++n}`,
  });
  const events = () => readCalendar(getRoots(doc).calendars.get(page))?.events ?? [];
  // Events written as if by a peer (no origin): this user's undo never touches them.
  const create = (id: string, fields: Record<string, unknown>) =>
    applyCommand(doc, {
      type: 'CreateEvent',
      pageId: page,
      id,
      fields: { title: 'T', color: EVENT_COLORS[0] as string, createdBy: 'u2', createdAt: 0, ...fields } as never,
    });
  return { doc, page, board, ctl, notify, events, create };
}

describe('navigation', () => {
  it('starts on this month and steps by month or week', () => {
    const { ctl } = setup();
    expect(ctl.ui.getState()).toMatchObject({ view: 'month', anchor: '2026-09-28' });
    ctl.step(1);
    expect(ctl.ui.getState().anchor).toBe('2026-10-01');
    ctl.setView('week');
    ctl.step(-1);
    expect(ctl.ui.getState().anchor).toBe('2026-09-24');
    ctl.today();
    expect(ctl.ui.getState().anchor).toBe('2026-09-28');
  });
});

describe('creating and editing', () => {
  it('creates a timed event in the viewer zone from a week drag, as one undo step', () => {
    const { ctl, events, board } = setup();
    ctl.newEvent({ date: '2026-09-29', start: 9 * 60, end: 10 * 60 + 30 });
    const draft = ctl.ui.getState().editor?.draft;
    expect(draft).toMatchObject({ allDay: false, startDate: '2026-09-29', startTime: '09:00', endTime: '10:30', title: '' });
    ctl.save({ ...(draft as NonNullable<typeof draft>), title: '  ' });
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({
      id: 'ev1',
      title: 'Untitled',
      when: { allDay: false, start: '2026-09-29T09:00', end: '2026-09-29T10:30', tz: ZONE },
      createdBy: 'u1',
    });
    expect(ctl.ui.getState().editor).toBeNull();
    board.undo();
    expect(events()).toHaveLength(0);
  });

  it('creates an all-day event by default and a weekly rule from the draft', () => {
    const { ctl, events } = setup();
    ctl.newEvent({ date: '2026-10-05' });
    const draft = ctl.ui.getState().editor?.draft as NonNullable<ReturnType<typeof ctl.ui.getState>['editor']>['draft'];
    expect(draft).toMatchObject({ allDay: true, startDate: '2026-10-05', endDate: '2026-10-05' });
    ctl.save({ ...draft, title: 'Retro', repeat: 'weekly', interval: 2, byDay: [0, 3], ends: 'after', count: 5 });
    expect(events()[0]).toMatchObject({
      when: { allDay: true, start: '2026-10-05', end: '2026-10-05' },
      rule: { freq: 'weekly', interval: 2, byDay: [0, 3], count: 5 },
    });
  });

  it('refuses invalid drafts and a full calendar', () => {
    const { ctl, events, notify, doc, page } = setup();
    ctl.newEvent({ date: '2026-09-29', start: 600, end: 660 });
    const draft = ctl.ui.getState().editor?.draft as NonNullable<ReturnType<typeof ctl.ui.getState>['editor']>['draft'];
    ctl.save({ ...draft, endTime: '09:00' });
    expect(notify).toHaveBeenLastCalledWith('The end is before the start');
    ctl.save({ ...draft, endTime: '10:05' });
    expect(notify).toHaveBeenLastCalledWith('An event lasts at least 15 minutes');
    expect(events()).toHaveLength(0);
    expect(ctl.ui.getState().editor).not.toBeNull();
    doc.transact(() => {
      for (let i = 0; i < 500; i++) {
        applyCommand(doc, {
          type: 'CreateEvent',
          pageId: page,
          id: `x${i}`,
          fields: { title: 'x', color: EVENT_COLORS[0] as string, when: { allDay: true, start: '2026-09-01', end: '2026-09-01' }, createdBy: 'u', createdAt: 0 },
        });
      }
    });
    ctl.closeEditor();
    ctl.newEvent();
    expect(notify).toHaveBeenLastCalledWith('This calendar is full (500 events)');
    expect(ctl.ui.getState().editor).toBeNull();
  });

  it('opens events read-only for viewers, who cannot create, move or answer', () => {
    const { ctl, create, events } = setup({ canEdit: false });
    create('a', { when: { allDay: true, start: '2026-09-28', end: '2026-09-28' } });
    ctl.newEvent();
    expect(ctl.ui.getState().editor).toBeNull();
    ctl.openEditor({ eventId: 'a', key: '2026-09-28' });
    expect(ctl.ui.getState().editor?.readOnly).toBe(true);
    ctl.move({ eventId: 'a', key: '2026-09-28' }, { date: '2026-09-30' });
    ctl.rsvp('a', 'yes');
    expect(events()[0]?.when.start).toBe('2026-09-28');
    expect(events()[0]?.rsvp).toEqual({});
  });
});

describe('moving, resizing and deleting', () => {
  it('moves a single timed event to another day keeping its local time, and in week view to a new time', () => {
    const { ctl, create, events } = setup();
    create('a', { when: { allDay: false, start: '2026-09-28T09:00', end: '2026-09-28T10:00', tz: 'America/Havana' } });
    // 09:00 Havana is 15:00 in Madrid.
    ctl.move({ eventId: 'a', key: '2026-09-28' }, { date: '2026-10-01' });
    expect(events()[0]?.when).toEqual({ allDay: false, start: '2026-10-01T09:00', end: '2026-10-01T10:00', tz: 'America/Havana' });
    ctl.move({ eventId: 'a', key: '2026-10-01' }, { date: '2026-10-02', minutes: 17 * 60 });
    expect(events()[0]?.when).toMatchObject({ start: '2026-10-02T11:00', end: '2026-10-02T12:00' });
  });

  it('asks about a series: "Only this event" writes an exception', () => {
    const { ctl, create, events } = setup();
    create('s', { when: { allDay: false, start: '2026-09-28T09:00', end: '2026-09-28T09:30', tz: ZONE }, rule: { freq: 'daily', interval: 1 } });
    ctl.move({ eventId: 's', key: '2026-09-30' }, { date: '2026-09-30', minutes: 11 * 60 });
    expect(ctl.ui.getState().question).toEqual({ action: 'move', drops: 0 });
    ctl.answer('one');
    expect(ctl.ui.getState().question).toBeNull();
    expect(events()[0]?.exceptions).toEqual({
      '2026-09-30': { when: { allDay: false, start: '2026-09-30T11:00', end: '2026-09-30T11:30', tz: ZONE } },
    });
  });

  it('"All events" shifts the whole series and clears its exceptions, reporting how many', () => {
    const { ctl, create, events } = setup();
    create('s', { when: { allDay: false, start: '2026-09-28T09:00', end: '2026-09-28T09:30', tz: ZONE }, rule: { freq: 'daily', interval: 1 } });
    ctl.remove({ eventId: 's', key: '2026-10-02' });
    ctl.answer('one');
    ctl.move({ eventId: 's', key: '2026-09-30' }, { date: '2026-10-01', minutes: 10 * 60 });
    expect(ctl.ui.getState().question).toEqual({ action: 'move', drops: 1 });
    ctl.answer('all');
    expect(events()[0]).toMatchObject({
      when: { start: '2026-09-29T10:00', end: '2026-09-29T10:30' },
      exceptions: {},
    });
  });

  it('resizes all events of a series without dropping exceptions, and cancels on no answer', () => {
    const { ctl, create, events } = setup();
    create('s', { when: { allDay: false, start: '2026-09-28T09:00', end: '2026-09-28T09:30', tz: ZONE }, rule: { freq: 'weekly', interval: 1 } });
    ctl.remove({ eventId: 's', key: '2026-10-05' });
    ctl.answer('one');
    ctl.resize({ eventId: 's', key: '2026-10-12' }, { date: '2026-10-12', minutes: 10 * 60 + 15 });
    ctl.answer(null);
    expect(events()[0]?.when.end).toBe('2026-09-28T09:30');
    ctl.resize({ eventId: 's', key: '2026-10-12' }, { date: '2026-10-12', minutes: 10 * 60 + 15 });
    ctl.answer('all');
    expect(events()[0]?.when.end).toBe('2026-09-28T10:15');
    expect(Object.keys(events()[0]?.exceptions ?? {})).toEqual(['2026-10-05']);
  });

  it('deletes a whole series, and closes the editor when its event disappears', () => {
    const { ctl, create, events, doc, page } = setup();
    create('s', { when: { allDay: true, start: '2026-09-28', end: '2026-09-28' }, rule: { freq: 'daily', interval: 1 } });
    ctl.remove({ eventId: 's', key: '2026-09-29' });
    ctl.answer('all');
    expect(events()).toHaveLength(0);
    create('t', { when: { allDay: true, start: '2026-09-28', end: '2026-09-28' } });
    ctl.openEditor({ eventId: 't', key: '2026-09-28' });
    ctl.select({ eventId: 't', key: '2026-09-28' });
    applyCommand(doc, { type: 'DeleteEvent', pageId: page, id: 't' });
    expect(ctl.ui.getState().editor).toBeNull();
    expect(ctl.ui.getState().selected).toBeNull();
  });
});

describe('RSVP and visible occurrences', () => {
  it('answers with the SESSION origin, so undo does not remove it', () => {
    const { ctl, create, events, board } = setup();
    create('a', { when: { allDay: true, start: '2026-09-28', end: '2026-09-28' } });
    ctl.rsvp('a', 'maybe');
    expect(events()[0]?.rsvp).toEqual({ u1: { status: 'maybe', name: 'Brisk Otter' } });
    board.undo();
    expect(events()[0]?.rsvp).toEqual({ u1: { status: 'maybe', name: 'Brisk Otter' } });
    ctl.rsvp('a', null);
    expect(events()[0]?.rsvp).toEqual({});
  });

  it('lists the occurrences of the visible window', () => {
    const { ctl, create } = setup();
    create('s', { when: { allDay: true, start: '2026-09-01', end: '2026-09-01' }, rule: { freq: 'weekly', interval: 1 } });
    expect(ctl.visible().occurrences.map((o) => o.key)).toEqual([
      '2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22', '2026-09-29', '2026-10-06',
    ]);
    ctl.setView('week');
    expect(ctl.visible().occurrences.map((o) => o.key)).toEqual(['2026-09-29']);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -w @relay/web -- calendarController`
Expected: FAIL. The module `../src/calendar/calendarController` does not exist.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/src/calendar/calendarController.ts
import {
  addDays,
  type CalendarEvent,
  type Command,
  dayNumber,
  EVENT_COLORS,
  type Exception,
  expandAll,
  type Freq,
  formatDate,
  formatWall,
  fromWallMinutes,
  MAX_ALLDAY_DAYS,
  MAX_EVENT_NOTES,
  MAX_EVENT_TITLE,
  MAX_EVENTS,
  MAX_EXCEPTIONS,
  MAX_TIMED_DAYS,
  MIN_EVENT_MINUTES,
  newEventId,
  type Occurrence,
  occurrenceWhen,
  parseDate,
  parseWall,
  type Rule,
  type RsvpStatus,
  toInstant,
  todayIn,
  toWall,
  type When,
  wallMinutes,
  type Ymd,
} from '@relay/core';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { CalendarState } from '../store/calendarStore';
import { viewWindow } from './layout';

export type CalView = 'month' | 'week';
export type Scope = 'one' | 'all';

export interface OccRef {
  eventId: string;
  /** The occurrence's original date. */
  key: string;
}

export interface EditorDraft {
  title: string;
  notes: string;
  color: string;
  allDay: boolean;
  /** Dates 'YYYY-MM-DD' and times 'HH:mm', in the viewer's zone. */
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
  repeat: 'none' | Freq;
  interval: number;
  byDay: number[];
  ends: 'never' | 'on' | 'after';
  until: string;
  count: number;
}

export interface EditorState {
  /** null for a new event. */
  ref: OccRef | null;
  draft: EditorDraft;
  readOnly: boolean;
}

export interface SeriesQuestion {
  action: 'save' | 'move' | 'delete';
  /** Exceptions an "All events" answer would clear. */
  drops: number;
}

export interface CalendarUi {
  view: CalView;
  /** A date inside the shown period. */
  anchor: string;
  selected: OccRef | null;
  editor: EditorState | null;
  question: SeriesQuestion | null;
}

export interface CalendarControllerOptions {
  calendar: StoreApi<CalendarState>;
  /** LOCAL origin, one undo step; false when nothing was applied. */
  commit(...commands: Command[]): boolean;
  /** SESSION origin (RSVP), never undoable. */
  commitSession(command: Command): void;
  canEdit(): boolean;
  notify(message: string): void;
  user: { id: string; name: string };
  zone: string;
  now(): number;
  newId?: () => string;
}

export interface CalendarController {
  ui: StoreApi<CalendarUi>;
  zone: string;
  visible(): { occurrences: Occurrence[]; truncated: boolean };
  setView(view: CalView): void;
  today(): void;
  step(dir: -1 | 1): void;
  goTo(date: string): void;
  select(ref: OccRef | null): void;
  newEvent(at?: { date: string; start?: number; end?: number }): void;
  openEditor(ref: OccRef): void;
  closeEditor(): void;
  save(draft: EditorDraft): void;
  move(ref: OccRef, to: { date: string; minutes?: number }): void;
  resize(ref: OccRef, to: { date: string; minutes: number }): void;
  remove(ref: OccRef): void;
  answer(scope: Scope | null): void;
  rsvp(eventId: string, status: RsvpStatus | null): void;
  resolve(ref: OccRef): { ev: CalendarEvent; when: When } | null;
  destroy(): void;
}

const EPOCH: Ymd = { y: 1970, m: 1, d: 1 };
const dateOf = (s: string): Ymd => parseDate(s) ?? EPOCH;
const p2 = (n: number) => String(n).padStart(2, '0');
const hhmm = (minutes: number) => `${p2(Math.floor(minutes / 60))}:${p2(minutes % 60)}`;
const minutesOf = (time: string): number => {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0;
};

export function createCalendarController(opts: CalendarControllerOptions): CalendarController {
  const zone = opts.zone;
  const newId = opts.newId ?? newEventId;
  const ui = createStore<CalendarUi>(() => ({
    view: 'month',
    anchor: todayIn(opts.now(), zone),
    selected: null,
    editor: null,
    question: null,
  }));
  let pending: ((scope: Scope) => void) | null = null;

  const pageId = () => opts.calendar.getState().pageId;
  const events = () => opts.calendar.getState().calendar?.events ?? [];
  const eventById = (id: string) => events().find((e) => e.id === id);

  /** The occurrence's effective when (after its exception). */
  const resolve = (ref: OccRef): { ev: CalendarEvent; when: When } | null => {
    const ev = eventById(ref.eventId);
    if (!ev) return null;
    const ex = ev.exceptions[ref.key];
    if (ex && 'when' in ex) return { ev, when: ex.when };
    return { ev, when: ev.rule ? occurrenceWhen(ev.when, dateOf(ref.key)) : ev.when };
  };

  const ask = (question: SeriesQuestion, run: (scope: Scope) => void) => {
    pending = run;
    ui.setState({ question });
  };

  const commitEvent = (...commands: Command[]) => opts.commit(...commands);

  /** A when as the viewer sees it: dates and times in the viewer's zone. */
  const viewerFields = (w: When) => {
    if (w.allDay) return { allDay: true, startDate: w.start, startTime: '09:00', endDate: w.end, endTime: '10:00' };
    const s = toWall(toInstant(parseWall(w.start) ?? { ...EPOCH, hh: 0, mm: 0 }, w.tz), zone);
    const e = toWall(toInstant(parseWall(w.end) ?? { ...EPOCH, hh: 0, mm: 0 }, w.tz), zone);
    return {
      allDay: false,
      startDate: formatDate(s),
      startTime: hhmm(s.hh * 60 + s.mm),
      endDate: formatDate(e),
      endTime: hhmm(e.hh * 60 + e.mm),
    };
  };

  const draftOf = (ev: CalendarEvent | null, when: When, title: string, notes: string, color: string): EditorDraft => {
    const rule = ev?.rule;
    return {
      title,
      notes,
      color,
      ...viewerFields(when),
      repeat: rule?.freq ?? 'none',
      interval: rule?.interval ?? 1,
      byDay: rule?.byDay ?? [],
      ends: rule?.count !== undefined ? 'after' : rule?.until ? 'on' : 'never',
      until: rule?.until ?? '',
      count: rule?.count ?? 10,
    };
  };

  /** The draft's when, stored in `tz` for timed events; or an error message. */
  const whenOfDraft = (d: EditorDraft, tz: string): When | string => {
    const sd = parseDate(d.startDate);
    const ed = parseDate(d.endDate);
    if (!sd || !ed) return 'The end is before the start';
    if (d.allDay) {
      const span = dayNumber(ed) - dayNumber(sd);
      if (span < 0) return 'The end is before the start';
      if (span >= MAX_ALLDAY_DAYS) return 'An all-day event can last at most 366 days';
      return { allDay: true, start: formatDate(sd), end: formatDate(ed) };
    }
    const start = toInstant({ ...sd, hh: 0, mm: 0, ...split(d.startTime) }, zone);
    const end = toInstant({ ...ed, hh: 0, mm: 0, ...split(d.endTime) }, zone);
    if (end < start) return 'The end is before the start';
    if (end - start < MIN_EVENT_MINUTES * 60_000) return 'An event lasts at least 15 minutes';
    if (end - start > MAX_TIMED_DAYS * 86_400_000) return 'An event can last at most 14 days';
    return { allDay: false, start: formatWall(toWall(start, tz)), end: formatWall(toWall(end, tz)), tz };
  };
  const split = (time: string) => {
    const m = minutesOf(time);
    return { hh: Math.floor(m / 60), mm: m % 60 };
  };

  const ruleOfDraft = (d: EditorDraft): Rule | undefined => {
    if (d.repeat === 'none') return undefined;
    const rule: Rule = { freq: d.repeat, interval: Math.min(99, Math.max(1, Math.round(d.interval) || 1)) };
    if (d.repeat === 'weekly' && d.byDay.length > 0) rule.byDay = [...new Set(d.byDay)].sort((a, b) => a - b);
    if (d.ends === 'on' && parseDate(d.until)) rule.until = d.until;
    if (d.ends === 'after') rule.count = Math.min(999, Math.max(1, Math.round(d.count) || 1));
    return rule;
  };

  /** Start date of a when in its own frame (the event's zone for timed events). */
  const startDay = (w: When): number => dayNumber(w.allDay ? dateOf(w.start) : (parseWall(w.start) ?? EPOCH));
  const timeOfDay = (w: When): number => {
    if (w.allDay) return -1;
    const s = parseWall(w.start);
    return s ? s.hh * 60 + s.mm : 0;
  };

  /**
   * The series base when that puts the occurrence `key` at `occ`: same shift in days from
   * the base start, the occurrence's time of day and duration.
   */
  const rebase = (base: When, key: string, occ: When): When => {
    const shift = startDay(occ) - dayNumber(dateOf(key));
    const baseDate = addDays(dateOf(base.allDay ? base.start : base.start.slice(0, 10)), shift);
    if (occ.allDay) {
      const span = dayNumber(dateOf(occ.end)) - dayNumber(dateOf(occ.start));
      return { allDay: true, start: formatDate(baseDate), end: formatDate(addDays(baseDate, span)) };
    }
    const s = parseWall(occ.start) ?? { ...EPOCH, hh: 0, mm: 0 };
    const e = parseWall(occ.end) ?? s;
    const start = { ...baseDate, hh: s.hh, mm: s.mm };
    return {
      allDay: false,
      start: formatWall(start),
      end: formatWall(fromWallMinutes(wallMinutes(start) + wallMinutes(e) - wallMinutes(s))),
      tz: occ.tz,
    };
  };

  const exceptionCount = (ev: CalendarEvent) => Object.keys(ev.exceptions).length;

  const setOccurrence = (ev: CalendarEvent, key: string, value: Exception): boolean => {
    const page = pageId();
    if (!page) return false;
    if (!(key in ev.exceptions) && exceptionCount(ev) >= MAX_EXCEPTIONS) {
      opts.notify('Too many changes to this series');
      return false;
    }
    return commitEvent({ type: 'SetOccurrence', pageId: page, id: ev.id, key, value });
  };

  /** Writes a new effective when for one occurrence, keeping its other changed fields. */
  const changeOne = (ev: CalendarEvent, key: string, when: When, fields: Partial<Record<'title' | 'notes' | 'color', string>> = {}) => {
    const prev = ev.exceptions[key];
    const kept = prev && 'when' in prev ? { title: prev.title, notes: prev.notes, color: prev.color } : {};
    const value: Exception = { when };
    for (const [k, v] of Object.entries({ ...kept, ...fields })) {
      if (v !== undefined) (value as Record<string, unknown>)[k] = v;
    }
    setOccurrence(ev, key, value);
  };

  const closeIfGone = () => {
    const { editor, selected } = ui.getState();
    const patch: Partial<CalendarUi> = {};
    if (editor?.ref && !eventById(editor.ref.eventId)) patch.editor = null;
    if (selected && !eventById(selected.eventId)) patch.selected = null;
    if (Object.keys(patch).length > 0) ui.setState(patch);
  };
  let lastPage = pageId();
  const unsubscribe = opts.calendar.subscribe((s) => {
    if (s.pageId !== lastPage) {
      lastPage = s.pageId;
      pending = null;
      ui.setState({ selected: null, editor: null, question: null });
      return;
    }
    closeIfGone();
  });

  const shiftAnchor = (dir: -1 | 1) => {
    const { view, anchor } = ui.getState();
    const a = dateOf(anchor);
    if (view === 'week') return formatDate(addDays(a, dir * 7));
    const index = a.y * 12 + (a.m - 1) + dir;
    return formatDate({ y: Math.floor(index / 12), m: (index % 12) + 1, d: 1 });
  };

  return {
    ui,
    zone,
    visible() {
      const cal = opts.calendar.getState().calendar;
      if (!cal) return { occurrences: [], truncated: false };
      const { view, anchor } = ui.getState();
      return expandAll(cal, viewWindow(view, anchor, zone));
    },
    setView(view) {
      ui.setState({ view });
    },
    today() {
      ui.setState({ anchor: todayIn(opts.now(), zone) });
    },
    step(dir) {
      ui.setState({ anchor: shiftAnchor(dir) });
    },
    goTo(date) {
      if (parseDate(date)) ui.setState({ anchor: date });
    },
    select(ref) {
      ui.setState({ selected: ref });
    },
    newEvent(at) {
      if (!opts.canEdit() || !pageId()) return;
      if (events().length >= MAX_EVENTS) {
        opts.notify('This calendar is full (500 events)');
        return;
      }
      const date = at?.date ?? todayIn(opts.now(), zone);
      const timed = at?.start !== undefined;
      const start = at?.start ?? 9 * 60;
      const end = Math.min(at?.end ?? start + 60, 24 * 60 - 1);
      const draft: EditorDraft = {
        ...draftOf(null, { allDay: true, start: date, end: date }, '', '', EVENT_COLORS[0] as string),
        allDay: !timed,
        startTime: hhmm(start),
        endTime: hhmm(Math.max(end, start + MIN_EVENT_MINUTES)),
      };
      ui.setState({ editor: { ref: null, draft, readOnly: false } });
    },
    openEditor(ref) {
      const r = resolve(ref);
      if (!r) return;
      const ex = r.ev.exceptions[ref.key];
      const changed = ex && 'when' in ex ? ex : null;
      const draft = draftOf(r.ev, r.when, changed?.title ?? r.ev.title, changed?.notes ?? r.ev.notes, changed?.color ?? r.ev.color);
      ui.setState({ editor: { ref, draft, readOnly: !opts.canEdit() }, selected: ref });
    },
    closeEditor() {
      ui.setState({ editor: null });
    },
    save(draft) {
      const editor = ui.getState().editor;
      const page = pageId();
      if (!editor || editor.readOnly || !opts.canEdit() || !page) return;
      const title = draft.title.trim().slice(0, MAX_EVENT_TITLE) || 'Untitled';
      const notes = draft.notes.slice(0, MAX_EVENT_NOTES);
      const color = EVENT_COLORS.includes(draft.color) ? draft.color : (EVENT_COLORS[0] as string);
      const rule = ruleOfDraft(draft);
      if (!editor.ref) {
        const when = whenOfDraft(draft, zone);
        if (typeof when === 'string') {
          opts.notify(when);
          return;
        }
        const id = newId();
        const fields = { title, notes, color, when, createdBy: opts.user.id, createdAt: opts.now(), ...(rule ? { rule } : {}) };
        if (commitEvent({ type: 'CreateEvent', pageId: page, id, fields })) {
          ui.setState({ editor: null, selected: { eventId: id, key: formatDate(dateOf(when.start.slice(0, 10))) } });
        }
        return;
      }
      const r = resolve(editor.ref);
      if (!r) return;
      const { ev } = r;
      const tz = ev.when.allDay ? zone : ev.when.tz;
      const when = whenOfDraft(draft, tz);
      if (typeof when === 'string') {
        opts.notify(when);
        return;
      }
      if (!ev.rule) {
        commitEvent({ type: 'UpdateEvent', pageId: page, id: ev.id, patch: { title, notes, color, when, rule: rule ?? null } });
        ui.setState({ editor: null });
        return;
      }
      const key = editor.ref.key;
      const base = rebase(ev.when, key, when);
      const ruleChanged = JSON.stringify(rule ?? null) !== JSON.stringify(ev.rule);
      const timeChanged =
        startDay(when) !== startDay(r.when) || timeOfDay(when) !== timeOfDay(r.when) || when.allDay !== r.when.allDay;
      const clears = ruleChanged || timeChanged;
      ask({ action: 'save', drops: clears ? exceptionCount(ev) : 0 }, (scope) => {
        if (scope === 'one') changeOne(ev, key, when, { title, notes, color });
        else {
          commitEvent({
            type: 'UpdateEvent',
            pageId: page,
            id: ev.id,
            patch: { title, notes, color, when: base, rule: rule ?? null },
            clearExceptions: clears && exceptionCount(ev) > 0,
          });
        }
        ui.setState({ editor: null });
      });
    },
    move(ref, to) {
      const page = pageId();
      const r = resolve(ref);
      if (!opts.canEdit() || !page || !r) return;
      const { ev, when } = r;
      let next: When;
      if (when.allDay) {
        const shift = dayNumber(dateOf(to.date)) - dayNumber(dateOf(when.start));
        next = { allDay: true, start: formatDate(addDays(dateOf(when.start), shift)), end: formatDate(addDays(dateOf(when.end), shift)) };
      } else {
        const s = toInstant(parseWall(when.start) ?? { ...EPOCH, hh: 0, mm: 0 }, when.tz);
        const e = toInstant(parseWall(when.end) ?? { ...EPOCH, hh: 0, mm: 0 }, when.tz);
        const local = toWall(s, zone);
        const minutes = to.minutes ?? local.hh * 60 + local.mm;
        const start = toInstant({ ...dateOf(to.date), hh: Math.floor(minutes / 60), mm: minutes % 60 }, zone);
        next = { allDay: false, start: formatWall(toWall(start, when.tz)), end: formatWall(toWall(start + (e - s), when.tz)), tz: when.tz };
      }
      if (JSON.stringify(next) === JSON.stringify(when)) return;
      if (!ev.rule) {
        commitEvent({ type: 'UpdateEvent', pageId: page, id: ev.id, patch: { when: next } });
        return;
      }
      ask({ action: 'move', drops: exceptionCount(ev) }, (scope) => {
        if (scope === 'one') changeOne(ev, ref.key, next);
        else {
          commitEvent({
            type: 'UpdateEvent',
            pageId: page,
            id: ev.id,
            patch: { when: rebase(ev.when, ref.key, next) },
            clearExceptions: exceptionCount(ev) > 0,
          });
        }
      });
    },
    resize(ref, to) {
      const page = pageId();
      const r = resolve(ref);
      if (!opts.canEdit() || !page || !r || r.when.allDay) return;
      const { ev, when } = r;
      const s = toInstant(parseWall(when.start) ?? { ...EPOCH, hh: 0, mm: 0 }, when.tz);
      const raw = toInstant({ ...dateOf(to.date), hh: Math.floor(to.minutes / 60), mm: to.minutes % 60 }, zone);
      const end = Math.min(Math.max(raw, s + MIN_EVENT_MINUTES * 60_000), s + MAX_TIMED_DAYS * 86_400_000);
      const next: When = { ...when, end: formatWall(toWall(end, when.tz)) };
      if (next.end === when.end) return;
      if (!ev.rule) {
        commitEvent({ type: 'UpdateEvent', pageId: page, id: ev.id, patch: { when: next } });
        return;
      }
      ask({ action: 'move', drops: 0 }, (scope) => {
        if (scope === 'one') changeOne(ev, ref.key, next);
        else if (!ev.when.allDay) {
          const bs = parseWall(ev.when.start) ?? { ...EPOCH, hh: 0, mm: 0 };
          const minutes = Math.round((end - s) / 60_000);
          commitEvent({
            type: 'UpdateEvent',
            pageId: page,
            id: ev.id,
            patch: { when: { ...ev.when, end: formatWall(fromWallMinutes(wallMinutes(bs) + minutes)) } },
          });
        }
      });
    },
    remove(ref) {
      const page = pageId();
      const ev = eventById(ref.eventId);
      if (!opts.canEdit() || !page || !ev) return;
      const done = () => ui.setState({ selected: null, editor: null });
      if (!ev.rule) {
        commitEvent({ type: 'DeleteEvent', pageId: page, id: ev.id });
        done();
        return;
      }
      ask({ action: 'delete', drops: 0 }, (scope) => {
        if (scope === 'one') setOccurrence(ev, ref.key, { cancelled: true });
        else commitEvent({ type: 'DeleteEvent', pageId: page, id: ev.id });
        done();
      });
    },
    answer(scope) {
      const run = pending;
      pending = null;
      ui.setState({ question: null });
      if (scope && run) run(scope);
    },
    rsvp(eventId, status) {
      const page = pageId();
      if (!opts.canEdit() || !page || !eventById(eventId)) return;
      opts.commitSession({ type: 'SetRsvp', pageId: page, id: eventId, userId: opts.user.id, status, name: opts.user.name });
    },
    resolve,
    destroy() {
      unsubscribe();
    },
  };
}
```

Notes for the implementer:
- **Reference numbers**, used in the tests:
  - `'All events' shifts…`: the 30 Sep occurrence moves to 1 Oct at 10:00. That is a one-day shift, and the time goes 09:00 → 10:00. The base moves from 28 Sep 09:00 to 29 Sep 10:00.
  - `moves a single timed event…`: 09:00 in Havana is 15:00 in Madrid. Moving to 1 Oct keeps 15:00 Madrid, which is 09:00 Havana. In week view, 17:00 Madrid is 11:00 Havana.
- **`MAX_EVENTS` in the test:** the full-calendar test writes 500 events directly, then calls `closeEditor()` and `newEvent()`.
- **`commitSession` on the board controller:** add it to the `BoardController` interface next to `commit`, and return the existing internal `commitSession` from `createBoardController`.
- **Biome and TypeScript:** make any fixes they need, such as ordering helpers before use, or `const split` before `whenOfDraft`. They must not change the behaviour. Keep the messages verbatim.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @relay/web -- calendarController`
Expected: PASS (12 tests).

- [ ] **Step 5: Run the suites, typecheck and lint, then commit**

Run: `npm test && npm run typecheck && npm run lint`

```bash
git add apps/web/src/calendar/calendarController.ts apps/web/src/board/controller.ts apps/web/test/calendarController.test.ts
git commit -m "feat(web): calendar controller — navigation, editor drafts, series questions, move/resize/delete, RSVP"
```

---
### Task 8: Calendar page, month and week views, keys, and the "+" menu

**Files:**
- Create in `apps/web/src/calendar/`:
  - `CalendarPage.tsx`
  - `CalendarHeader.tsx`
  - `MonthView.tsx`
  - `WeekView.tsx`
  - `useCalendarKeys.ts`
- Modify:
  - `apps/web/src/calendar/layout.ts`: add `periodTitle`, `timeLabel` and `WEEKDAY_SHORT`.
  - `apps/web/src/board/Board.tsx`: the calendar branch.
  - `apps/web/src/ui/PageTabs.tsx`: enable Calendar.
  - `apps/web/src/ui/pageKind.ts`: `onCalendarPage`.
- Test:
  - `apps/web/test/calendarLayout.test.ts`: extend it.
  - `apps/web/test/calendarKeys.test.ts`: new.

**Interfaces:**
- Consumes:
  - From Task 7:
    - `createCalendarController`, `CalendarController`, `OccRef`;
    - the controller's `visible`, `step`, `today`, `setView`, `select`, `newEvent`, `openEditor`, `move`, `resize`, `remove`.
  - From Task 6: `monthGrid`, `firstOfGrid`, `weekDates`, `monthLayout`, `weekLayout`, `HOUR_PX`, `SNAP_MIN`, `MONTH_LINES`.
  - From core: `viewerZone`, `todayIn`, `toWall`.
  - From the board session: `BoardSession` with `calendar`, `controller.commit`, `controller.commitSession`, `publisher.setCalEvent`, `user`.
- Produces:
  - `periodTitle(view, anchor): string`. Examples:
    - month: `'September 2026'`
    - week within a month: `'21 – 27 Sep 2026'`
    - week across two months: `'28 Sep – 4 Oct 2026'`
    - week across two years: `'29 Dec 2025 – 4 Jan 2026'`
  - `timeLabel(minutes): string` returns `'HH:mm'`.
  - `WEEKDAY_SHORT` is `['Mon', …, 'Sun']`.
  - `calendarKey(e): CalendarKeyAction | null`, where `CalendarKeyAction` is one of `'today' | 'month' | 'week' | 'prev' | 'next' | 'new' | 'open' | 'delete' | 'deselect' | 'undo' | 'redo'`.
  - `onCalendarPage(session)`.
  - `CalendarPage({ session })` renders:
    - the page container `data-testid="calendar-page"`;
    - in the header: `cal-prev`, `cal-today`, `cal-next`, `cal-title`, `cal-view-month`, `cal-view-week` (both `aria-pressed`), `cal-new` (editors only) and `cal-zone` ("Times in <zone>");
    - `cal-truncated` ("Showing the first 1000 events");
    - month cells `cal-day` with `data-date`;
    - events `cal-event` with `data-event-id`, `data-key` and `data-selected`;
    - `cal-more` ("+N more") and `cal-day-popover`;
    - in the week view: `cal-week-col` with `data-date`, the resize handle `cal-resize`, the drag preview `cal-drag-preview`, and the now line `cal-now`.
  - An `editor` or `question` state from the controller is not rendered yet; Task 9 adds that.

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/test/calendarLayout.test.ts`, adding `periodTitle` and `timeLabel` to the import from `'../src/calendar/layout'`:

```ts
describe('titles and labels', () => {
  it('names the period in en-GB style', () => {
    expect(periodTitle('month', '2026-09-15')).toBe('September 2026');
    expect(periodTitle('week', '2026-09-24')).toBe('21 – 27 Sep 2026');
    expect(periodTitle('week', '2026-10-01')).toBe('28 Sep – 4 Oct 2026');
    expect(periodTitle('week', '2026-01-01')).toBe('29 Dec 2025 – 4 Jan 2026');
    expect(timeLabel(9 * 60 + 5)).toBe('09:05');
    expect(timeLabel(0)).toBe('00:00');
  });
});
```

```ts
// apps/web/test/calendarKeys.test.ts
import { describe, expect, it } from 'vitest';
import { calendarKey } from '../src/calendar/useCalendarKeys';

const k = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}) =>
  calendarKey({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, ...mods });

describe('calendar keys', () => {
  it('maps the calendar shortcuts', () => {
    expect(k('t')).toBe('today');
    expect(k('T')).toBe('today');
    expect(k('m')).toBe('month');
    expect(k('w')).toBe('week');
    expect(k('ArrowLeft')).toBe('prev');
    expect(k('ArrowRight')).toBe('next');
    expect(k('n')).toBe('new');
    expect(k('Enter')).toBe('open');
    expect(k('Delete')).toBe('delete');
    expect(k('Backspace')).toBe('delete');
    expect(k('Escape')).toBe('deselect');
    expect(k('z', { ctrlKey: true })).toBe('undo');
    expect(k('z', { metaKey: true, shiftKey: true })).toBe('redo');
    expect(k('y', { ctrlKey: true })).toBe('redo');
  });

  it('ignores other keys and modified letters', () => {
    expect(k('x')).toBeNull();
    expect(k('t', { ctrlKey: true })).toBeNull();
    expect(k('n', { altKey: true })).toBeNull();
    expect(k('ArrowLeft', { shiftKey: true })).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @relay/web -- calendarLayout calendarKeys`
Expected: FAIL. `periodTitle`, `timeLabel` and `calendarKey` do not exist.

- [ ] **Step 3: Write the implementation**

Append to `apps/web/src/calendar/layout.ts`:

```ts
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const MON = MONTHS.map((m) => m.slice(0, 3));
export const WEEKDAY_SHORT = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export const timeLabel = (minutes: number): string =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

/** The header title: "September 2026", or a week such as "28 Sep – 4 Oct 2026" (en-GB). */
export function periodTitle(view: 'month' | 'week', anchor: string): string {
  const a = dateOf(anchor);
  if (view === 'month') return `${MONTHS[a.m - 1]} ${a.y}`;
  const days = weekDates(anchor);
  const s = dateOf(days[0] as string);
  const e = dateOf(days[6] as string);
  if (s.y !== e.y) return `${s.d} ${MON[s.m - 1]} ${s.y} – ${e.d} ${MON[e.m - 1]} ${e.y}`;
  if (s.m !== e.m) return `${s.d} ${MON[s.m - 1]} – ${e.d} ${MON[e.m - 1]} ${e.y}`;
  return `${s.d} – ${e.d} ${MON[e.m - 1]} ${e.y}`;
}
```

```ts
// apps/web/src/calendar/useCalendarKeys.ts
import { useEffect } from 'react';
import type { BoardSession } from '../board/session';
import { isTyping } from '../ui/typing';
import type { CalendarController } from './calendarController';

export type CalendarKeyAction =
  | 'today' | 'month' | 'week' | 'prev' | 'next' | 'new' | 'open' | 'delete' | 'deselect' | 'undo' | 'redo';

type KeyLike = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'metaKey' | 'shiftKey' | 'altKey'>;

/** The calendar action a key press means, or null. */
export function calendarKey(e: KeyLike): CalendarKeyAction | null {
  if (e.ctrlKey || e.metaKey) {
    const k = e.key.toLowerCase();
    if (k === 'z') return e.shiftKey ? 'redo' : 'undo';
    if (k === 'y') return 'redo';
    return null;
  }
  if (e.altKey || e.shiftKey) return null;
  switch (e.key) {
    case 'ArrowLeft':
      return 'prev';
    case 'ArrowRight':
      return 'next';
    case 'Enter':
      return 'open';
    case 'Delete':
    case 'Backspace':
      return 'delete';
    case 'Escape':
      return 'deselect';
  }
  switch (e.key.toLowerCase()) {
    case 't':
      return 'today';
    case 'm':
      return 'month';
    case 'w':
      return 'week';
    case 'n':
      return 'new';
  }
  return null;
}

/** Focus is on a control whose own keys (Enter, arrows) must keep their native meaning. */
const onControl = (t: EventTarget | null) =>
  t instanceof Element && t.closest('button, select, a[href], [role="menuitem"], [role="dialog"]') !== null;

/** Calendar shortcuts on a calendar page (dialogs stop their own keys). */
export function useCalendarKeys(session: BoardSession, ctl: CalendarController) {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target) || onControl(e.target)) return;
      const { editor, question, selected } = ctl.ui.getState();
      if (editor || question) return;
      const action = calendarKey(e);
      if (!action) return;
      const canEdit = session.conn.clock.getState().role === 'edit';
      e.preventDefault();
      switch (action) {
        case 'today':
          return ctl.today();
        case 'month':
          return ctl.setView('month');
        case 'week':
          return ctl.setView('week');
        case 'prev':
          return ctl.step(-1);
        case 'next':
          return ctl.step(1);
        case 'new':
          return ctl.newEvent();
        case 'open':
          if (selected) ctl.openEditor(selected);
          return;
        case 'delete':
          if (selected && canEdit) ctl.remove(selected);
          return;
        case 'deselect':
          return ctl.select(null);
        case 'undo':
          if (canEdit) session.controller.undo();
          return;
        case 'redo':
          if (canEdit) session.controller.redo();
          return;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [session, ctl]);
}
```

```tsx
// apps/web/src/calendar/CalendarPage.tsx
'use client';

import { viewerZone } from '@relay/core';
import { useEffect, useMemo, useState } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { toast } from '../ui/toasts';
import { CalendarHeader } from './CalendarHeader';
import { type CalendarController, createCalendarController } from './calendarController';
import { MonthView } from './MonthView';
import { useCalendarKeys } from './useCalendarKeys';
import { WeekView } from './WeekView';

export function CalendarPage({ session }: { session: BoardSession }) {
  const hasCalendar = useStore(session.calendar, (s) => s.calendar !== null);
  const [ctl, setCtl] = useState<CalendarController | null>(null);

  useEffect(() => {
    const c = createCalendarController({
      calendar: session.calendar,
      commit: session.controller.commit,
      commitSession: session.controller.commitSession,
      canEdit: () => session.conn.clock.getState().role === 'edit',
      notify: toast,
      user: session.user,
      zone: viewerZone(),
      now: () => Date.now(),
    });
    // Peers see which event this user has open.
    const unsubscribe = c.ui.subscribe((s, prev) => {
      const id = s.editor?.ref?.eventId ?? null;
      if (id !== (prev.editor?.ref?.eventId ?? null)) session.publisher.setCalEvent(id);
    });
    setCtl(c);
    return () => {
      unsubscribe();
      session.publisher.setCalEvent(null);
      c.destroy();
    };
  }, [session]);

  if (!ctl) return null;
  if (!hasCalendar) {
    return (
      <div data-testid="unsupported-page" className="grid h-full place-items-center px-4 text-center font-mono text-xs">
        This calendar could not be loaded.
      </div>
    );
  }
  return <CalendarBody session={session} ctl={ctl} />;
}

function CalendarBody({ session, ctl }: { session: BoardSession; ctl: CalendarController }) {
  useCalendarKeys(session, ctl);
  const view = useStore(ctl.ui, (s) => s.view);
  const anchor = useStore(ctl.ui, (s) => s.anchor);
  const calendar = useStore(session.calendar, (s) => s.calendar);
  // biome-ignore lint/correctness/useExhaustiveDependencies: recomputed when the calendar or the period changes
  const { occurrences, truncated } = useMemo(() => ctl.visible(), [ctl, calendar, view, anchor]);
  return (
    <div data-testid="calendar-page" className="flex h-full min-h-0 flex-col">
      <CalendarHeader session={session} ctl={ctl} />
      {truncated && (
        <p data-testid="cal-truncated" className="border-b-2 border-ink bg-sun px-3 py-1 font-mono text-xs">
          Showing the first 1000 events
        </p>
      )}
      {view === 'month' ? (
        <MonthView session={session} ctl={ctl} occurrences={occurrences} />
      ) : (
        <WeekView session={session} ctl={ctl} occurrences={occurrences} />
      )}
    </div>
  );
}
```

```tsx
// apps/web/src/calendar/CalendarHeader.tsx
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import type { CalendarController } from './calendarController';
import { periodTitle } from './layout';

const btn = 'grid h-8 place-items-center border-2 border-ink bg-white px-2 font-mono text-xs uppercase hover:bg-paper';

export function CalendarHeader({ session, ctl }: { session: BoardSession; ctl: CalendarController }) {
  const view = useStore(ctl.ui, (s) => s.view);
  const anchor = useStore(ctl.ui, (s) => s.anchor);
  const canEdit = useStore(session.conn.clock, (c) => c.role === 'edit');
  return (
    <div className="flex flex-wrap items-center gap-2 border-b-2 border-ink bg-white px-3 py-2">
      <button type="button" data-testid="cal-prev" aria-label="Previous" className={btn} onClick={() => ctl.step(-1)}>
        <ChevronLeft size={14} />
      </button>
      <button type="button" data-testid="cal-today" className={btn} onClick={() => ctl.today()}>
        Today
      </button>
      <button type="button" data-testid="cal-next" aria-label="Next" className={btn} onClick={() => ctl.step(1)}>
        <ChevronRight size={14} />
      </button>
      <h2 data-testid="cal-title" className="min-w-40 font-display text-base">
        {periodTitle(view, anchor)}
      </h2>
      <div className="flex">
        {(['month', 'week'] as const).map((v) => (
          <button
            key={v}
            type="button"
            data-testid={`cal-view-${v}`}
            aria-pressed={view === v}
            className={`${btn} ${view === v ? 'bg-sun' : ''} -ml-0.5 first:ml-0`}
            onClick={() => ctl.setView(v)}
          >
            {v === 'month' ? 'Month' : 'Week'}
          </button>
        ))}
      </div>
      <span data-testid="cal-zone" className="font-mono text-[11px] text-ink/60">
        Times in {ctl.zone}
      </span>
      <div className="ml-auto flex items-center gap-2">
        {canEdit && (
          <button type="button" data-testid="cal-new" className={`${btn} bg-sun`} onClick={() => ctl.newEvent()}>
            <span className="flex items-center gap-1">
              <Plus size={12} /> New event
            </span>
          </button>
        )}
      </div>
    </div>
  );
}
```

```tsx
// apps/web/src/calendar/MonthView.tsx
import { type Occurrence, parseDate, todayIn, toWall } from '@relay/core';
import { useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import type { CalendarController, OccRef } from './calendarController';
import { firstOfGrid, MONTH_LINES, monthGrid, monthLayout, timeLabel, WEEKDAY_SHORT } from './layout';

const LINE = 20;
const HEAD = 22;

/** Pointer gestures on an event: a click selects, a drag onto another day moves it. */
export function useEventDrag(ctl: CalendarController, canEdit: boolean) {
  const drag = useRef<{ ref: OccRef; x: number; y: number; moved: boolean } | null>(null);
  const onPointerDown = (ref: OccRef) => (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    drag.current = { ref, x: e.clientX, y: e.clientY, moved: false };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4) d.moved = true;
  };
  const onPointerUp = (e: React.PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d) return;
    if (!d.moved) {
      ctl.select(d.ref);
      return;
    }
    if (!canEdit) return;
    const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-date]');
    const date = target?.dataset.date;
    if (date) ctl.move(d.ref, { date });
  };
  return { onPointerDown, onPointerMove, onPointerUp };
}

export function MonthView({
  session,
  ctl,
  occurrences,
}: {
  session: BoardSession;
  ctl: CalendarController;
  occurrences: Occurrence[];
}) {
  const anchor = useStore(ctl.ui, (s) => s.anchor);
  const selected = useStore(ctl.ui, (s) => s.selected);
  const canEdit = useStore(session.conn.clock, (c) => c.role === 'edit');
  const [popover, setPopover] = useState<string | null>(null);
  const a = parseDate(anchor) ?? { y: 1970, m: 1, d: 1 };
  const cells = monthGrid(a.y, a.m, todayIn(Date.now(), ctl.zone));
  const layout = useMemo(() => monthLayout(occurrences, firstOfGrid(a.y, a.m), ctl.zone), [occurrences, a.y, a.m, ctl.zone]);
  const drag = useEventDrag(ctl, canEdit);
  const isSel = (o: Occurrence) => selected?.eventId === o.eventId && selected.key === o.key;
  const eventProps = (o: Occurrence) => ({
    'data-testid': 'cal-event',
    'data-event-id': o.eventId,
    'data-key': o.key,
    'data-selected': isSel(o) ? 'true' : undefined,
    title: o.title,
    onPointerDown: drag.onPointerDown({ eventId: o.eventId, key: o.key }),
    onPointerMove: drag.onPointerMove,
    onPointerUp: drag.onPointerUp,
    onDoubleClick: () => ctl.openEditor({ eventId: o.eventId, key: o.key }),
  });
  const dayItems = (index: number) => {
    const date = cells[index]?.date;
    return occurrences.filter((o) => {
      const s = o.when.allDay ? o.when.start : null;
      const e = o.when.allDay ? o.when.end : null;
      if (s && e && date) return s <= date && date <= e;
      return layout.days[index]?.chips.includes(o) || false;
    });
  };
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid grid-cols-7 border-b-2 border-ink bg-paper font-mono text-[11px] uppercase">
        {WEEKDAY_SHORT.map((d) => (
          <div key={d} className="px-2 py-1">
            {d}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1 grid-rows-6">
        {[0, 1, 2, 3, 4, 5].map((row) => (
          <div key={row} className="relative grid grid-cols-7 border-b border-ink/20">
            {cells.slice(row * 7, row * 7 + 7).map((cell, col) => {
              const index = row * 7 + col;
              const day = layout.days[index] ?? { chips: [], more: 0 };
              const reserved = Math.min(layout.rowLanes[row] ?? 0, MONTH_LINES);
              return (
                // biome-ignore lint/a11y/noStaticElementInteractions: a day cell is a click target for creating an event
                // biome-ignore lint/a11y/useKeyWithClickEvents: keyboard users create events with N
                <div
                  key={cell.date}
                  data-testid="cal-day"
                  data-date={cell.date}
                  className={`relative min-h-0 overflow-hidden border-r border-ink/20 px-1 ${cell.inMonth ? 'bg-white' : 'bg-paper text-ink/40'}`}
                  onClick={(e) => {
                    if (e.target === e.currentTarget && canEdit) ctl.newEvent({ date: cell.date });
                  }}
                >
                  <span className={`font-mono text-[11px] ${cell.today ? 'bg-flame px-1 text-white' : ''}`}>{cell.day}</span>
                  <div style={{ marginTop: reserved * LINE }} className="flex flex-col gap-0.5">
                    {day.chips.map((o) => (
                      <div
                        key={`${o.eventId}:${o.key}`}
                        {...eventProps(o)}
                        className={`truncate px-1 font-mono text-[11px] ${isSel(o) ? 'outline outline-2 outline-ink' : ''}`}
                        style={{ height: LINE - 2, borderLeft: `4px solid ${o.color}` }}
                      >
                        {o.when.allDay ? '' : `${timeLabel(minutesOfDay(o.start, ctl.zone))} `}
                        {o.title}
                      </div>
                    ))}
                    {day.more > 0 && (
                      <button
                        type="button"
                        data-testid="cal-more"
                        className="text-left font-mono text-[11px] underline"
                        onClick={() => setPopover(cell.date)}
                      >
                        +{day.more} more
                      </button>
                    )}
                  </div>
                  {popover === cell.date && (
                    <div
                      data-testid="cal-day-popover"
                      className="absolute left-0 top-0 z-20 w-56 border-2 border-ink bg-white p-2 shadow-hard"
                    >
                      <div className="mb-1 flex justify-between font-mono text-xs">
                        <span>{cell.date}</span>
                        <button type="button" aria-label="Close" onClick={() => setPopover(null)}>
                          ×
                        </button>
                      </div>
                      {dayItems(index).map((o) => (
                        <div key={`${o.eventId}:${o.key}`} {...eventProps(o)} className="truncate font-mono text-[11px]" style={{ borderLeft: `4px solid ${o.color}`, paddingLeft: 4 }}>
                          {o.title}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {layout.bars
              .filter((b) => b.row === row)
              .map((b) => (
                <div
                  key={`${b.occ.eventId}:${b.occ.key}:${row}`}
                  {...eventProps(b.occ)}
                  className={`absolute truncate px-1 font-mono text-[11px] text-white ${isSel(b.occ) ? 'outline outline-2 outline-ink' : ''}`}
                  style={{
                    top: HEAD + b.lane * LINE,
                    height: LINE - 2,
                    left: `calc(${(b.startCol / 7) * 100}% + 2px)`,
                    width: `calc(${((b.endCol - b.startCol + 1) / 7) * 100}% - 4px)`,
                    background: b.occ.color,
                    color: b.occ.color === '#F5D547' ? '#111111' : '#FFFFFF',
                  }}
                >
                  {b.occ.title}
                </div>
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function minutesOfDay(ms: number, zone: string): number {
  const w = toWall(ms, zone);
  return w.hh * 60 + w.mm;
}
```

```tsx
// apps/web/src/calendar/WeekView.tsx
import { type Occurrence, parseDate, todayIn, toWall } from '@relay/core';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import type { CalendarController, OccRef } from './calendarController';
import { HOUR_PX, SNAP_MIN, timeLabel, WEEKDAY_SHORT, weekDates, weekLayout } from './layout';
import { useEventDrag } from './MonthView';

type Gesture =
  | { kind: 'create'; date: string; from: number; to: number }
  | { kind: 'move'; ref: OccRef; offset: number; length: number; date: string; top: number; moved: boolean }
  | { kind: 'resize'; ref: OccRef; date: string; top: number; bottom: number };

const snap = (m: number) => Math.max(0, Math.min(24 * 60, Math.round(m / SNAP_MIN) * SNAP_MIN));

function minutesAt(clientY: number, column: Element): number {
  const r = column.getBoundingClientRect();
  return snap(((clientY - r.top) / HOUR_PX) * 60);
}

const columnAt = (x: number, y: number) =>
  document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-testid="cal-week-col"]') ?? null;

export function WeekView({
  session,
  ctl,
  occurrences,
}: {
  session: BoardSession;
  ctl: CalendarController;
  occurrences: Occurrence[];
}) {
  const anchor = useStore(ctl.ui, (s) => s.anchor);
  const selected = useStore(ctl.ui, (s) => s.selected);
  const canEdit = useStore(session.conn.clock, (c) => c.role === 'edit');
  const days = useMemo(() => weekDates(anchor), [anchor]);
  const layout = useMemo(() => weekLayout(occurrences, days, ctl.zone), [occurrences, days, ctl.zone]);
  const scroller = useRef<HTMLDivElement>(null);
  const [gesture, setGesture] = useState<Gesture | null>(null);
  const today = todayIn(Date.now(), ctl.zone);
  const now = toWall(Date.now(), ctl.zone);
  const allDayDrag = useEventDrag(ctl, canEdit);

  useEffect(() => {
    if (scroller.current) scroller.current.scrollTop = 8 * HOUR_PX;
  }, []);

  const finish = (e: React.PointerEvent) => {
    const g = gesture;
    setGesture(null);
    if (!g) return;
    if (g.kind === 'create') {
      const from = Math.min(g.from, g.to);
      const to = Math.max(g.from, g.to);
      ctl.newEvent({ date: g.date, start: from, end: to > from ? to : from + 60 });
    } else if (g.kind === 'move') {
      if (!g.moved) ctl.select(g.ref);
      else ctl.move(g.ref, { date: g.date, minutes: g.top });
    } else ctl.resize(g.ref, { date: g.date, minutes: g.bottom });
    e.stopPropagation();
  };

  const isSel = (o: Occurrence) => selected?.eventId === o.eventId && selected.key === o.key;
  const lanes = Math.max(1, layout.allDayLanes);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="grid border-b-2 border-ink bg-paper font-mono text-[11px]" style={{ gridTemplateColumns: '56px repeat(7, 1fr)' }}>
        <div />
        {days.map((d, i) => (
          <div key={d} className={`px-2 py-1 uppercase ${d === today ? 'bg-sun' : ''}`}>
            {WEEKDAY_SHORT[i]} {parseDate(d)?.d}
          </div>
        ))}
      </div>
      <div className="relative grid border-b-2 border-ink bg-white" style={{ gridTemplateColumns: '56px repeat(7, 1fr)', height: lanes * 20 + 4 }}>
        <div className="px-1 font-mono text-[10px] text-ink/60">all-day</div>
        {days.map((d) => (
          <div key={d} data-date={d} className="border-l border-ink/20" />
        ))}
        {layout.allDay.map((s) => (
          <div
            key={`${s.occ.eventId}:${s.occ.key}`}
            data-testid="cal-event"
            data-event-id={s.occ.eventId}
            data-key={s.occ.key}
            data-selected={isSel(s.occ) ? 'true' : undefined}
            onPointerDown={allDayDrag.onPointerDown({ eventId: s.occ.eventId, key: s.occ.key })}
            onPointerMove={allDayDrag.onPointerMove}
            onPointerUp={allDayDrag.onPointerUp}
            onDoubleClick={() => ctl.openEditor({ eventId: s.occ.eventId, key: s.occ.key })}
            className={`absolute truncate px-1 font-mono text-[11px] ${isSel(s.occ) ? 'outline outline-2 outline-ink' : ''}`}
            style={{
              top: 2 + s.lane * 20,
              height: 18,
              left: `calc(56px + (100% - 56px) * ${s.startCol / 7} + 2px)`,
              width: `calc((100% - 56px) * ${(s.endCol - s.startCol + 1) / 7} - 4px)`,
              background: s.occ.color,
              color: s.occ.color === '#F5D547' ? '#111111' : '#FFFFFF',
            }}
          >
            {s.occ.title}
          </div>
        ))}
      </div>
      <div ref={scroller} className="relative min-h-0 flex-1 overflow-y-auto">
        <div className="grid" style={{ gridTemplateColumns: '56px repeat(7, 1fr)', height: 24 * HOUR_PX }}>
          <div className="relative">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="absolute right-1 font-mono text-[10px] text-ink/60" style={{ top: h * HOUR_PX - 6 }}>
                {h > 0 ? timeLabel(h * 60) : ''}
              </div>
            ))}
          </div>
          {days.map((date, day) => (
            // biome-ignore lint/a11y/noStaticElementInteractions: the time grid is a drag surface; keyboard users create with N
            <div
              key={date}
              data-testid="cal-week-col"
              data-date={date}
              className="relative border-l border-ink/20"
              style={{ backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, rgba(17,17,17,0.12) ${HOUR_PX - 1}px, rgba(17,17,17,0.12) ${HOUR_PX}px)` }}
              onPointerDown={(e) => {
                if (e.button !== 0 || e.target !== e.currentTarget || !canEdit) return;
                const m = minutesAt(e.clientY, e.currentTarget);
                e.currentTarget.setPointerCapture(e.pointerId);
                setGesture({ kind: 'create', date, from: m, to: m });
              }}
              onPointerMove={(e) => {
                if (gesture?.kind === 'create' && gesture.date === date) setGesture({ ...gesture, to: minutesAt(e.clientY, e.currentTarget) });
              }}
              onPointerUp={finish}
            >
              {layout.boxes
                .filter((b) => b.day === day)
                .map((b) => {
                  const ref = { eventId: b.occ.eventId, key: b.occ.key };
                  return (
                    <div
                      key={`${b.occ.eventId}:${b.occ.key}`}
                      data-testid="cal-event"
                      data-event-id={b.occ.eventId}
                      data-key={b.occ.key}
                      data-selected={isSel(b.occ) ? 'true' : undefined}
                      className={`absolute overflow-hidden border border-ink px-1 font-mono text-[11px] ${isSel(b.occ) ? 'outline outline-2 outline-ink' : ''}`}
                      style={{
                        top: (b.top / 60) * HOUR_PX,
                        height: Math.max(12, (b.height / 60) * HOUR_PX - 1),
                        left: `${(b.col / b.cols) * 100}%`,
                        width: `${100 / b.cols}%`,
                        background: b.occ.color,
                        color: b.occ.color === '#F5D547' ? '#111111' : '#FFFFFF',
                      }}
                      onPointerDown={(e) => {
                        if (e.button !== 0) return;
                        e.stopPropagation();
                        const col = e.currentTarget.parentElement;
                        if (!col) return;
                        e.currentTarget.setPointerCapture(e.pointerId);
                        if ((e.target as HTMLElement).dataset.resize) {
                          setGesture({ kind: 'resize', ref, date, top: b.top, bottom: b.top + b.height });
                          return;
                        }
                        setGesture({ kind: 'move', ref, offset: minutesAt(e.clientY, col) - b.top, length: b.height, date, top: b.top, moved: false });
                      }}
                      onPointerMove={(e) => {
                        if (!gesture || gesture.kind === 'create' || !canEdit) return;
                        const colEl = columnAt(e.clientX, e.clientY);
                        if (!colEl) return;
                        const m = minutesAt(e.clientY, colEl);
                        if (gesture.kind === 'resize') setGesture({ ...gesture, bottom: Math.max(gesture.top + SNAP_MIN, m) });
                        else {
                          const top = snap(m - gesture.offset);
                          const target = colEl.dataset.date ?? gesture.date;
                          if (top !== gesture.top || target !== gesture.date) setGesture({ ...gesture, top, date: target, moved: true });
                        }
                      }}
                      onPointerUp={finish}
                      onDoubleClick={() => ctl.openEditor(ref)}
                    >
                      <div className="font-bold">{b.occ.title}</div>
                      <div>{timeLabel(b.top)}</div>
                      {canEdit && (
                        <div data-testid="cal-resize" data-resize="1" className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize" />
                      )}
                    </div>
                  );
                })}
              {gesture && gesture.kind !== 'create' && gesture.date === date && (gesture.kind === 'resize' || gesture.moved) && (
                <div
                  data-testid="cal-drag-preview"
                  className="pointer-events-none absolute inset-x-0 border-2 border-dashed border-ink bg-ink/10"
                  style={
                    gesture.kind === 'resize'
                      ? { top: (gesture.top / 60) * HOUR_PX, height: ((gesture.bottom - gesture.top) / 60) * HOUR_PX }
                      : { top: (gesture.top / 60) * HOUR_PX, height: (gesture.length / 60) * HOUR_PX }
                  }
                />
              )}
              {gesture?.kind === 'create' && gesture.date === date && (
                <div
                  data-testid="cal-drag-preview"
                  className="pointer-events-none absolute inset-x-0 border-2 border-dashed border-ink bg-sun/40"
                  style={{
                    top: (Math.min(gesture.from, gesture.to) / 60) * HOUR_PX,
                    height: (Math.max(SNAP_MIN, Math.abs(gesture.to - gesture.from)) / 60) * HOUR_PX,
                  }}
                />
              )}
              {date === today && (
                <div data-testid="cal-now" className="pointer-events-none absolute inset-x-0 h-0.5 bg-flame" style={{ top: ((now.hh * 60 + now.mm) / 60) * HOUR_PX }} />
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
```

The week-view box keeps pointer capture during a move, so `onPointerMove` finds the column under the pointer with `elementFromPoint`, and the drop day follows the pointer across columns.

Other changes:
- **`apps/web/src/ui/pageKind.ts`:** add
  ```ts
  /** Calendar shortcuts act only on calendar pages. */
  export const onCalendarPage = (session: BoardSession): boolean => {
    const { activePage, pages } = session.doc.getState();
    return pages.find((p) => p.id === activePage)?.type === 'calendar';
  };
  ```
  `useCalendarKeys` is mounted only inside `CalendarPage`, so it needs no gate. Export `onCalendarPage` for Task 10's clipboard and menus.
- **`apps/web/src/ui/PageTabs.tsx`:** replace the disabled "Calendar (soon)" entry with `{ label: 'Calendar', testId: 'page-add-calendar', onSelect: () => add('calendar') }`.
- **`apps/web/src/board/Board.tsx`:** import `CalendarPage`, and add a branch after the sheet branch:
  ```tsx
  ) : type === 'calendar' ? (
    <div className="relative min-h-0 flex-1">
      <CalendarPage session={session} />
      <StatusBanner session={session} />
    </div>
  ```
- **`e2e/pages.spec.ts`:** if an existing assertion expects `page-add-calendar` to be disabled, update it to expect the item enabled. Grep for `page-add-calendar` first.

- [ ] **Step 4: Run the tests, then check the views in a browser**

Run: `npm test -w @relay/web -- calendarLayout calendarKeys`
Expected: PASS.

Then write a throwaway spec, `e2e/zz-scratch-calendar.spec.ts`. It must:
- open a new room;
- click `page-add` → `page-add-calendar`;
- assert that `calendar-page` and 42 `cal-day` cells are visible;
- click `cal-view-week` and assert 7 `cal-week-col`;
- drag from 09:00 to 10:00 in the first column and assert that a `cal-drag-preview` appeared during the drag. The controller now has `editor` set, but nothing renders it until Task 9, so do not assert a dialog;
- press `ArrowRight` and assert that `cal-title` changed;
- take a screenshot of each view to `C:/Users/carme/AppData/Local/Temp/claude/C--Users-Juank-Proyectos/2dd509be-3e46-42bf-8a9f-cb3ad2339df8/scratchpad/`.

Run it with `npx playwright test e2e/zz-scratch-calendar.spec.ts`, then look at the screenshots. Delete the spec before committing.

- [ ] **Step 5: Run the suites, typecheck, lint and the web build, then commit**

Run: `npm test && npm run typecheck && npm run lint && npm run build -w @relay/web && npx playwright test e2e/pages.spec.ts`

```bash
git add apps/web/src/calendar apps/web/src/board/Board.tsx apps/web/src/ui/PageTabs.tsx apps/web/src/ui/pageKind.ts apps/web/test/calendarLayout.test.ts apps/web/test/calendarKeys.test.ts e2e/pages.spec.ts
git commit -m "feat(web): calendar page — month and week views, drag to create/move/resize, keys, + menu"
```

---
### Task 9: Event editor, series question, RSVP, peer dots and "Open on board"

**Files:**
- Create, in `apps/web/src/calendar/`:
  - `EventEditor.tsx`
  - `SeriesDialog.tsx`
  - `rsvp.ts`
  - `EventDots.tsx`
- Modify:
  - `apps/web/src/calendar/CalendarPage.tsx`: mount the editor and the series dialog.
  - `apps/web/src/calendar/MonthView.tsx` and `apps/web/src/calendar/WeekView.tsx`: render `EventDots` inside each event.
  - `apps/web/src/board/controller.ts`: `revealShape`.
- Test:
  - `apps/web/test/calendarRsvp.test.ts`
  - `apps/web/test/calendarReveal.test.ts`

**Interfaces:**
- Consumes:
  - From Task 7: `EditorDraft`, `EditorState`, `SeriesQuestion`, and the controller's `save`, `closeEditor`, `remove`, `answer`, `rsvp`, `resolve`.
  - From core: `EVENT_COLORS`, `Rsvp`, `RsvpStatus`, `whenRange`.
  - From the board: `Dialog` (`apps/web/src/ui/Dialog.tsx`) and `session.presence` (peers with `page` and `calEvent`).
- Produces:
  - `rsvpSummary(rsvp: Record<string, Rsvp>): { yes: string[]; maybe: string[]; no: string[] }`. Names are sorted, and an empty name reads as `'Someone'`.
  - `BoardController.revealShape(pageId: string, shapeId: string): boolean`:
    - It switches to the page, selects the shape and centres the camera on it.
    - It returns false, and does nothing, when the page is not visible or the shape is missing.
    - When the canvas has not been measured yet, it centres as soon as the viewport is known.
  - Test ids:
    - Editor: `cal-editor`, `cal-title-input`, `cal-allday`, `cal-start-date`, `cal-start-time`, `cal-end-date`, `cal-end-time`, `cal-repeat`, `cal-interval`, `cal-byday-0` … `cal-byday-6`, `cal-ends`, `cal-until`, `cal-count`, `cal-color-0` … `cal-color-3`, `cal-notes`, `cal-event-zone`, `cal-save`, `cal-delete`, `cal-cancel`.
    - RSVP: `cal-rsvp`, `cal-rsvp-summary`, `cal-rsvp-yes`, `cal-rsvp-maybe`, `cal-rsvp-no`.
    - Link: `cal-open-board`.
    - Series dialog: `cal-series`, `cal-series-one`, `cal-series-all`, `cal-series-cancel`, `cal-series-drops`.
    - Peer dots: `cal-event-dots`.
- Copy, verbatim:
  - Dialog titles: "New event", "Edit event", "Event".
  - Series dialog title: "Repeating event".
  - Series question for save and move: "Change only this event, or all events in the series?"
  - Series question for delete: "Delete only this event, or all events in the series?"
  - Series warning: "Changing all events clears N changed occurrence(s)." Use "occurrence" when N = 1.
  - RSVP buttons: "Going", "Maybe", "Not going".
  - RSVP summary: "N going · N maybe · N not going".
  - Link labels: "Open on board" and "Sticky deleted".

- [ ] **Step 1: Write the failing tests**

```ts
// apps/web/test/calendarRsvp.test.ts
import { describe, expect, it } from 'vitest';
import { rsvpSummary } from '../src/calendar/rsvp';

describe('rsvpSummary', () => {
  it('groups answers by status with sorted names', () => {
    expect(
      rsvpSummary({
        u1: { status: 'yes', name: 'Zoe' },
        u2: { status: 'yes', name: 'Ana' },
        u3: { status: 'maybe', name: '' },
        u4: { status: 'no', name: 'Bo' },
      }),
    ).toEqual({ yes: ['Ana', 'Zoe'], maybe: ['Someone'], no: ['Bo'] });
    expect(rsvpSummary({})).toEqual({ yes: [], maybe: [], no: [] });
  });
});
```

```ts
// apps/web/test/calendarReveal.test.ts
import { applyCommand } from '@relay/core';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import { createBoardController } from '../src/board/controller';
import { createActivityStore } from '../src/store/activityStore';
import { createDocStore } from '../src/store/docStore';

function setup() {
  const doc = new Y.Doc();
  const docs = createDocStore(doc);
  const activity = createActivityStore(doc);
  const board = createBoardController({
    doc,
    docStore: docs.store,
    setPage: docs.setPage,
    activity: activity.store,
    user: { id: 'u1', name: 'Brisk Otter', color: '#E85A1B' },
  });
  return { doc, docs, board };
}

describe('revealShape', () => {
  it('switches to the page, selects the shape and centres it once the viewport is known', () => {
    const { doc, docs, board } = setup();
    applyCommand(doc, {
      type: 'CreateShape',
      shape: {
        id: 's1',
        type: 'sticky',
        x: 1000,
        y: 2000,
        w: 180,
        h: 140,
        style: { fill: '#F5D547', stroke: '#111111', font: 'sans' },
        createdBy: 'u1',
        authorName: 'B',
        createdAt: 0,
      },
    });
    const cal = board.createPage('calendar');
    board.setPage(cal);
    expect(board.revealShape('main', 's1')).toBe(true);
    expect(docs.store.getState().activePage).toBe('main');
    expect(board.ui.getState().tool.selection).toEqual(['s1']);
    board.setViewportSize(800, 600);
    const { camera } = board.ui.getState();
    // The sticky's centre (1090, 2070) is at the viewport centre (400, 300).
    expect((1090 + camera.x) * camera.zoom).toBeCloseTo(400);
    expect((2070 + camera.y) * camera.zoom).toBeCloseTo(300);
  });

  it('refuses a missing shape or page', () => {
    const { board } = setup();
    expect(board.revealShape('main', 'ghost')).toBe(false);
    expect(board.revealShape('nope', 'ghost')).toBe(false);
  });
});
```

In the test above, the `CreateShape` payload must match the real `NewShape` type. Read `packages/core/src/schema/types.ts` and adjust the field list if needed, keeping the position and size shown.

`setViewportSize(w, h)` is the controller's existing method for the measured canvas size. Apply the pending centre inside it, right where it already runs the initial fit.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @relay/web -- calendarRsvp calendarReveal`
Expected: FAIL. `rsvp.ts` and `revealShape` do not exist.

- [ ] **Step 3: Write the implementation**

```ts
// apps/web/src/calendar/rsvp.ts
import type { Rsvp } from '@relay/core';

export function rsvpSummary(rsvp: Record<string, Rsvp>): { yes: string[]; maybe: string[]; no: string[] } {
  const out = { yes: [] as string[], maybe: [] as string[], no: [] as string[] };
  for (const r of Object.values(rsvp)) out[r.status].push(r.name.trim() || 'Someone');
  for (const list of Object.values(out)) list.sort((a, b) => a.localeCompare(b));
  return out;
}
```

`revealShape` goes in `apps/web/src/board/controller.ts`. Add it to the `BoardController` interface with this doc comment:

```ts
/** Switches to `pageId`, selects the shape and centres it; false when either is missing. */
revealShape(pageId: string, shapeId: string): boolean;
```

The implementation uses the controller's existing `setPage`, `setSelection` and `centerOn`, and `centerOf` from core:

```ts
    revealShape(pageId, shapeId) {
      if (!opts.docStore.getState().pages.some((p) => p.id === pageId)) return false;
      opts.setPage(pageId);
      const shape = opts.docStore.getState().shapes[shapeId];
      if (!shape) return false;
      setSelection([shapeId]);
      const centre = { x: shape.x + shape.w / 2, y: shape.y + shape.h / 2 };
      if (ui.getState().viewport) api.centerOn(centre);
      else pendingCentre = centre;
      return true;
    },
```

Here `api` is the returned object. If the file returns a literal, assign it to a `const` first, or call the internal `centerOn` helper directly.

Add `let pendingCentre: Point | null = null;` near the other `let`s, and apply it in `setViewportSize`, after its existing `tryFit()` call:

```ts
if (pendingCentre) {
  const c = pendingCentre;
  pendingCentre = null;
  <centre on c>;
}
```

A page change made by the user in between must not keep a stale centre, so reset `pendingCentre = null` in the page-change handler. A `setPage` triggered by `revealShape` itself runs before `pendingCentre` is set, so the reset does not cancel it.

Because `opts.setPage` resets the UI state for the new page synchronously, the selection must be set after `opts.setPage`, as shown.

```tsx
// apps/web/src/calendar/EventDots.tsx
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';

/** Up to 3 dots in the colours of peers who have this event open. */
export function EventDots({ session, eventId }: { session: BoardSession; eventId: string }) {
  const page = useStore(session.doc, (d) => d.activePage);
  const colors = useStore(session.presence, (p) =>
    p.peers
      .filter((peer) => (peer.page ?? 'main') === page && peer.calEvent === eventId)
      .slice(0, 3)
      .map((peer) => peer.user.color)
      .join(','),
  );
  if (!colors) return null;
  return (
    <span data-testid="cal-event-dots" className="absolute right-0.5 top-0.5 flex gap-0.5">
      {colors.split(',').map((c, i) => (
        <span key={`${c}${i}`} className="size-2 rounded-full border border-white" style={{ background: c }} />
      ))}
    </span>
  );
}
```

The colours are joined into a string so that the selector returns a primitive and does not re-render on every presence tick. Peer colours are validated hex values (`HEX_COLOR` in core presence), so rendering them in `style.background` is safe.

In `MonthView` and `WeekView`, render `<EventDots session={session} eventId={o.eventId} />` as the last child of every element with `data-testid="cal-event"`. Give those elements `relative` when they are not already absolutely positioned.

```tsx
// apps/web/src/calendar/SeriesDialog.tsx
import { useStore } from 'zustand';
import { Dialog } from '../ui/Dialog';
import type { CalendarController } from './calendarController';

const btn = 'border-2 border-ink px-3 py-1.5 font-mono text-xs uppercase';

export function SeriesDialog({ ctl }: { ctl: CalendarController }) {
  const q = useStore(ctl.ui, (s) => s.question);
  if (!q) return null;
  return (
    <Dialog title="Repeating event" onClose={() => ctl.answer(null)}>
      <div data-testid="cal-series" className="flex flex-col gap-3 font-mono text-xs">
        <p>
          {q.action === 'delete'
            ? 'Delete only this event, or all events in the series?'
            : 'Change only this event, or all events in the series?'}
        </p>
        {q.drops > 0 && (
          <p data-testid="cal-series-drops" className="border-2 border-flame px-2 py-1">
            Changing all events clears {q.drops} changed {q.drops === 1 ? 'occurrence' : 'occurrences'}.
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" data-testid="cal-series-cancel" className={`${btn} bg-white`} onClick={() => ctl.answer(null)}>
            Cancel
          </button>
          <button type="button" data-testid="cal-series-all" className={`${btn} bg-white`} onClick={() => ctl.answer('all')}>
            All events
          </button>
          <button type="button" data-testid="cal-series-one" className={`${btn} bg-sun`} onClick={() => ctl.answer('one')}>
            Only this event
          </button>
        </div>
      </div>
    </Dialog>
  );
}
```

```tsx
// apps/web/src/calendar/EventEditor.tsx
import { EVENT_COLORS, type RsvpStatus } from '@relay/core';
import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { Dialog } from '../ui/Dialog';
import type { CalendarController, EditorDraft } from './calendarController';
import { WEEKDAY_SHORT } from './layout';
import { rsvpSummary } from './rsvp';

const input = 'w-full border-2 border-ink bg-white px-2 py-1 font-mono text-xs disabled:bg-paper';
const label = 'flex flex-col gap-1 font-mono text-[11px] uppercase text-ink/70';
const btn = 'border-2 border-ink px-3 py-1.5 font-mono text-xs uppercase disabled:opacity-40';

export function EventEditor({ session, ctl }: { session: BoardSession; ctl: CalendarController }) {
  const editor = useStore(ctl.ui, (s) => s.editor);
  const calendar = useStore(session.calendar, (s) => s.calendar);
  const pages = useStore(session.doc, (d) => d.pages);
  const allShapes = useStore(session.doc, (d) => d.allShapes);
  const [draft, setDraft] = useState<EditorDraft | null>(editor?.draft ?? null);
  // A new editor (another event, or a fresh "new") starts from its own draft.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset only when the editor identity changes
  useEffect(() => setDraft(editor?.draft ?? null), [editor?.ref?.eventId, editor?.ref?.key, editor === null]);
  if (!editor || !draft) return null;
  const ro = editor.readOnly;
  const set = (patch: Partial<EditorDraft>) => setDraft({ ...draft, ...patch });
  const resolved = editor.ref ? ctl.resolve(editor.ref) : null;
  const ev = resolved?.ev ?? null;
  const tzNote =
    resolved && !resolved.when.allDay && resolved.when.tz !== ctl.zone
      ? `Event time: ${resolved.when.start.slice(11)}–${resolved.when.end.slice(11)} ${resolved.when.tz}`
      : null;
  const summary = ev ? rsvpSummary(ev.rsvp) : null;
  const mine = ev?.rsvp[session.user.id]?.status ?? null;
  const link = ev?.link;
  const linkAlive = link ? pages.some((p) => p.id === link.pageId) && Boolean(allShapes[link.shapeId]) : false;
  const answer = (s: RsvpStatus) => ev && ctl.rsvp(ev.id, mine === s ? null : s);
  void calendar; // re-render when the calendar changes (RSVP counts, link state)

  return (
    <Dialog title={editor.ref ? (ro ? 'Event' : 'Edit event') : 'New event'} onClose={() => ctl.closeEditor()} wide>
      <form
        data-testid="cal-editor"
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!ro) ctl.save(draft);
        }}
      >
        <label className={label}>
          Title
          <input data-testid="cal-title-input" className={input} disabled={ro} maxLength={120} value={draft.title} onChange={(e) => set({ title: e.target.value })} />
        </label>
        <label className="flex items-center gap-2 font-mono text-xs">
          <input data-testid="cal-allday" type="checkbox" disabled={ro} checked={draft.allDay} onChange={(e) => set({ allDay: e.target.checked })} />
          All day
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className={label}>
            Start
            <input data-testid="cal-start-date" type="date" className={input} disabled={ro} value={draft.startDate} onChange={(e) => set({ startDate: e.target.value })} />
          </label>
          {!draft.allDay ? (
            <label className={label}>
              &nbsp;
              <input data-testid="cal-start-time" type="time" step={900} className={input} disabled={ro} value={draft.startTime} onChange={(e) => set({ startTime: e.target.value })} />
            </label>
          ) : (
            <span />
          )}
          <label className={label}>
            End
            <input data-testid="cal-end-date" type="date" className={input} disabled={ro} value={draft.endDate} onChange={(e) => set({ endDate: e.target.value })} />
          </label>
          {!draft.allDay ? (
            <label className={label}>
              &nbsp;
              <input data-testid="cal-end-time" type="time" step={900} className={input} disabled={ro} value={draft.endTime} onChange={(e) => set({ endTime: e.target.value })} />
            </label>
          ) : (
            <span />
          )}
        </div>
        {tzNote && (
          <p data-testid="cal-event-zone" className="font-mono text-[11px] text-ink/60">
            {tzNote}
          </p>
        )}
        <div className="flex flex-wrap items-end gap-2">
          <label className={label}>
            Repeat
            <select data-testid="cal-repeat" className={input} disabled={ro} value={draft.repeat} onChange={(e) => set({ repeat: e.target.value as EditorDraft['repeat'] })}>
              <option value="none">Never</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
              <option value="yearly">Yearly</option>
            </select>
          </label>
          {draft.repeat !== 'none' && (
            <>
              <label className={label}>
                Every
                <input data-testid="cal-interval" type="number" min={1} max={99} className={`${input} w-16`} disabled={ro} value={draft.interval} onChange={(e) => set({ interval: Number(e.target.value) })} />
              </label>
              <label className={label}>
                Ends
                <select data-testid="cal-ends" className={input} disabled={ro} value={draft.ends} onChange={(e) => set({ ends: e.target.value as EditorDraft['ends'] })}>
                  <option value="never">Never</option>
                  <option value="on">On a date</option>
                  <option value="after">After N times</option>
                </select>
              </label>
              {draft.ends === 'on' && (
                <input data-testid="cal-until" type="date" className={`${input} w-40`} disabled={ro} value={draft.until} onChange={(e) => set({ until: e.target.value })} />
              )}
              {draft.ends === 'after' && (
                <input data-testid="cal-count" type="number" min={1} max={999} className={`${input} w-20`} disabled={ro} value={draft.count} onChange={(e) => set({ count: Number(e.target.value) })} />
              )}
            </>
          )}
        </div>
        {draft.repeat === 'weekly' && (
          <div className="flex gap-1">
            {WEEKDAY_SHORT.map((d, i) => (
              <button
                key={d}
                type="button"
                data-testid={`cal-byday-${i}`}
                aria-pressed={draft.byDay.includes(i)}
                disabled={ro}
                className={`${btn} px-2 ${draft.byDay.includes(i) ? 'bg-sun' : 'bg-white'}`}
                onClick={() => set({ byDay: draft.byDay.includes(i) ? draft.byDay.filter((x) => x !== i) : [...draft.byDay, i] })}
              >
                {d}
              </button>
            ))}
          </div>
        )}
        <div className="flex gap-2">
          {EVENT_COLORS.map((c, i) => (
            <button
              key={c}
              type="button"
              data-testid={`cal-color-${i}`}
              aria-label={`Colour ${i + 1}`}
              aria-pressed={draft.color === c}
              disabled={ro}
              className={`size-6 border-2 border-ink ${draft.color === c ? 'outline outline-2 outline-offset-2 outline-ink' : ''}`}
              style={{ background: c }}
              onClick={() => set({ color: c })}
            />
          ))}
        </div>
        <label className={label}>
          Notes
          <textarea data-testid="cal-notes" rows={3} className={input} disabled={ro} maxLength={2000} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
        </label>
        {ev && summary && (
          <div data-testid="cal-rsvp" className="flex flex-col gap-1 border-t-2 border-ink/20 pt-2 font-mono text-xs">
            <p data-testid="cal-rsvp-summary">
              {summary.yes.length} going · {summary.maybe.length} maybe · {summary.no.length} not going
            </p>
            {summary.yes.length + summary.maybe.length + summary.no.length > 0 && (
              <p className="text-[11px] text-ink/60">
                {[...summary.yes.map((n) => `${n} ✓`), ...summary.maybe.map((n) => `${n} ?`), ...summary.no.map((n) => `${n} ✗`)].join(', ')}
              </p>
            )}
            {!ro && (
              <div className="flex gap-1">
                {(['yes', 'maybe', 'no'] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    data-testid={`cal-rsvp-${s}`}
                    aria-pressed={mine === s}
                    className={`${btn} ${mine === s ? 'bg-sun' : 'bg-white'}`}
                    onClick={() => answer(s)}
                  >
                    {s === 'yes' ? 'Going' : s === 'maybe' ? 'Maybe' : 'Not going'}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
        {link && (
          <button
            type="button"
            data-testid="cal-open-board"
            disabled={!linkAlive}
            className={`${btn} self-start bg-white`}
            onClick={() => {
              ctl.closeEditor();
              session.controller.revealShape(link.pageId, link.shapeId);
            }}
          >
            {linkAlive ? 'Open on board' : 'Sticky deleted'}
          </button>
        )}
        <div className="flex justify-between gap-2 border-t-2 border-ink/20 pt-2">
          {editor.ref && !ro ? (
            <button type="button" data-testid="cal-delete" className={`${btn} bg-white text-flame`} onClick={() => editor.ref && ctl.remove(editor.ref)}>
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button type="button" data-testid="cal-cancel" className={`${btn} bg-white`} onClick={() => ctl.closeEditor()}>
              {ro ? 'Close' : 'Cancel'}
            </button>
            {!ro && (
              <button type="submit" data-testid="cal-save" className={`${btn} bg-sun`}>
                Save
              </button>
            )}
          </div>
        </div>
      </form>
    </Dialog>
  );
}
```

- Replace the `void calendar` line with a cleaner subscription if Biome objects, for example by selecting only the current event's `rsvp` and `link`. The component must re-render when the RSVP counts change.
- `allShapes` already exists on the doc store (`DocState.allShapes`), and covers the shapes on all visible pages.
- **Series question while the editor is open.** When `save` asks a series question, the editor stays mounted underneath and `SeriesDialog` renders on top, so two `Dialog`s are open. The series dialog's panel takes focus because it mounts later. Its Escape handler calls `answer(null)`, which only closes the question.
- **Deleting from the editor.** For a non-repeating event, `remove` closes the editor itself. For a series occurrence, it asks the question first.

In `CalendarPage.tsx`'s `CalendarBody`, after the view, render:

```tsx
<EventEditor session={session} ctl={ctl} />
<SeriesDialog ctl={ctl} />
```

- [ ] **Step 4: Run the tests, then check the dialogs in a browser**

Run: `npm test -w @relay/web -- calendarRsvp calendarReveal`
Expected: PASS.

Then write a throwaway spec, `e2e/zz-scratch-calendar-editor.spec.ts`. It must check, with screenshots saved to the scratchpad:
- creating a calendar page, clicking a day, typing a title, choosing Weekly, and saving shows the event;
- dragging one occurrence to another day asks the series question, and "Only this event" moves only that one;
- Going updates `cal-rsvp-summary` to "1 going · 0 maybe · 0 not going";
- a second browser context, on the same page with the event open, shows `cal-event-dots` on it.

Delete the spec before committing.

- [ ] **Step 5: Run the suites, typecheck, lint and build, then commit**

Run: `npm test && npm run typecheck && npm run lint && npm run build -w @relay/web`

```bash
git add apps/web/src/calendar apps/web/src/board/controller.ts apps/web/test/calendarRsvp.test.ts apps/web/test/calendarReveal.test.ts
git commit -m "feat(web): event editor, series question, RSVP, peer dots and Open on board"
```

---
### Task 10: `.ics` export/import UI and "Add to calendar…" from a sticky

**Files:**
- Create:
  - `apps/web/src/calendar/IcsImport.tsx` (the import summary dialog)
  - `apps/web/src/ui/AddToCalendarDialog.tsx`
  - `apps/web/src/ui/stickyTitle.ts`
- Modify:
  - `apps/web/src/calendar/calendarController.ts` (`exportIcs`, `importIcs`)
  - `apps/web/src/calendar/CalendarHeader.tsx` (a "…" menu with Export and Import, and the file input)
  - `apps/web/src/calendar/CalendarPage.tsx` (mount `IcsImport`)
  - `apps/web/src/board/controller.ts`:
    - UI state `addToCalendar: string | null`, set with `setAddToCalendar(id | null)` and reset on page change;
    - `addStickyToCalendar(input)`.
  - `apps/web/src/ui/canvasMenuItems.ts`, `apps/web/src/ui/CanvasMenu.tsx` ("Add to calendar…")
  - `apps/web/src/board/Board.tsx` (mount `AddToCalendarDialog` in the board branch)
  - `docs/superpowers/specs/2026-09-24-relay-design.md` (one wording fix, below)
- Test:
  - `apps/web/test/calendarController.test.ts` (extend)
  - `apps/web/test/addToCalendar.test.ts` (new)
  - `apps/web/test/canvasMenu.test.ts` (extend)

**Interfaces:**
- Consumes:
  - Core: `writeIcs`, `parseIcs`, `MAX_ICS_BYTES`, `IcsWarning`, `importUpdateSize`, `MAX_PASTE_BYTES`, `MAX_EVENTS`, `readCalendar`, `getRoots`, `EVENT_COLORS`, `newEventId`, `When`, `todayIn`, `viewerZone`.
  - Task 9: `BoardController.revealShape`.
- Produces:
  - On `CalendarController`:
    - `exportIcs(name: string): string | null`
    - `importIcs(text: string): { imported: number; skipped: number; warnings: IcsWarning[] } | null`. It returns null when the import was refused or the user cannot edit.
  - On the board controller:
    - UI state `addToCalendar: string | null`, the shape id whose dialog is open;
    - `setAddToCalendar(id: string | null): void`;
    - `addStickyToCalendar(input: { pageId: string | null; shapeId: string; title: string; when: When }): string | null`. It returns the calendar page id, or null when nothing was created. `pageId: null` creates a new calendar page.
  - `stickyTitle(text: string | undefined): string` returns the first non-empty line, trimmed and capped at 120 characters, or `'Untitled'`.
  - `CanvasMenuActions.addToCalendar(shapeId: string): void`.
  - Test ids:
    - calendar header: `cal-menu`, `cal-export`, `cal-import`, `cal-import-input`;
    - import summary: `cal-import-summary`;
    - context menu: `menu-add-calendar`;
    - Add to calendar dialog: `add-cal-dialog`, `add-cal-page`, `add-cal-title`, `add-cal-date`, `add-cal-allday`, `add-cal-start`, `add-cal-end`, `add-cal-submit`.
- Messages:
  - `This file is larger than 1 MB`
  - `This calendar is full (500 events)`
  - `Too much to paste at once`
  - `Added to <calendar title>`
  - The import summary: "Imported N events", then "M already in this calendar" when M > 0, then one line per warning as "Line X: message".

- [ ] **Step 1: Write the failing tests**

Append to `apps/web/test/calendarController.test.ts`, adding `writeIcs` and `readCalendar` to the core import if they are not there yet:

```ts
describe('.ics', () => {
  const ICS = (uids: string[]) =>
    ['BEGIN:VCALENDAR', ...uids.flatMap((u, i) => ['BEGIN:VEVENT', `UID:${u}`, `DTSTART;VALUE=DATE:2026100${i + 1}`, `SUMMARY:${u}`, 'END:VEVENT']), 'END:VCALENDAR'].join('\r\n');

  it('imports as one undo step, skips events already in the calendar and reports warnings', () => {
    const { ctl, events, board } = setup();
    const first = ctl.importIcs(ICS(['a@x', 'b@x']));
    expect(first).toEqual({ imported: 2, skipped: 0, warnings: [] });
    expect(events().map((e) => e.uid).sort()).toEqual(['a@x', 'b@x']);
    const again = ctl.importIcs(`${ICS(['a@x', 'c@x'])}\r\nBEGIN:VEVENT\r\nUID:bad\r\nEND:VEVENT`);
    expect(again?.imported).toBe(1);
    expect(again?.skipped).toBe(1);
    expect(again?.warnings.map((w) => w.message)).toEqual(['Event without a valid start; skipped']);
    board.undo();
    expect(events().map((e) => e.uid).sort()).toEqual(['a@x', 'b@x']);
  });

  it('refuses a file over 1 MB, an import past the event cap, and an import over the byte budget', () => {
    const { ctl, notify, events } = setup();
    expect(ctl.importIcs('x'.repeat(1024 * 1024 + 1))).toBeNull();
    expect(notify).toHaveBeenLastCalledWith('This file is larger than 1 MB');
    const many = Array.from({ length: 501 }, (_, i) => `u${i}@x`);
    expect(ctl.importIcs(ICS(many).replace(/DTSTART;VALUE=DATE:\d+/g, 'DTSTART;VALUE=DATE:20261001'))).toBeNull();
    expect(notify).toHaveBeenLastCalledWith('This calendar is full (500 events)');
    const heavy = Array.from({ length: 150 }, (_, i) =>
      ['BEGIN:VEVENT', `UID:h${i}`, 'DTSTART;VALUE=DATE:20261001', `DESCRIPTION:${'z'.repeat(1900)}`, 'END:VEVENT'].join('\r\n'),
    ).join('\r\n');
    expect(ctl.importIcs(`BEGIN:VCALENDAR\r\n${heavy}\r\nEND:VCALENDAR`)).toBeNull();
    expect(notify).toHaveBeenLastCalledWith('Too much to paste at once');
    expect(events()).toHaveLength(0);
  });

  it('exports what it can re-import', () => {
    const { ctl, create } = setup();
    create('a', { title: 'Trip', when: { allDay: true, start: '2026-10-01', end: '2026-10-03' } });
    const text = ctl.exportIcs('Team') ?? '';
    expect(text).toContain('SUMMARY:Trip');
    expect(text).toContain('X-WR-CALNAME:Team');
  });
});
```

```ts
// apps/web/test/addToCalendar.test.ts
import { applyCommand, getRoots, readCalendar } from '@relay/core';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createBoardController } from '../src/board/controller';
import { createActivityStore } from '../src/store/activityStore';
import { createDocStore } from '../src/store/docStore';
import { stickyTitle } from '../src/ui/stickyTitle';

function setup() {
  const doc = new Y.Doc();
  const docs = createDocStore(doc);
  const activity = createActivityStore(doc);
  const notify = vi.fn();
  const board = createBoardController({
    doc,
    docStore: docs.store,
    setPage: docs.setPage,
    activity: activity.store,
    user: { id: 'u1', name: 'Brisk Otter', color: '#E85A1B' },
    notify,
  });
  applyCommand(doc, {
    type: 'CreateShape',
    shape: { id: 's1', type: 'sticky', x: 0, y: 0, w: 180, h: 140, style: { fill: '#F5D547', stroke: '#111111', font: 'sans' }, createdBy: 'u1', authorName: 'B', createdAt: 0 },
  });
  const events = (page: string) => readCalendar(getRoots(doc).calendars.get(page))?.events ?? [];
  return { doc, docs, board, notify, events };
}

describe('Add to calendar', () => {
  it('derives the title from the first non-empty line of the sticky', () => {
    expect(stickyTitle('\n  Plan the retro  \nsecond line')).toBe('Plan the retro');
    expect(stickyTitle('   ')).toBe('Untitled');
    expect(stickyTitle(undefined)).toBe('Untitled');
    expect(stickyTitle('x'.repeat(200))).toHaveLength(120);
  });

  it('creates a linked event on an existing calendar, as one undo step, and says where', () => {
    const { board, notify, events, docs } = setup();
    const cal = board.createPage('calendar');
    const when = { allDay: true as const, start: '2026-10-01', end: '2026-10-01' };
    expect(board.addStickyToCalendar({ pageId: cal, shapeId: 's1', title: 'Retro', when })).toBe(cal);
    expect(events(cal)).toMatchObject([{ title: 'Retro', when, link: { pageId: 'main', shapeId: 's1' } }]);
    const title = docs.store.getState().pages.find((p) => p.id === cal)?.title;
    expect(notify).toHaveBeenLastCalledWith(`Added to ${title}`);
    expect(docs.store.getState().activePage).toBe('main');
    board.undo();
    expect(events(cal)).toHaveLength(0);
  });

  it('creates a new calendar page when asked, and refuses a missing sticky', () => {
    const { board, events, docs } = setup();
    const when = { allDay: true as const, start: '2026-10-01', end: '2026-10-01' };
    const page = board.addStickyToCalendar({ pageId: null, shapeId: 's1', title: 'X', when });
    expect(page).not.toBeNull();
    expect(docs.store.getState().pages.find((p) => p.id === page)?.type).toBe('calendar');
    expect(events(page as string)).toHaveLength(1);
    expect(board.addStickyToCalendar({ pageId: page, shapeId: 'ghost', title: 'X', when })).toBeNull();
  });

  it('keeps the dialog state per page', () => {
    const { board } = setup();
    board.setAddToCalendar('s1');
    expect(board.ui.getState().addToCalendar).toBe('s1');
    board.setPage(board.createPage('board'));
    expect(board.ui.getState().addToCalendar).toBeNull();
  });
});
```

Extend `apps/web/test/canvasMenu.test.ts`. Read its existing fixtures first (`ctx`, the `actions` stub and the shape helpers) and reuse them. Add `addToCalendar: vi.fn()` to the actions stub, then add four cases:
1. An editor with exactly one sticky selected gets an entry with `testId: 'menu-add-calendar'`, labelled `Add to calendar…`. Selecting it calls `addToCalendar('<sticky id>')`.
2. A single rectangle gets no such entry.
3. Two stickies get no such entry.
4. A viewer gets no such entry.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -w @relay/web -- calendarController addToCalendar canvasMenu`
Expected: FAIL. None of the new methods exist yet.

- [ ] **Step 3: Write the implementation**

In `calendarController.ts`:
- Import `writeIcs`, `parseIcs`, `MAX_ICS_BYTES`, `type IcsWarning`, `importUpdateSize` and `MAX_PASTE_BYTES` from `@relay/core`.
- Add both methods to the `CalendarController` interface.
- Implement them:

```ts
    exportIcs(name) {
      const cal = opts.calendar.getState().calendar;
      return cal ? writeIcs(cal, { name, now: opts.now() }) : null;
    },
    importIcs(text) {
      const page = pageId();
      if (!opts.canEdit() || !page) return null;
      if (new TextEncoder().encode(text).length > MAX_ICS_BYTES) {
        opts.notify('This file is larger than 1 MB');
        return null;
      }
      const parsed = parseIcs(text, { zone });
      const known = new Set(events().map((e) => e.uid ?? `${e.id}@relay`));
      const fresh = parsed.events.filter((e) => !known.has(e.uid));
      const skipped = parsed.events.length - fresh.length;
      if (events().length + fresh.length > MAX_EVENTS) {
        opts.notify('This calendar is full (500 events)');
        return null;
      }
      const writes = fresh.map((e) => ({
        id: newId(),
        fields: { ...e.fields, uid: e.uid, createdBy: opts.user.id, createdAt: opts.now() },
        exceptions: e.exceptions,
      }));
      if (writes.length > 0 && importUpdateSize(writes) > MAX_PASTE_BYTES) {
        opts.notify('Too much to paste at once');
        return null;
      }
      if (writes.length > 0) commitEvent({ type: 'ImportEvents', pageId: page, events: writes });
      return { imported: writes.length, skipped, warnings: parsed.warnings };
    },
```

```ts
// apps/web/src/ui/stickyTitle.ts
import { MAX_EVENT_TITLE } from '@relay/core';

/** An event title from a sticky's text: its first non-empty line, or "Untitled". */
export function stickyTitle(text: string | undefined): string {
  const line = (text ?? '').split('\n').map((l) => l.trim()).find((l) => l.length > 0);
  return line ? line.slice(0, MAX_EVENT_TITLE) : 'Untitled';
}
```

On the board controller (`controller.ts`):
- Add `addToCalendar: string | null` to the UI state type, and `addToCalendar: null` to the initial state and to the page-change reset.
- Add a method, with a doc comment on the interface:
  ```ts
  setAddToCalendar(id) { ui.setState({ addToCalendar: id }); },
  ```
- Add the second method:

```ts
    addStickyToCalendar(input) {
      const shape = opts.docStore.getState().shapes[input.shapeId];
      if (!shape || shape.type !== 'sticky') return null;
      const pageId = input.pageId ?? api.createPage('calendar');
      const cal = readCalendar(getRoots(opts.doc).calendars.get(pageId));
      if (!cal) return null;
      if (cal.events.length >= MAX_EVENTS) {
        opts.notify?.('This calendar is full (500 events)');
        return null;
      }
      const done = commitStep({
        type: 'CreateEvent',
        pageId,
        id: newId(),
        fields: {
          title: input.title.trim().slice(0, MAX_EVENT_TITLE) || 'Untitled',
          color: EVENT_COLORS[0] as string,
          when: input.when,
          link: { pageId: activePage(), shapeId: input.shapeId },
          createdBy: opts.user.id,
          createdAt: now(),
        },
      });
      if (!done) return null;
      const title = opts.docStore.getState().pages.find((p) => p.id === pageId)?.title ?? 'Calendar';
      opts.notify?.(`Added to ${title}`);
      ui.setState({ addToCalendar: null });
      return pageId;
    },
```

Here `api.createPage` is the controller's own `createPage`. It creates the page with the `SESSION` origin, so undo removes only the event, never the page. Use the same self-reference approach as in Task 9. `newId`, `now`, `activePage`, `commitStep`, `readCalendar`, `getRoots`, `MAX_EVENTS`, `MAX_EVENT_TITLE` and `EVENT_COLORS` are either already in the file or imported from `@relay/core`.

In `canvasMenuItems.ts`:
- Add `addToCalendar(shapeId: string): void` to `CanvasMenuActions`.
- In the editor selection menu, add this entry when the selection is exactly one shape of type `sticky` and no connectors. Put it right after the "Comment here" entry:

```ts
{ label: 'Add to calendar…', onSelect: () => a.addToCalendar(shapes[0]?.id as string), testId: 'menu-add-calendar' }
```

Read the function's existing structure and follow it. The viewer branch already returns early, so viewers never see the entry.

In `CanvasMenu.tsx`, wire the action as `addToCalendar: (id) => session.controller.setAddToCalendar(id)`.

```tsx
// apps/web/src/ui/AddToCalendarDialog.tsx
import { todayIn, viewerZone, type When } from '@relay/core';
import { useState } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { Dialog } from './Dialog';
import { stickyTitle } from './stickyTitle';

const input = 'w-full border-2 border-ink bg-white px-2 py-1 font-mono text-xs';
const label = 'flex flex-col gap-1 font-mono text-[11px] uppercase text-ink/70';

export function AddToCalendarDialog({ session }: { session: BoardSession }) {
  const shapeId = useStore(session.controller.ui, (s) => s.addToCalendar);
  if (!shapeId) return null;
  return <AddToCalendarForm key={shapeId} session={session} shapeId={shapeId} />;
}

function AddToCalendarForm({ session, shapeId }: { session: BoardSession; shapeId: string }) {
  const pages = useStore(session.doc, (d) => d.pages);
  const calendars = pages.filter((p) => p.type === 'calendar');
  const text = useStore(session.doc, (d) => d.shapes[shapeId]?.text);
  const zone = viewerZone();
  const nextHour = Math.min(23, new Date().getHours() + 1);
  const [page, setPage] = useState<string>(calendars[0]?.id ?? '__new');
  const [title, setTitle] = useState(stickyTitle(text));
  const [date, setDate] = useState(todayIn(Date.now(), zone));
  const [allDay, setAllDay] = useState(true);
  const [start, setStart] = useState(`${String(nextHour).padStart(2, '0')}:00`);
  const [end, setEnd] = useState(`${String(Math.min(23, nextHour + 1)).padStart(2, '0')}:${nextHour === 23 ? '45' : '00'}`);
  const close = () => session.controller.setAddToCalendar(null);
  const submit = () => {
    const when: When = allDay
      ? { allDay: true, start: date, end: date }
      : { allDay: false, start: `${date}T${start}`, end: `${date}T${end > start ? end : start}`, tz: zone };
    session.controller.addStickyToCalendar({ pageId: page === '__new' ? null : page, shapeId, title, when });
  };
  return (
    <Dialog title="Add to calendar" onClose={close}>
      <form
        data-testid="add-cal-dialog"
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <label className={label}>
          Calendar
          <select data-testid="add-cal-page" className={input} value={page} onChange={(e) => setPage(e.target.value)}>
            {calendars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
            <option value="__new">New calendar page</option>
          </select>
        </label>
        <label className={label}>
          Title
          <input data-testid="add-cal-title" className={input} maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className={label}>
          Date
          <input data-testid="add-cal-date" type="date" className={input} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="flex items-center gap-2 font-mono text-xs">
          <input data-testid="add-cal-allday" type="checkbox" checked={allDay} onChange={(e) => setAllDay(e.target.checked)} />
          All day
        </label>
        {!allDay && (
          <div className="grid grid-cols-2 gap-2">
            <label className={label}>
              Start
              <input data-testid="add-cal-start" type="time" step={900} className={input} value={start} onChange={(e) => setStart(e.target.value)} />
            </label>
            <label className={label}>
              End
              <input data-testid="add-cal-end" type="time" step={900} className={input} value={end} onChange={(e) => setEnd(e.target.value)} />
            </label>
          </div>
        )}
        <div className="flex justify-end gap-2">
          <button type="button" className="border-2 border-ink bg-white px-3 py-1.5 font-mono text-xs uppercase" onClick={close}>
            Cancel
          </button>
          <button type="submit" data-testid="add-cal-submit" className="border-2 border-ink bg-sun px-3 py-1.5 font-mono text-xs uppercase">
            Add
          </button>
        </div>
      </form>
    </Dialog>
  );
}
```

Notes on the dialog:
- **Times:** a timed "Add to calendar" event is stored in the viewer's zone. The `when` passes through `readWhen` on read, so an end before the start reads as start + 1 h, and the model stays valid.

In `CalendarHeader.tsx`, add a "…" button (`cal-menu`) at the right end. It opens the existing `ContextMenu` (`apps/web/src/ui/ContextMenu.tsx`) with two items:
- **Export .ics** (`cal-export`), for everyone. It calls `ctl.exportIcs(title)`, then downloads the result:
  ```ts
  const url = URL.createObjectURL(new Blob([text], { type: 'text/calendar' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title.replace(/[^\w .-]+/g, '_') || 'calendar'}.ics`;
  a.click();
  URL.revokeObjectURL(url);
  ```
  `title` is the active page's title, from `session.doc`.
- **Import .ics…** (`cal-import`), for editors only. It clicks a hidden `<input type="file" accept=".ics,text/calendar" data-testid="cal-import-input">`. Its `onChange` handler:
  - checks `file.size > 1024 * 1024`, and if so toasts `This file is larger than 1 MB`;
  - otherwise reads `await file.text()`, calls `ctl.importIcs(text)`, and stores the result in local state for the summary;
  - resets `e.target.value = ''`, so that the same file can be chosen again.

Render `<IcsImport result={…} onClose={…} />` from the header, or lift the state to `CalendarPage`; either works.

```tsx
// apps/web/src/calendar/IcsImport.tsx
import type { IcsWarning } from '@relay/core';
import { Dialog } from '../ui/Dialog';

export function IcsImport({
  result,
  onClose,
}: {
  result: { imported: number; skipped: number; warnings: IcsWarning[] } | null;
  onClose(): void;
}) {
  if (!result) return null;
  return (
    <Dialog title="Import .ics" onClose={onClose}>
      <div data-testid="cal-import-summary" className="flex flex-col gap-2 font-mono text-xs">
        <p>
          Imported {result.imported} {result.imported === 1 ? 'event' : 'events'}
        </p>
        {result.skipped > 0 && <p>{result.skipped} already in this calendar</p>}
        {result.warnings.length > 0 && (
          <ul className="max-h-48 overflow-y-auto border-2 border-ink/20 p-2">
            {result.warnings.map((w, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: warnings can repeat; the list is rebuilt whole
              <li key={i}>
                Line {w.line}: {w.message}
              </li>
            ))}
          </ul>
        )}
        <button type="button" className="self-end border-2 border-ink bg-sun px-3 py-1.5 uppercase" onClick={onClose}>
          OK
        </button>
      </div>
    </Dialog>
  );
}
```

In `Board.tsx`'s board branch, add `<AddToCalendarDialog session={session} />` next to `<NewGraphDialog session={session} />`.

**Spec wording fix.** In `docs/superpowers/specs/2026-09-24-relay-design.md`, "Add to calendar":
- replace `"New calendar page", which creates one titled "Calendar" at the end of the tabs` with `"New calendar page", which creates one at the end of the tabs, named like a calendar made from "+" ("Calendar N")`;
- in "Roles", keep "viewers … export `.ics`" as it is.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test -w @relay/web -- calendarController addToCalendar canvasMenu`
Expected: PASS.

Then write a throwaway spec, `e2e/zz-scratch-ics.spec.ts`. It must:
- create a calendar page with an event;
- export, catching Playwright's `download` event, and assert that the file contains `BEGIN:VCALENDAR`;
- import that file into a second calendar page via `setInputFiles`, and assert that `cal-import-summary` reads "Imported 1 event";
- right-click a sticky on the board, choose "Add to calendar…" and submit, then assert the toast;
- open the new event and click "Open on board", and assert that the board page is active and the sticky is selected.

Delete the spec before committing.

- [ ] **Step 5: Run the suites, typecheck, lint and build, then commit**

Run: `npm test && npm run typecheck && npm run lint && npm run build -w @relay/web`

```bash
git add apps/web/src apps/web/test docs/superpowers/specs/2026-09-24-relay-design.md
git commit -m "feat(web): .ics export and import, and Add to calendar from a sticky"
```

---
### Task 11: End-to-end calendar tests and full verification

**Files:**
- Create: `e2e/calendar.spec.ts`

**Interfaces:**
- Consumes: the test ids of Tasks 8–10, plus the board's `page-add`, `page-add-calendar`, `selection-outline`, `conn-status`, toasts and `menu-add-calendar`.
- Produces: the final test counts, which Task 12 writes into the README. The e2e suite goes from 32 to 36.

- [ ] **Step 1: Write the spec**

```ts
// e2e/calendar.spec.ts
import { readFileSync } from 'node:fs';
import { type APIRequestContext, type Browser, expect, type Page, test } from '@playwright/test';

const SYNC = 'http://localhost:8787';

async function newRoom(request: APIRequestContext) {
  const res = await request.post(`${SYNC}/api/rooms`);
  return (await res.json()) as { roomId: string; editKey: string; viewKey: string };
}

async function openBoard(page: Page, path: string) {
  await page.goto(path);
  await expect(page.getByTestId('conn-status')).toHaveAttribute('data-status', 'online', { timeout: 20_000 });
}

async function addCalendar(page: Page) {
  await page.getByTestId('page-add').click();
  await page.getByTestId('page-add-calendar').click();
  await expect(page.getByTestId('calendar-page')).toBeVisible();
}

async function userIn(browser: Browser, timezoneId: string, path: string) {
  const ctx = await browser.newContext({ timezoneId });
  const page = await ctx.newPage();
  await openBoard(page, path);
  return { ctx, page };
}

/** Creates an event through the editor (today, unless the editor already has another date). */
async function newEvent(page: Page, title: string, opts: { start?: string; end?: string; weekly?: boolean } = {}) {
  await page.getByTestId('cal-new').click();
  await page.getByTestId('cal-title-input').fill(title);
  if (opts.start) {
    await page.getByTestId('cal-allday').uncheck();
    await page.getByTestId('cal-start-time').fill(opts.start);
    await page.getByTestId('cal-end-time').fill(opts.end ?? opts.start);
  }
  if (opts.weekly) await page.getByTestId('cal-repeat').selectOption('weekly');
  await page.getByTestId('cal-save').click();
  await expect(page.getByTestId('cal-editor')).toHaveCount(0);
}

test('two users in different time zones see one event at their own local times', async ({ browser, request }) => {
  const { roomId, editKey } = await newRoom(request);
  const madrid = await userIn(browser, 'Europe/Madrid', `/r/${roomId}#k=${editKey}`);
  await addCalendar(madrid.page);
  const havana = await userIn(browser, 'America/Havana', madrid.page.url().replace(/^.*\/r\//, '/r/'));
  await expect(havana.page.getByTestId('calendar-page')).toBeVisible();
  await expect(madrid.page.getByTestId('cal-zone')).toHaveText('Times in Europe/Madrid');
  await expect(havana.page.getByTestId('cal-zone')).toHaveText('Times in America/Havana');

  // Madrid uses the week view; Havana stays on the month grid, which also covers the
  // neighbouring days, so the test holds even when the two zones are on different dates.
  await madrid.page.getByTestId('cal-view-week').click();
  await newEvent(madrid.page, 'Standup', { start: '09:00', end: '10:00' });

  const mine = madrid.page.getByTestId('cal-event').filter({ hasText: 'Standup' });
  await expect(mine).toContainText('09:00');
  const theirs = havana.page.getByTestId('cal-event').filter({ hasText: 'Standup' });
  await expect(theirs).toHaveCount(1);
  await expect(theirs).not.toContainText('09:00');
  await theirs.dblclick();
  await expect(havana.page.getByTestId('cal-event-zone')).toContainText('09:00–10:00 Europe/Madrid');
  await madrid.ctx.close();
  await havana.ctx.close();
});

test('a weekly event: delete one occurrence only, and answer RSVP live', async ({ browser, request }) => {
  const { roomId, editKey } = await newRoom(request);
  const a = await userIn(browser, 'Europe/Madrid', `/r/${roomId}#k=${editKey}`);
  await addCalendar(a.page);
  const b = await userIn(browser, 'Europe/Madrid', a.page.url().replace(/^.*\/r\//, '/r/'));
  await newEvent(a.page, 'Retro', { weekly: true });
  // Next month's grid lies entirely after today, so it always shows 6 occurrences.
  await a.page.getByTestId('cal-next').click();
  await b.page.getByTestId('cal-next').click();

  const series = a.page.getByTestId('cal-event').filter({ hasText: 'Retro' });
  await expect(series).toHaveCount(6);
  const before = 6;
  await series.nth(1).click();
  await a.page.keyboard.press('Delete');
  await expect(a.page.getByTestId('cal-series')).toBeVisible();
  await a.page.getByTestId('cal-series-one').click();
  await expect(series).toHaveCount(before - 1);
  await expect(b.page.getByTestId('cal-event').filter({ hasText: 'Retro' })).toHaveCount(before - 1);

  await b.page.getByTestId('cal-event').filter({ hasText: 'Retro' }).first().dblclick();
  await a.page.getByTestId('cal-event').filter({ hasText: 'Retro' }).first().dblclick();
  await expect(b.page.getByTestId('cal-event-dots').first()).toBeVisible();
  await a.page.getByTestId('cal-rsvp-yes').click();
  await expect(b.page.getByTestId('cal-rsvp-summary')).toHaveText('1 going · 0 maybe · 0 not going');
  await a.ctx.close();
  await b.ctx.close();
});

test('a viewer reads events but cannot change them; export stays available', async ({ browser, request }) => {
  const { roomId, editKey, viewKey } = await newRoom(request);
  const editor = await userIn(browser, 'Europe/Madrid', `/r/${roomId}#k=${editKey}`);
  await addCalendar(editor.page);
  await newEvent(editor.page, 'Planning');
  const pageId = new URL(editor.page.url()).hash.match(/p=([^&]+)/)?.[1] ?? '';
  const viewer = await userIn(browser, 'Europe/Madrid', `/r/${roomId}#k=${viewKey}&p=${pageId}`);
  await expect(viewer.page.getByTestId('calendar-page')).toBeVisible();
  await expect(viewer.page.getByTestId('cal-new')).toHaveCount(0);
  await viewer.page.getByTestId('cal-event').filter({ hasText: 'Planning' }).dblclick();
  await expect(viewer.page.getByTestId('cal-save')).toHaveCount(0);
  await expect(viewer.page.getByTestId('cal-rsvp-yes')).toHaveCount(0);
  await expect(viewer.page.getByTestId('cal-title-input')).toBeDisabled();
  await viewer.page.getByTestId('cal-cancel').click();
  await viewer.page.getByTestId('cal-menu').click();
  await expect(viewer.page.getByTestId('cal-export')).toBeVisible();
  await expect(viewer.page.getByTestId('cal-import')).toHaveCount(0);
  await editor.ctx.close();
  await viewer.ctx.close();
});

test('sticky → calendar → open on board, then export and re-import the calendar', async ({ browser, request }) => {
  const { roomId, editKey } = await newRoom(request);
  const { ctx, page } = await userIn(browser, 'Europe/Madrid', `/r/${roomId}#k=${editKey}`);
  await page.keyboard.press('s');
  await page.mouse.click(500, 350);
  await page.keyboard.type('Plan the retro');
  await page.keyboard.press('Escape');
  await page.mouse.click(500, 350, { button: 'right' });
  await page.getByTestId('menu-add-calendar').click();
  await expect(page.getByTestId('add-cal-title')).toHaveValue('Plan the retro');
  await page.getByTestId('add-cal-submit').click();
  await expect(page.getByText(/Added to Calendar/)).toBeVisible();

  await page.getByRole('tab', { name: /Calendar/ }).click();
  const ev = page.getByTestId('cal-event').filter({ hasText: 'Plan the retro' });
  await ev.dblclick();
  await page.getByTestId('cal-open-board').click();
  await expect(page.getByTestId('selection-outline')).toHaveCount(1);

  await page.getByRole('tab', { name: /Calendar/ }).click();
  await page.getByTestId('cal-menu').click();
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByTestId('cal-export').click()]);
  const file = await download.path();
  expect(readFileSync(file, 'utf8')).toContain('SUMMARY:Plan the retro');

  await addCalendar(page);
  await page.getByTestId('cal-menu').click();
  await page.getByTestId('cal-import-input').setInputFiles(file);
  await expect(page.getByTestId('cal-import-summary')).toContainText('Imported 1 event');
  await ctx.close();
});
```

About the spec:
- **The `cal-import-input` step.** In the final test, `cal-import-input` is the hidden file input, so `setInputFiles` works without clicking the Import item. If the menu closes on a click outside, the input must still be in the DOM. Render it in the header, not inside the menu.
- **Page tabs.** If the page tabs are not ARIA tabs, use the locator that `e2e/pages.spec.ts` uses for tabs. That file also asserts `aria-selected`, so the tabs are ARIA tabs.
- **Timing.** Every step must be robust to timing: use `expect(...).toHave…` waits, never sleeps.

- [ ] **Step 2: Run the new spec**

Run: `npx playwright test e2e/calendar.spec.ts`
Expected: PASS (4 tests).

If a test fails because of a product bug, fix the product with the smallest change, add a unit test for it when one fits, and report it. Only change the spec when the spec is wrong about the UI, for example a test id or copy defined in Tasks 8–10. Never weaken what a test proves.

- [ ] **Step 3: Run the full verification**

Run each of these, and record the exact counts for Task 12:
- `npm test` (core, web and sync-server counts)
- `npm run typecheck`
- `npm run lint`
- `npm run build -w @relay/web`
- `npx playwright test` (expected: 36 passed)

- [ ] **Step 4: Commit**

```bash
git add e2e/calendar.spec.ts
git commit -m "test(e2e): calendar across time zones, series exceptions, RSVP, viewers, .ics and Add to calendar"
```

Also add any product fix files if Step 2 needed them, each committed separately with a `fix(...)` message.

---

### Task 12: README (EN and ES)

**Files:**
- Modify: `README.md` and `README.es.md`. The user asked for README updates in this phase's request.

**Interfaces:**
- Consumes: the counts from Task 11.

- [ ] **Step 1: Update both READMEs, keeping their structure and tone**

`README.es.md` is natural Spanish, parallel to the English file.

1. **"What it does":** add a **Calendar pages** bullet after "Graphs", covering:
   - month and week views, drag to create, move and resize;
   - repeating events (daily, weekly, monthly, yearly) where "Only this event / All events" edits one occurrence or the whole series;
   - each viewer sees times in their own zone, while an event keeps its creator's wall time across DST;
   - live RSVP;
   - `.ics` export and import (a bounded subset, with line-numbered warnings);
   - "Add to calendar…" from a sticky, with a link back to it.
2. **Key decisions table:** add a row:
   - Decision: `Calendar time`
   - How: "Timed events store wall time plus an IANA zone; conversion uses `Intl` only (no date library), with explicit rules for DST gaps and overlaps; recurrence expands only the visible window"
   - Why it matters: "A weekly 09:00 meeting stays at 09:00 through DST changes, every viewer sees their own local time, and the engine is pure and property-tested"
3. **The plans list:** add `[F4 P5](docs/superpowers/plans/2026-09-29-relay-p5-calendar.md)`.
4. **The `packages/core` line** in the repository layout: append `, calendar (zones, recurrence, .ics)`.
5. **Tests:**
   - update the `npm test` line with the new total and the per-package counts;
   - update the `npm run e2e` count;
   - extend the table rows: core gains "calendar zones, recurrence and .ics round trips", web gains "the calendar store, layout and controller", and e2e gains "calendars across time zones, series exceptions, live RSVP and .ics".
6. **Roadmap:** mark `P5 calendar page` done, with a short summary, and make "F5 — Ship" next.

- [ ] **Step 2: Check the links and lint**

Run: `npm run lint`. Also confirm that every relative link in both READMEs points to an existing file.

- [ ] **Step 3: Commit**

```bash
git add README.md README.es.md
git commit -m "docs(readme): calendar pages, updated tests and roadmap (EN + ES)"
```

---

## Self-review (done while writing this plan)

- **Spec coverage.** Each spec requirement maps to a task:

  | Spec requirement | Task |
  |---|---|
  | Data model | 2 |
  | Commands and caps | 3 |
  | Zones | 1 |
  | Recurrence | 4 |
  | Views | 6, 8 |
  | Editing and series questions | 7, 9 |
  | Presence | 6, 9 |
  | Normalize on read | 2 |
  | `.ics` export and import | 5, 10 |
  | Add to calendar and Open on board | 9, 10 |
  | Keyboard | 8 |
  | Page lifecycle | 2, 8 |
  | Roles | 7, 8, 9, 10, and e2e in 11 |
  | Testing | every task |
  | README | 12 |

- **Deviation recorded.** A new calendar page made from the "Add to calendar" dialog is named like one made from "+" ("Calendar N"). Task 10 fixes the spec's wording to match.
- **Type consistency.** These names are the same in every task:

  | Kind | Names |
  |---|---|
  | Core types | `When`, `Rule`, `Exception`, `EventFields`, `EventPatch`, `ImportedEventWrite`, `Occurrence`, `Window` |
  | Controller API | `OccRef`, `EditorDraft`, `Scope`, `SeriesQuestion` |
  | Core functions | `expandAll`, `occurrenceWhen`, `whenRange` |
  | Board controller | `revealShape`, `addStickyToCalendar`, `setAddToCalendar`, `commitSession` |
  | Presence and layout | `setCalEvent`, `viewWindow` |
