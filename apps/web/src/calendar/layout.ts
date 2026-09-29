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
const midnight = (date: string, zone: string): number =>
  toInstant({ ...dateOf(date), hh: 0, mm: 0 }, zone);

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
  return {
    from: midnight(first, zone),
    to: midnight(formatDate(addDays(dateOf(first), days)), zone),
    zone,
  };
}

/** First and last local day (day numbers in `zone`) an occurrence covers. */
export function occurrenceDays(o: Occurrence, zone: string): { first: number; last: number } {
  if (o.when.allDay)
    return { first: dayNumber(dateOf(o.when.start)), last: dayNumber(dateOf(o.when.end)) };
  const first = dayNumber(toWall(o.start, zone));
  const last = o.end > o.start ? dayNumber(toWall(o.end - 1, zone)) : first;
  return { first, last };
}

/** Greedy interval lane packing: each item gets the first lane free from its start. */
function packLanes<T extends { start: number; end: number }>(
  items: T[],
): { item: T; lane: number }[] {
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
      if (lane < MONTH_LINES)
        bars.push({ occ: item.occ, row, startCol: item.start - lo, endCol: item.end - lo, lane });
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
  const allDay = packed.map(({ item, lane }) => ({
    occ: item.occ,
    startCol: item.start,
    endCol: item.end,
    lane,
  }));
  const boxes: WeekBox[] = [];
  days.forEach((date, day) => {
    const dayStart = midnight(date, zone);
    const dayEnd = midnight(formatDate(addDays(dateOf(date), 1)), zone);
    const segs = occs
      .filter(
        (o) =>
          !o.when.allDay &&
          o.start < dayEnd &&
          (o.end > dayStart || (o.end === o.start && o.start >= dayStart)),
      )
      .map((o) => {
        const s = Math.max(o.start, dayStart);
        const e = Math.min(o.end, dayEnd);
        const w = toWall(s, zone);
        const top = w.hh * 60 + w.mm;
        const bottom =
          e >= dayEnd
            ? 1440
            : (() => {
                const x = toWall(e, zone);
                return x.hh * 60 + x.mm;
              })();
        return { occ: o, top, bottom: Math.max(bottom, top + SNAP_MIN) };
      })
      .sort((a, b) => a.top - b.top || b.bottom - a.bottom);
    // Clusters of transitively overlapping boxes share the day's width.
    let cluster: { occ: Occurrence; top: number; bottom: number; col: number }[] = [];
    let clusterEnd = -1;
    const flush = () => {
      const cols = cluster.reduce((n, b) => Math.max(n, b.col + 1), 0);
      for (const b of cluster)
        boxes.push({ occ: b.occ, day, top: b.top, height: b.bottom - b.top, col: b.col, cols });
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

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
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
