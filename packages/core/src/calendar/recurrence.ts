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
