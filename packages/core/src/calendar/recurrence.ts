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

export interface ExpandWindow {
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
  return { start: whenStart(w, zone), end: whenEnd(w, zone) };
}

/** When `w` starts; all-day dates are read in `zone`. */
function whenStart(w: When, zone: string): number {
  return w.allDay
    ? toInstant({ ...dateOf(w.start), hh: 0, mm: 0 }, zone)
    : toInstant(wallOf(w.start), w.tz);
}

/** When `w` ends, exclusive; all-day dates are read in `zone`. */
function whenEnd(w: When, zone: string): number {
  return w.allDay
    ? toInstant({ ...addDays(dateOf(w.end), 1), hh: 0, mm: 0 }, zone)
    : toInstant(wallOf(w.end), w.tz);
}

const startDate = (w: When): Ymd => (w.allDay ? dateOf(w.start) : wallOf(w.start));
const endDate = (w: When): Ymd => (w.allDay ? dateOf(w.end) : wallOf(w.end));

const DAY_MS = 86_400_000;

/**
 * A cheap, conservative test before `whenRange` (which costs a few `Intl` calls): false only
 * when `w` certainly misses the window. A wall date is within a day of its UTC date in every
 * zone (offsets stay under ±24 h, and a DST gap moves a time by hours), so a when whose dates
 * are more than two days from the window's UTC days cannot overlap it.
 */
function nearWindow(w: When, win: ExpandWindow): boolean {
  return (
    dayNumber(startDate(w)) <= Math.floor(win.to / DAY_MS) + 2 &&
    dayNumber(endDate(w)) >= Math.floor(win.from / DAY_MS) - 2
  );
}

/**
 * A series' occurrences before exceptions, with what they share (the first occurrence's time
 * of day and duration) worked out once. `startOn` is the cheap part (one conversion) that the
 * expansion needs to decide whether to go on; `on` builds the rest.
 */
interface Series {
  /** The instant the occurrence on `date` starts. Ascending in `date`. */
  startOn(date: Ymd): number;
  /** The occurrence on `date`, with its when and its instants (`start` is `startOn(date)`). */
  on(date: Ymd, start: number): { when: When; start: number; end: number };
}

/** `zone` places all-day dates; timed occurrences use the series' own zone. */
function seriesOf(base: When, zone: string): Series {
  if (base.allDay) {
    const span = dayNumber(dateOf(base.end)) - dayNumber(dateOf(base.start));
    return {
      startOn: (date) => toInstant({ ...date, hh: 0, mm: 0 }, zone),
      on: (date, start) => ({
        when: { allDay: true, start: formatDate(date), end: formatDate(addDays(date, span)) },
        start,
        end: toInstant({ ...addDays(date, span + 1), hh: 0, mm: 0 }, zone),
      }),
    };
  }
  const { tz } = base;
  const s = wallOf(base.start);
  const duration = toInstant(wallOf(base.end), tz) - toInstant(s, tz);
  return {
    startOn: (date) => toInstant({ ...date, hh: s.hh, mm: s.mm }, tz),
    // The start instant already fixes the date.
    on: (_date, start) => {
      const endWall = toWall(start + duration, tz);
      return {
        when: { allDay: false, start: formatWall(toWall(start, tz)), end: formatWall(endWall), tz },
        // `start` reads back as itself: it is the earliest instant with its wall time (or just
        // past a gap). The end wall time may be ambiguous, and whenRange takes the earlier
        // instant, so the end is read back the same way.
        start,
        end: toInstant(endWall, tz),
      };
    },
  };
}

/** The series' occurrence on `date` (before exceptions), with the first occurrence's duration. */
export function occurrenceWhen(base: When, date: Ymd): When {
  if (base.allDay) {
    const span = dayNumber(dateOf(base.end)) - dayNumber(dateOf(base.start));
    return { allDay: true, start: formatDate(date), end: formatDate(addDays(date, span)) };
  }
  const series = seriesOf(base, base.tz);
  return series.on(date, series.startOn(date)).when;
}

/**
 * The rule's dates in order from the series start. Without a count, it jumps close to
 * `fromDay` (it may start earlier, never later); with a count it walks from the start so
 * that the count is right.
 */
function* ruleDates(start: Ymd, rule: Rule, fromDay: number): Generator<Ymd> {
  const s = dayNumber(start);
  // An until before the start reads as the start date: the series has its first occurrence.
  const until = Math.max(
    s,
    Math.min(rule.until ? dayNumber(dateOf(rule.until)) : LAST_DAY, LAST_DAY),
  );
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

const overlaps = (r: { start: number; end: number }, win: ExpandWindow): boolean =>
  r.start < win.to && (r.end > win.from || (r.end === r.start && r.start >= win.from));

function occurrence(
  ev: CalendarEvent,
  key: string,
  base: { when: When; start: number; end: number },
  ex: Extract<Exception, { when: When }> | undefined,
  win: ExpandWindow,
): Occurrence | null {
  if (!overlaps(base, win)) return null;
  return {
    eventId: ev.id,
    key,
    when: base.when,
    start: base.start,
    end: base.end,
    title: ex?.title ?? ev.title,
    notes: ex?.notes ?? ev.notes,
    color: ex?.color ?? ev.color,
    recurring: ev.rule !== undefined,
    changed: ex !== undefined,
  };
}

/**
 * The occurrence an exception makes: null when it cancels, misses the window, or starts after
 * `cutoff` (then it could not be kept). The start is checked before the rest is built.
 */
function changedOccurrence(
  ev: CalendarEvent,
  key: string,
  ex: Exception,
  win: ExpandWindow,
  cutoff: number,
): Occurrence | null {
  if ('cancelled' in ex) return null;
  const start = whenStart(ex.when, win.zone);
  if (start >= win.to || start > cutoff) return null;
  return occurrence(ev, key, { when: ex.when, start, end: whenEnd(ex.when, win.zone) }, ex, win);
}

const byStart = (a: Occurrence, b: Occurrence): number =>
  a.start - b.start ||
  (a.eventId < b.eventId ? -1 : a.eventId > b.eventId ? 1 : 0) ||
  (a.key < b.key ? -1 : a.key > b.key ? 1 : 0);

/** Keeps the `limit` earliest occurrences (by `byStart`) of everything added to it. */
interface Earliest {
  /** Once full, an occurrence starting after this can no longer get in. */
  cutoff(): number;
  add(o: Occurrence): void;
  sorted(): Occurrence[];
}

function earliest(limit: number): Earliest {
  // A max-heap by `byStart`: the root is the latest occurrence kept.
  const heap: Occurrence[] = [];
  const at = (i: number): Occurrence => heap[i] as Occurrence;
  const swap = (i: number, j: number): void => {
    const t = at(i);
    heap[i] = at(j);
    heap[j] = t;
  };
  return {
    cutoff: () =>
      heap.length < limit ? Number.POSITIVE_INFINITY : (heap[0]?.start ?? Number.NEGATIVE_INFINITY),
    add(o) {
      if (heap.length < limit) {
        heap.push(o);
        for (let i = heap.length - 1; i > 0; ) {
          const parent = (i - 1) >> 1;
          if (byStart(at(i), at(parent)) <= 0) break;
          swap(i, parent);
          i = parent;
        }
        return;
      }
      if (heap.length === 0 || byStart(o, at(0)) >= 0) return;
      heap[0] = o;
      for (let i = 0; ; ) {
        const l = 2 * i + 1;
        const r = l + 1;
        let top = i;
        if (l < heap.length && byStart(at(l), at(top)) > 0) top = l;
        if (r < heap.length && byStart(at(r), at(top)) > 0) top = r;
        if (top === i) break;
        swap(i, top);
        i = top;
      }
    },
    sorted: () => [...heap].sort(byStart),
  };
}

/**
 * Adds the event's occurrences overlapping the window to `sink`. The rule's dates ascend and
 * so do their unchanged starts, so the walk stops at the first start past the sink's cutoff;
 * the dates it never reached are still checked for exceptions that move them earlier.
 */
function collect(ev: CalendarEvent, win: ExpandWindow, sink: Earliest): void {
  const start = startDate(ev.when);
  if (!ev.rule) {
    const o = occurrence(
      ev,
      formatDate(start),
      { when: ev.when, ...whenRange(ev.when, win.zone) },
      undefined,
      win,
    );
    if (o) sink.add(o);
    return;
  }
  const series = seriesOf(ev.when, win.zone);
  const first = whenRange(ev.when, win.zone);
  const span = Math.max(0, first.end - first.start);
  const frame = ev.when.allDay ? win.zone : ev.when.tz;
  const fromDay = dayNumber(toWall(win.from - span, frame)) - 1;
  const toDay = dayNumber(toWall(win.to, frame)) + 1;
  const handled = new Set<string>();
  let index = 0;
  for (const date of ruleDates(start, ev.rule, fromDay)) {
    if (ev.rule.count !== undefined && index >= ev.rule.count) break;
    index++;
    const n = dayNumber(date);
    if (n > toDay) break;
    if (n < fromDay) continue;
    const at = series.startOn(date);
    if (at > sink.cutoff()) break;
    const key = formatDate(date);
    handled.add(key);
    const ex = ev.exceptions[key];
    const o = ex
      ? changedOccurrence(ev, key, ex, win, sink.cutoff())
      : occurrence(ev, key, series.on(date, at), undefined, win);
    if (o) sink.add(o);
  }
  // An exception can move its occurrence into the window from a date outside it (or from a
  // date past where the walk stopped).
  let counted: Set<number> | undefined;
  for (const [key, ex] of Object.entries(ev.exceptions)) {
    if (handled.has(key) || 'cancelled' in ex || !nearWindow(ex.when, win)) continue;
    const date = parseDate(key);
    if (!date) continue;
    if (ev.rule.count === undefined) {
      if (!isOccurrence(ev, date)) continue;
    } else {
      // A counted series has at most 999 dates: list them once instead of re-walking from
      // the start for every exception.
      counted ??= countedDays(start, ev.rule, ev.rule.count);
      if (!counted.has(dayNumber(date))) continue;
    }
    const o = changedOccurrence(ev, key, ex, win, sink.cutoff());
    if (o) sink.add(o);
  }
}

/** The day numbers of a counted series' first `count` dates. */
function countedDays(start: Ymd, rule: Rule, count: number): Set<number> {
  const days = new Set<number>();
  let index = 0;
  for (const d of ruleDates(start, rule, 0)) {
    if (index++ >= count) break;
    days.add(dayNumber(d));
  }
  return days;
}

/** The event's occurrences overlapping the window, sorted by start (the first `limit`). */
export function expand(
  ev: CalendarEvent,
  win: ExpandWindow,
  limit = MAX_OCCURRENCES,
): Occurrence[] {
  const sink = earliest(limit);
  collect(ev, win, sink);
  return sink.sorted();
}

/**
 * Every event's occurrences in the window, sorted by start, then event id, then key: the
 * first `limit`, and whether there were more. Only the `limit + 1` earliest are ever kept, and
 * each event's walk stops once it cannot add to them.
 */
export function expandAll(
  cal: CalendarSnapshot,
  win: ExpandWindow,
  limit = MAX_OCCURRENCES,
): { occurrences: Occurrence[]; truncated: boolean } {
  const sink = earliest(limit + 1);
  for (const ev of cal.events) collect(ev, win, sink);
  const all = sink.sorted();
  return { occurrences: all.slice(0, limit), truncated: all.length > limit };
}
