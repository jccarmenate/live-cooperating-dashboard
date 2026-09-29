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
        o.byDay.filter(
          (d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 0 && d <= 6,
        ),
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
