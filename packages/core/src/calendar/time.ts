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
export const formatDate = (d: Ymd): string =>
  `${String(d.y).padStart(4, '0')}-${p2(d.m)}-${p2(d.d)}`;
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

// One formatter per zone, in a small LRU. Zone names can come from peers, so the cache is
// bounded, a rejected name is never cached, and names that cannot be IANA zones never reach
// Intl or the map.
const MAX_CACHED_ZONES = 200;
const MAX_ZONE_LENGTH = 64;
const ZONE_RE = /^(UTC|[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)*)$/;
const formatters = new Map<string, Intl.DateTimeFormat>();

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

function formatter(tz: unknown): Intl.DateTimeFormat | null {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > MAX_ZONE_LENGTH) return null;
  if (!ZONE_RE.test(tz)) return null;
  const cached = formatters.get(tz);
  if (cached !== undefined) {
    // Refresh recency.
    formatters.delete(tz);
    formatters.set(tz, cached);
    return cached;
  }
  const f = makeFormatter(tz);
  if (!f) return null;
  if (formatters.size >= MAX_CACHED_ZONES) {
    const oldest = formatters.keys().next().value;
    if (oldest !== undefined) formatters.delete(oldest);
  }
  formatters.set(tz, f);
  return f;
}

export const isValidZone = (tz: unknown): tz is string => formatter(tz) !== null;

/** `tz` in its canonical IANA spelling (`europe/madrid` → `Europe/Madrid`), or `'UTC'`. */
export const safeZone = (tz: unknown): string => formatter(tz)?.resolvedOptions().timeZone ?? 'UTC';

// Offsets cached per zone and 15-minute UTC bucket, in an LRU: `Intl` formatting is by far
// the slowest part of wall-time conversion, and expanding a calendar converts thousands of
// times. Modern transitions fall on 15-minute UTC boundaries, so a zone's offset is constant
// within a bucket. Historical local mean time changes at odd seconds (pre-1980 edge cases) may
// read up to 15 minutes off inside the bucket that holds the change.
const OFFSET_BUCKET_MS = 900_000;
const MAX_CACHED_OFFSETS = 20_000;
const offsets = new Map<string, number>();

/**
 * Offset of `tz` from UTC at instant `ms`, in minutes (east positive). An unknown zone reads
 * as UTC; a non-finite `ms` gives 0. Cached per 15-minute bucket (see above).
 */
export function zoneOffset(ms: number, tz: string): number {
  if (!Number.isFinite(ms)) return 0;
  // Only names that could be zones are cached, so a key stays short.
  if (typeof tz !== 'string' || tz.length > MAX_ZONE_LENGTH) return intlOffset(ms, tz);
  const key = `${tz}|${Math.floor(ms / OFFSET_BUCKET_MS)}`;
  const cached = offsets.get(key);
  if (cached !== undefined) {
    // Refresh recency.
    offsets.delete(key);
    offsets.set(key, cached);
    return cached;
  }
  const offset = intlOffset(ms, tz);
  if (offsets.size >= MAX_CACHED_OFFSETS) {
    const oldest = offsets.keys().next().value;
    if (oldest !== undefined) offsets.delete(oldest);
  }
  offsets.set(key, offset);
  return offset;
}

/** `zoneOffset` straight from `Intl`, without the cache. */
function intlOffset(ms: number, tz: string): number {
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

/**
 * The wall time at instant `ms` in `tz`. Historical offsets with seconds (LMT) are rounded to
 * whole minutes.
 */
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
 * the length of the gap. Historical offsets with seconds (LMT) are rounded to whole minutes.
 */
export function toInstant(w: Wall, tz: string): number {
  const guess = Date.UTC(w.y, w.m - 1, w.d, w.hh, w.mm);
  const before = zoneOffset(guess - DAY_MS, tz);
  const after = zoneOffset(guess + DAY_MS, tz);
  const target = wallMinutes(w);
  // With no change within a day either side, both candidates are the same instant.
  const hits = (before === after ? [before] : [before, after])
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
