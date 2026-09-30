import {
  type CalendarEvent,
  type CalendarSnapshot,
  EVENT_COLORS,
  type EventFields,
  type Exception,
  FREQS,
  MAX_ALLDAY_DAYS,
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
  safeZone,
  toInstant,
  toWall,
  type Wall,
  wallMinutes,
  type Ymd,
} from './time';

export const MAX_ICS_BYTES = 1024 * 1024;
const DAYS = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

export interface IcsEvent {
  /** The file's UID; undefined when the event had none (it then matches no other event). */
  uid: string | undefined;
  fields: Omit<EventFields, 'createdBy' | 'createdAt'>;
  exceptions: Record<string, Exception>;
}

export interface IcsWarning {
  line: number;
  message: string;
}

// ---------- writing ----------

const escapeText = (s: string): string =>
  s
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r\n|\r|\n/g, '\\n');

/** Whether `line` is ASCII and at most 75 characters: 75 octets or fewer, nothing to fold. */
function shortAscii(line: string): boolean {
  if (line.length > 75) return false;
  for (let i = 0; i < line.length; i++) if (line.charCodeAt(i) > 0x7f) return false;
  return true;
}

/** UTF-8 octets of a code point (a lone surrogate is written as U+FFFD, 3 octets). */
const utf8Size = (c: number): number => (c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4);

/** Folds a content line into lines of at most 75 octets, never splitting a character. */
function fold(line: string): string[] {
  if (shortAscii(line)) return [line];
  const out: string[] = [];
  let from = 0;
  let bytes = 0;
  for (let i = 0; i < line.length; ) {
    const c = line.codePointAt(i) as number;
    const size = utf8Size(c);
    if (bytes + size > (out.length === 0 ? 75 : 74)) {
      out.push(line.slice(from, i));
      from = i;
      bytes = 0;
    }
    bytes += size;
    i += c > 0xffff ? 2 : 1;
  }
  out.push(line.slice(from));
  return out.map((l, i) => (i === 0 ? l : ` ${l}`));
}

const compactDate = (date: string): string => date.replace(/-/g, '');
const compactWall = (wall: string): string => `${wall.replace(/[-:]/g, '')}00`;
function utcStamp(ms: number): string {
  return new Date(ms)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}/, '');
}

function dtLines(w: When): string[] {
  if (w.allDay) {
    const end = addDays(parseDate(w.end) ?? { y: 1970, m: 1, d: 1 }, 1);
    return [
      `DTSTART;VALUE=DATE:${compactDate(w.start)}`,
      `DTEND;VALUE=DATE:${compactDate(formatDate(end))}`,
    ];
  }
  return [
    `DTSTART;TZID=${w.tz}:${compactWall(w.start)}`,
    `DTEND;TZID=${w.tz}:${compactWall(w.end)}`,
  ];
}

/** The occurrence on `key` as an EXDATE / RECURRENCE-ID value (with its parameters). */
function occurrenceRef(base: When, key: string): string {
  if (base.allDay) return `;VALUE=DATE:${compactDate(key)}`;
  return `;TZID=${base.tz}:${compactDate(key)}T${base.start.slice(11).replace(':', '')}00`;
}

function rruleText(rule: Rule, base: When): string {
  const parts = [`FREQ=${rule.freq.toUpperCase()}`];
  if (rule.interval > 1) parts.push(`INTERVAL=${rule.interval}`);
  if (rule.freq === 'weekly' && rule.byDay)
    parts.push(`BYDAY=${rule.byDay.map((d) => DAYS[d]).join(',')}`);
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
  const lines = [
    'BEGIN:VEVENT',
    `UID:${uid}`,
    `DTSTAMP:${stamp}`,
    ...dtLines(ev.when),
    `SUMMARY:${escapeText(ev.title)}`,
  ];
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
    lines.push(
      'BEGIN:VEVENT',
      `UID:${uid}`,
      `DTSTAMP:${stamp}`,
      `RECURRENCE-ID${occurrenceRef(ev.when, key)}`,
    );
    lines.push(...dtLines(ex.when), `SUMMARY:${escapeText(ex.title ?? ev.title)}`);
    const notes = ex.notes ?? ev.notes;
    // An empty DESCRIPTION keeps notes cleared on this occurrence only.
    if (notes || (ex.notes === '' && ev.notes)) lines.push(`DESCRIPTION:${escapeText(notes)}`);
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

/** Resolves a TZID seen on physical line `line` to the zone it is read in. */
type ZoneResolver = (tzid: string, line: number) => string;

/**
 * A TZID resolver for one `parseIcs` call: each distinct TZID is checked (and, when unknown,
 * warned about at its first line) once, however many values use it.
 */
function zoneResolver(warn: (line: number, m: string) => void): ZoneResolver {
  const zones = new Map<string, string>();
  return (tzid, line) => {
    const known = zones.get(tzid);
    if (known !== undefined) return known;
    // Taken before the check: `isValidZone` is a type guard, so `tzid` is `never` past it.
    const shown = tzid.slice(0, 40);
    let tz = 'UTC';
    if (isValidZone(tzid)) tz = safeZone(tzid);
    else warn(line, `Unknown time zone "${shown}"; read as UTC`);
    zones.set(tzid, tz);
    return tz;
  };
}

/** No TZID parameter can reach this resolver (UNTIL values carry none). */
const noZones: ZoneResolver = () => 'UTC';

/** `zone` is where floating and UTC values are read; `line` is where a TZID warning points. */
function readTime(
  value: string,
  params: Record<string, string>,
  zone: string,
  zoneOf: ZoneResolver,
  line: number,
): IcsTime | null {
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
    return {
      kind: 'time',
      wall: toWall(Date.UTC(wall.y, wall.m - 1, wall.d, wall.hh, wall.mm), zone),
      tz: zone,
    };
  }
  const tzid = params.TZID;
  if (tzid === undefined) return { kind: 'time', wall, tz: zone };
  return { kind: 'time', wall, tz: zoneOf(tzid, line) };
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
  const [w, d, h, m] = [r[1], r[2], r[3], r[4]].map((x) => Number(x ?? 0)) as [
    number,
    number,
    number,
    number,
  ];
  // Longer than any event can last: clamp so the wall arithmetic stays in range.
  return Math.min(((w * 7 + d) * 24 + h) * 60 + m, MAX_ALLDAY_DAYS * 1440);
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
  // Weeks start on Monday here; another week start changes which days an interval skips.
  const wkst = parts.get('WKST');
  if (wkst !== undefined && wkst !== 'MO') return null;
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
    // A UTC UNTIL names an instant and a floating one a wall time in the event's zone; either
    // way its date is the one in the event's own zone.
    const eventZone = start.kind === 'time' ? start.tz : zone;
    const t = readTime(until, {}, eventZone, noZones, 0);
    if (!t) return null;
    rule.until = t.kind === 'date' ? formatDate(t.date) : dateIn(t, eventZone);
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

function whenOf(props: Prop[], zone: string, zoneOf: ZoneResolver): When | null {
  const get = (n: string) => props.find((p) => p.name === n);
  const ds = get('DTSTART');
  if (!ds) return null;
  const start = readTime(ds.value, ds.params, zone, zoneOf, ds.line);
  if (!start) return null;
  const de = get('DTEND');
  const end = de ? readTime(de.value, de.params, zone, zoneOf, de.line) : null;
  const dur = get('DURATION');
  const minutes = dur ? durationMinutes(dur.value) : null;
  if (start.kind === 'date') {
    let last = start.date;
    if (end?.kind === 'date') last = addDays(end.date, -1);
    else if (minutes !== null)
      last = addDays(start.date, Math.max(1, Math.ceil(minutes / 1440)) - 1);
    if (dayNumber(last) < dayNumber(start.date)) last = start.date;
    return readWhen({ allDay: true, start: formatDate(start.date), end: formatDate(last) });
  }
  let endWall = fromWallMinutes(wallMinutes(start.wall) + 60);
  if (end?.kind === 'time')
    endWall = end.tz === start.tz ? end.wall : toWall(toInstant(end.wall, end.tz), start.tz);
  else if (minutes !== null) endWall = fromWallMinutes(wallMinutes(start.wall) + minutes);
  return readWhen({
    allDay: false,
    start: formatWall(start.wall),
    end: formatWall(endWall),
    tz: start.tz,
  });
}

/** Reads the subset of `.ics` Relay can represent; everything else becomes a warning. */
export function parseIcs(
  text: string,
  opts: { zone: string },
): { events: IcsEvent[]; warnings: IcsWarning[] } {
  const warnings: IcsWarning[] = [];
  const warn = (line: number, message: string) => warnings.push({ line, message });
  const zoneOf = zoneResolver(warn);
  const events: IcsEvent[] = [];
  const byUid = new Map<string, IcsEvent>();
  const overrides: { uid: string; raw: RawEvent }[] = [];
  for (const raw of components(contentLines(text))) {
    const get = (n: string) => raw.props.find((p) => p.name === n);
    const fileUid = unescapeText(get('UID')?.value ?? '').slice(0, MAX_UID);
    const uid = fileUid || undefined;
    // In-file key: an event without a UID is its own series, and never a duplicate.
    const key = uid ?? `import-${raw.line}`;
    if (get('RECURRENCE-ID')) {
      overrides.push({ uid: key, raw });
      continue;
    }
    if (byUid.has(key)) {
      warn(raw.line, `Duplicate event "${key.slice(0, 40)}"; skipped`);
      continue;
    }
    const when = whenOf(raw.props, opts.zone, zoneOf);
    if (!when) {
      warn(raw.line, 'Event without a valid start; skipped');
      continue;
    }
    const summary = unescapeText(get('SUMMARY')?.value ?? '')
      .trim()
      .slice(0, MAX_EVENT_TITLE);
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
        : {
            kind: 'time',
            wall: parseWall(when.start) ?? { y: 1970, m: 1, d: 1, hh: 0, mm: 0 },
            tz: when.tz,
          };
      const rule = readRrule(rr.value, start, opts.zone);
      if (rule) fields.rule = rule;
      else warn(raw.line, 'Repeat rule not supported; only the first date was imported');
    }
    const ev: IcsEvent = { uid, fields, exceptions: {} };
    if (fields.rule) {
      // Checked before each value is read, so a huge EXDATE list costs nothing past the cap.
      const full = () => Object.keys(ev.exceptions).length >= MAX_EXCEPTIONS;
      for (const p of raw.props.filter((x) => x.name === 'EXDATE')) {
        if (full()) break;
        for (const v of p.value.split(',')) {
          if (full()) break;
          const t = readTime(v, p.params, opts.zone, zoneOf, p.line);
          if (t) ev.exceptions[dateIn(t, tzOfEvent)] = { cancelled: true };
        }
      }
    }
    byUid.set(key, ev);
    events.push(ev);
  }
  for (const { uid, raw } of overrides) {
    const master = byUid.get(uid);
    const rid = raw.props.find((p) => p.name === 'RECURRENCE-ID');
    if (!master?.fields.rule || !rid) {
      warn(raw.line, 'A changed occurrence has no series; skipped');
      continue;
    }
    const t = readTime(rid.value, rid.params, opts.zone, zoneOf, rid.line);
    const when = whenOf(raw.props, opts.zone, zoneOf);
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
    if (Object.keys(master.exceptions).length < MAX_EXCEPTIONS || key in master.exceptions)
      master.exceptions[key] = ex;
  }
  return { events, warnings };
}
