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
  type IcsWarning,
  importUpdateSize,
  isOccurrence,
  MAX_ALLDAY_DAYS,
  MAX_EVENT_NOTES,
  MAX_EVENT_TITLE,
  MAX_EVENTS,
  MAX_EXCEPTIONS,
  MAX_ICS_BYTES,
  MAX_PASTE_BYTES,
  MAX_TIMED_DAYS,
  MIN_EVENT_MINUTES,
  newEventId,
  type Occurrence,
  occurrenceWhen,
  parseDate,
  parseIcs,
  parseWall,
  type RsvpStatus,
  type Rule,
  todayIn,
  toInstant,
  toWall,
  type Wall,
  type When,
  wallMinutes,
  writeIcs,
  type Ymd,
} from '@relay/core';
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { CalendarState } from '../store/calendarStore';
import { firstOfGrid, gridFocus, viewWindow } from './layout';

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
  /** Only "All events" applies (the rule changed): answering 'one' does nothing. */
  allOnly?: true;
}

export interface CalendarUi {
  view: CalView;
  /** A date inside the shown period. */
  anchor: string;
  /**
   * The Monday the month view's 6-week grid starts on. The arrows and Today set it to a
   * month's own grid; the mouse wheel rolls it a week at a time.
   */
  monthStart: string;
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
  /** Deleting is allowed (an editor on a full board); defaults to `canEdit`. */
  canDelete?(): boolean;
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
  /** Mouse wheel: the month grid rolls by `weeks` rows; the week view moves by `weeks` weeks. */
  scrollWeeks(weeks: number): void;
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
  /** The calendar as an .ics file named `name`; null when there is no calendar. Viewers too. */
  exportIcs(name: string): string | null;
  /**
   * Imports an .ics file as one undo step, skipping events whose UID is already here. Null
   * when refused (with a notice), when the user cannot edit, or when the calendar shown is no
   * longer `expectPage` (when given).
   */
  importIcs(
    text: string,
    expectPage?: string,
  ): { imported: number; skipped: number; warnings: IcsWarning[] } | null;
  destroy(): void;
}

type Changed = Extract<Exception, { when: When }>;

const EPOCH: Ymd = { y: 1970, m: 1, d: 1 };
const DAY_MINUTES = 24 * 60;
const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;
const dateOf = (s: string): Ymd => parseDate(s) ?? EPOCH;
const wallOf = (s: string): Wall => parseWall(s) ?? { ...EPOCH, hh: 0, mm: 0 };
const p2 = (n: number) => String(n).padStart(2, '0');
const hhmm = (minutes: number) => `${p2(Math.floor(minutes / 60))}:${p2(minutes % 60)}`;
const minutesOf = (time: string): number => {
  const [h, m] = time.split(':').map(Number) as [number, number];
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0;
};
const atMinutes = (date: Ymd, minutes: number): Wall => ({
  y: date.y,
  m: date.m,
  d: date.d,
  hh: Math.floor(minutes / 60),
  mm: minutes % 60,
});

/** A when's first day in its own frame (the event's zone for timed events). */
const firstDate = (w: When): Ymd => {
  if (w.allDay) return dateOf(w.start);
  const { y, m, d } = wallOf(w.start);
  return { y, m, d };
};
const startDay = (w: When): number => dayNumber(firstDate(w));
/** Minutes from midnight of a timed start, in the event's zone; -1 for all-day. */
const timeOfDay = (w: When): number => {
  if (w.allDay) return -1;
  const s = wallOf(w.start);
  return s.hh * 60 + s.mm;
};
/** Days an all-day when spans after its first (0 for a one-day event); 0 for timed. */
const spanOf = (w: When): number =>
  w.allDay ? dayNumber(dateOf(w.end)) - dayNumber(dateOf(w.start)) : 0;
/** A timed when's real (instant) duration in ms; 0 for all-day. */
const realMs = (w: When): number =>
  w.allDay ? 0 : toInstant(wallOf(w.end), w.tz) - toInstant(wallOf(w.start), w.tz);
/**
 * The timed when starting at the wall time `start` in `tz` and lasting `ms` of real time. The
 * start is stored as given, even in a DST gap: a series base keeps its time of day, and each
 * occurrence resolves the gap on its own day.
 */
const timedFrom = (start: Wall, ms: number, tz: string): When => ({
  allDay: false,
  start: formatWall(start),
  end: formatWall(toWall(toInstant(start, tz) + ms, tz)),
  tz,
});

/** A weekly rule's days turned with its start, when the series moved `dayDelta` days. */
function rotateRule(rule: Rule | undefined, dayDelta: number): Rule | undefined {
  const turn = ((dayDelta % 7) + 7) % 7;
  if (rule?.freq !== 'weekly' || !rule.byDay?.length || turn === 0) return rule;
  const byDay = [...new Set(rule.byDay.map((d) => (d + turn) % 7))].sort((a, b) => a - b);
  return { ...rule, byDay };
}

const sameWhen = (a: When, b: When): boolean =>
  a.start === b.start && a.end === b.end && (a.allDay ? b.allDay : !b.allDay && a.tz === b.tz);

/** Whether two drafts show the same dates, times and all-day flag (times ignored all-day). */
const sameTiming = (a: EditorDraft, b: EditorDraft): boolean =>
  a.allDay === b.allDay &&
  a.startDate === b.startDate &&
  a.endDate === b.endDate &&
  (a.allDay || (a.startTime === b.startTime && a.endTime === b.endTime));

/** What an edit changed about an occurrence, as the user sees it (`occ` → `next`). */
function changesOf(occ: When, next: When) {
  const allDayChanged = next.allDay !== occ.allDay;
  return {
    dayDelta: startDay(next) - startDay(occ),
    allDayChanged,
    timeChanged: timeOfDay(next) !== timeOfDay(occ),
    durChanged:
      allDayChanged || (next.allDay ? spanOf(next) !== spanOf(occ) : realMs(next) !== realMs(occ)),
  };
}

/** The part of a rule the editor can express; equal keys mean "unchanged". */
function ruleKey(rule: Rule | undefined): string {
  if (!rule) return 'none';
  const byDay = rule.freq === 'weekly' ? [...new Set(rule.byDay ?? [])].sort((a, b) => a - b) : [];
  const end =
    rule.count !== undefined ? { count: rule.count } : rule.until ? { until: rule.until } : null;
  return JSON.stringify([rule.freq, rule.interval, byDay, end]);
}

export function createCalendarController(opts: CalendarControllerOptions): CalendarController {
  const zone = opts.zone;
  const newId = opts.newId ?? newEventId;
  /** The anchor, and the month grid of the anchor's month. */
  const at = (anchor: string) => {
    const a = dateOf(anchor);
    return { anchor, monthStart: firstOfGrid(a.y, a.m) };
  };
  const ui = createStore<CalendarUi>(() => ({
    view: 'month',
    ...at(todayIn(opts.now(), zone)),
    selected: null,
    editor: null,
    question: null,
  }));
  /** The open series question's action; it re-reads the event when it runs. */
  let pending: { ref: OccRef; run: (scope: Scope) => void } | null = null;

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

  const ask = (ref: OccRef, question: SeriesQuestion, run: (scope: Scope) => void) => {
    pending = { ref, run };
    ui.setState({ question });
  };

  const commitEvent = (...commands: Command[]) => opts.commit(...commands);
  const canDelete = () => (opts.canDelete ? opts.canDelete() : opts.canEdit());

  /** A when as the viewer sees it: dates and times in the viewer's zone. */
  const viewerFields = (w: When) => {
    if (w.allDay)
      return {
        allDay: true,
        startDate: w.start,
        startTime: '09:00',
        endDate: w.end,
        endTime: '10:00',
      };
    const s = toWall(toInstant(wallOf(w.start), w.tz), zone);
    const e = toWall(toInstant(wallOf(w.end), w.tz), zone);
    return {
      allDay: false,
      startDate: formatDate(s),
      startTime: hhmm(s.hh * 60 + s.mm),
      endDate: formatDate(e),
      endTime: hhmm(e.hh * 60 + e.mm),
    };
  };

  const draftOf = (
    ev: CalendarEvent | null,
    when: When,
    title: string,
    notes: string,
    color: string,
  ): EditorDraft => {
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

  const split = (time: string) => {
    const m = minutesOf(time);
    return { hh: Math.floor(m / 60), mm: m % 60 };
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
    const start = toInstant({ ...sd, ...split(d.startTime) }, zone);
    const end = toInstant({ ...ed, ...split(d.endTime) }, zone);
    if (end < start) return 'The end is before the start';
    if (end - start < MIN_EVENT_MINUTES * MINUTE_MS) return 'An event lasts at least 15 minutes';
    if (end - start > MAX_TIMED_DAYS * DAY_MS) return 'An event can last at most 14 days';
    return {
      allDay: false,
      start: formatWall(toWall(start, tz)),
      end: formatWall(toWall(end, tz)),
      tz,
    };
  };

  const ruleOfDraft = (d: EditorDraft): Rule | undefined => {
    if (d.repeat === 'none') return undefined;
    const rule: Rule = {
      freq: d.repeat,
      interval: Math.min(99, Math.max(1, Math.round(d.interval) || 1)),
    };
    if (d.repeat === 'weekly' && d.byDay.length > 0)
      rule.byDay = [...new Set(d.byDay)].sort((a, b) => a - b);
    if (d.ends === 'on' && parseDate(d.until)) rule.until = d.until;
    if (d.ends === 'after') rule.count = Math.min(999, Math.max(1, Math.round(d.count) || 1));
    return rule;
  };

  /**
   * "All events" from an edited occurrence: only what the user changed (`occ` → `next`) is
   * applied to the series base, never the occurrence's own exception.
   */
  const editAll = (base: When, occ: When, next: When): When => {
    const c = changesOf(occ, next);
    if (c.dayDelta === 0 && !c.allDayChanged && !c.timeChanged && !c.durChanged) return base;
    const date = addDays(firstDate(base), c.dayDelta);
    if (c.allDayChanged ? next.allDay : base.allDay) {
      const days = next.allDay && c.durChanged ? spanOf(next) : spanOf(base);
      return { allDay: true, start: formatDate(date), end: formatDate(addDays(date, days)) };
    }
    const tz = base.allDay ? zone : base.tz;
    const adopt = !next.allDay;
    const minutes = adopt && (c.allDayChanged || c.timeChanged) ? timeOfDay(next) : timeOfDay(base);
    const ms = adopt && c.durChanged ? realMs(next) : realMs(base);
    return timedFrom(atMinutes(date, minutes), ms, tz);
  };

  /** "All events" from a move gesture: the gesture's day and time-of-day shift, same duration. */
  const shiftAll = (base: When, occ: When, next: When): When => {
    const dayDelta = startDay(next) - startDay(occ);
    const minuteDelta = !occ.allDay && !next.allDay ? timeOfDay(next) - timeOfDay(occ) : 0;
    if (base.allDay) {
      const date = addDays(dateOf(base.start), dayDelta);
      return {
        allDay: true,
        start: formatDate(date),
        end: formatDate(addDays(date, spanOf(base))),
      };
    }
    const start = fromWallMinutes(
      wallMinutes(wallOf(base.start)) + dayDelta * DAY_MINUTES + minuteDelta,
    );
    return timedFrom(start, realMs(base), base.tz);
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

  /** A gesture on one occurrence: a new effective when, keeping its other changed fields. */
  const changeOne = (ev: CalendarEvent, key: string, when: When): boolean => {
    const prev = ev.exceptions[key];
    const value: Changed = { when };
    if (prev && 'when' in prev) {
      if (prev.title !== undefined) value.title = prev.title;
      if (prev.notes !== undefined) value.notes = prev.notes;
      if (prev.color !== undefined) value.color = prev.color;
    }
    return setOccurrence(ev, key, value);
  };

  /**
   * "Only this event" from the editor: the occurrence as the editor shows it, overriding only
   * the fields that differ from the series (a field set back to the series value drops out).
   */
  const overrideOne = (
    ev: CalendarEvent,
    key: string,
    when: When,
    fields: { title: string; notes: string; color: string },
  ): boolean => {
    const value: Changed = { when };
    if (fields.title !== ev.title) value.title = fields.title;
    if (fields.notes !== ev.notes) value.notes = fields.notes;
    if (fields.color !== ev.color) value.color = fields.color;
    // Everything back to the plain occurrence: its exception is no longer needed.
    if (Object.keys(value).length === 1 && sameWhen(when, occurrenceWhen(ev.when, dateOf(key)))) {
      const page = pageId();
      if (!(key in ev.exceptions)) return true;
      return !!page && commitEvent({ type: 'ClearOccurrence', pageId: page, id: ev.id, key });
    }
    return setOccurrence(ev, key, value);
  };

  /**
   * The ref if it still names an occurrence, else null. A single event's only occurrence is
   * keyed by its start day, so its ref follows the event to a new day.
   */
  const liveRef = (ref: OccRef): OccRef | null => {
    const ev = eventById(ref.eventId);
    if (!ev) return null;
    if (!ev.rule) {
      const key = formatDate(firstDate(ev.when));
      return key === ref.key ? ref : { eventId: ev.id, key };
    }
    const ex = ev.exceptions[ref.key];
    if (ex) return 'cancelled' in ex ? null : ref;
    return isOccurrence(ev, dateOf(ref.key)) ? ref : null;
  };
  const sameRef = (a: OccRef | null, b: OccRef | null) =>
    a?.eventId === b?.eventId && a?.key === b?.key;

  /** After an "All events" shift of `dayDelta` days, a selected `ref` follows its occurrence. */
  const followShift = (ref: OccRef, wasSelected: boolean, dayDelta: number) => {
    if (!wasSelected || dayDelta === 0) return;
    const key = formatDate(addDays(dateOf(ref.key), dayDelta));
    ui.setState({ selected: liveRef({ eventId: ref.eventId, key }) });
  };

  const closeIfGone = () => {
    const { editor, selected } = ui.getState();
    const patch: Partial<CalendarUi> = {};
    if (editor?.ref) {
      const ref = liveRef(editor.ref);
      if (!ref) patch.editor = null;
      else if (ref !== editor.ref) patch.editor = { ...editor, ref };
    }
    if (selected) {
      const ref = liveRef(selected);
      if (ref !== selected) patch.selected = ref;
    }
    // A series question is about one occurrence of a series: it goes when that occurrence goes,
    // and when its ref is re-keyed or the event stops repeating (a peer removed the rule).
    if (
      pending &&
      (liveRef(pending.ref) !== pending.ref || !eventById(pending.ref.eventId)?.rule)
    ) {
      pending = null;
      patch.question = null;
    }
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
      const { view, anchor, monthStart } = ui.getState();
      return expandAll(cal, viewWindow(view, anchor, zone, monthStart));
    },
    setView(view) {
      ui.setState({ view });
    },
    today() {
      ui.setState(at(todayIn(opts.now(), zone)));
    },
    step(dir) {
      ui.setState(at(shiftAnchor(dir)));
    },
    scrollWeeks(weeks) {
      const n = Math.trunc(weeks);
      if (n === 0) return;
      const { view, anchor, monthStart } = ui.getState();
      if (view === 'week') {
        ui.setState(at(formatDate(addDays(dateOf(anchor), n * 7))));
        return;
      }
      const start = formatDate(addDays(dateOf(monthStart), n * 7));
      ui.setState({ monthStart: start, anchor: gridFocus(start) });
    },
    goTo(date) {
      if (parseDate(date)) ui.setState(at(date));
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
      const end = Math.max(at?.end ?? start + 60, start + MIN_EVENT_MINUTES);
      // A drag that ends at or after midnight ends on the next day.
      const nextDay = end >= DAY_MINUTES;
      const draft: EditorDraft = {
        ...draftOf(
          null,
          { allDay: true, start: date, end: date },
          '',
          '',
          EVENT_COLORS[0] as string,
        ),
        allDay: !timed,
        startTime: hhmm(start),
        endDate: nextDay ? formatDate(addDays(dateOf(date), 1)) : date,
        endTime: hhmm(nextDay ? end - DAY_MINUTES : end),
      };
      ui.setState({ editor: { ref: null, draft, readOnly: false } });
    },
    openEditor(ref) {
      const r = resolve(ref);
      if (!r) return;
      const ex = r.ev.exceptions[ref.key];
      const changed = ex && 'when' in ex ? ex : null;
      const draft = draftOf(
        r.ev,
        r.when,
        changed?.title ?? r.ev.title,
        changed?.notes ?? r.ev.notes,
        changed?.color ?? r.ev.color,
      );
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
        // A peer may have filled the calendar while the editor was open.
        if (events().length >= MAX_EVENTS) {
          opts.notify('This calendar is full (500 events)');
          return;
        }
        const when = whenOfDraft(draft, zone);
        if (typeof when === 'string') {
          opts.notify(when);
          return;
        }
        const id = newId();
        const fields = {
          title,
          notes,
          color,
          when,
          createdBy: opts.user.id,
          createdAt: opts.now(),
          ...(rule ? { rule } : {}),
        };
        if (commitEvent({ type: 'CreateEvent', pageId: page, id, fields })) {
          ui.setState({
            editor: null,
            selected: { eventId: id, key: formatDate(firstDate(when)) },
          });
        }
        return;
      }
      const ref = editor.ref;
      const r = resolve(ref);
      if (!r) return;
      const { ev } = r;
      const opened = editor.draft;
      // What the user changed is read from the draft, in the viewer's frame: untouched dates
      // and times keep the occurrence exactly as stored, with no round trip through the
      // viewer's zone.
      let edited: When | null = null;
      if (!sameTiming(draft, opened)) {
        const w = whenOfDraft(draft, ev.when.allDay ? zone : ev.when.tz);
        if (typeof w === 'string') {
          opts.notify(w);
          return;
        }
        edited = w;
      }
      // A save writes only the text fields the user changed, so a peer's concurrent edit of
      // another field survives the merge.
      const text = {
        ...(draft.title !== opened.title ? { title } : {}),
        ...(draft.notes !== opened.notes ? { notes } : {}),
        ...(draft.color !== opened.color ? { color } : {}),
      };
      if (!ev.rule) {
        const patch = {
          ...text,
          ...(edited ? { when: edited } : {}),
          // Against the opened draft too: a peer's rule change survives an untouched repeat.
          ...(ruleKey(rule) !== ruleKey(ruleOfDraft(opened)) ? { rule: rule ?? null } : {}),
        };
        const ok =
          Object.keys(patch).length === 0 ||
          commitEvent({ type: 'UpdateEvent', pageId: page, id: ev.id, patch });
        // A new day re-keys the selection (see `liveRef`).
        if (ok) ui.setState({ editor: null });
        return;
      }
      /**
       * The edited occurrence in the shown occurrence's own frame, so a change is measured in
       * one frame (a timed exception may be in another zone than the series).
       */
      const nextOf = (cur: When): When => {
        if (!edited) return cur;
        if (edited.allDay || cur.allDay || edited.tz === cur.tz) return edited;
        const w = whenOfDraft(draft, cur.tz);
        return typeof w === 'string' ? edited : w;
      };
      // Weekly days the user left alone turn with a moved start, even when the rule changed.
      const sameDays = (a: number[], b: number[]) =>
        JSON.stringify([...new Set(a)].sort((x, y) => x - y)) ===
        JSON.stringify([...new Set(b)].sort((x, y) => x - y));
      const keepDays = sameDays(draft.byDay, opened.byDay);
      // Whether the user changed the repeat is read against the rule the editor opened with,
      // not the live one: a peer's rule change made meanwhile is theirs and survives the save.
      const userRule = ruleKey(rule) !== ruleKey(ruleOfDraft(opened));
      /** "All events": the new base, the rule to write and whether the exceptions clear. */
      const planAll = (cur: { ev: CalendarEvent; when: When }) => {
        const next = nextOf(cur.when);
        const c = changesOf(cur.when, next);
        // A user-edited rule is taken as is, except for untouched weekly days.
        const newRule = rotateRule(userRule ? rule : cur.ev.rule, keepDays ? c.dayDelta : 0);
        const ruleChanged = ruleKey(newRule) !== ruleKey(cur.ev.rule);
        return {
          when: editAll(cur.ev.when, cur.when, next),
          newRule,
          ruleChanged,
          dayDelta: c.dayDelta,
          clears: c.dayDelta !== 0 || c.timeChanged || c.allDayChanged || ruleChanged,
        };
      };
      const plan = planAll(r);
      const question: SeriesQuestion = {
        action: 'save',
        drops: plan.clears ? exceptionCount(ev) : 0,
        ...(userRule ? { allOnly: true as const } : {}),
      };
      ask(ref, question, (scope) => {
        const cur = resolve(ref);
        if (!cur) return;
        let ok: boolean;
        if (scope === 'one') {
          // Nothing changed: nothing to write.
          ok =
            (!edited && Object.keys(text).length === 0) ||
            overrideOne(cur.ev, ref.key, edited ?? cur.when, { title, notes, color });
        } else {
          const p = planAll(cur);
          const wasSelected = sameRef(ui.getState().selected, ref);
          ok = commitEvent({
            type: 'UpdateEvent',
            pageId: page,
            id: cur.ev.id,
            patch: {
              ...text,
              ...(sameWhen(p.when, cur.ev.when) ? {} : { when: p.when }),
              ...(p.ruleChanged ? { rule: p.newRule ?? null } : {}),
            },
            clearExceptions: p.clears && exceptionCount(cur.ev) > 0,
          });
          if (ok) followShift(ref, wasSelected, p.dayDelta);
        }
        if (ok) ui.setState({ editor: null });
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
        next = {
          allDay: true,
          start: formatDate(addDays(dateOf(when.start), shift)),
          end: formatDate(addDays(dateOf(when.end), shift)),
        };
      } else if (to.minutes === undefined) {
        // Month view: the event keeps its own wall time of day in its own zone, moved by
        // the days between the cell it was shown in and the cell it was dropped on.
        const s = wallOf(when.start);
        const shownOn = toWall(toInstant(s, when.tz), zone);
        const shift = dayNumber(dateOf(to.date)) - dayNumber(shownOn);
        next = timedFrom(atMinutes(addDays(s, shift), s.hh * 60 + s.mm), realMs(when), when.tz);
      } else {
        const start = toInstant(atMinutes(dateOf(to.date), to.minutes), zone);
        next = {
          allDay: false,
          start: formatWall(toWall(start, when.tz)),
          end: formatWall(toWall(start + realMs(when), when.tz)),
          tz: when.tz,
        };
      }
      if (JSON.stringify(next) === JSON.stringify(when)) return;
      if (!ev.rule) {
        commitEvent({ type: 'UpdateEvent', pageId: page, id: ev.id, patch: { when: next } });
        return;
      }
      const dayDelta = startDay(next) - startDay(when);
      /** The gesture's own shift (`when` → `next`) applied to a series; weekly days turn with it. */
      const planAll = (cur: CalendarEvent) => {
        const base = shiftAll(cur.when, when, next);
        const rule = rotateRule(cur.rule, dayDelta);
        const ruleChanged = ruleKey(rule) !== ruleKey(cur.rule);
        const clears = ruleChanged || JSON.stringify(base) !== JSON.stringify(cur.when);
        return { base, rule, ruleChanged, clears };
      };
      const drops = planAll(ev).clears ? exceptionCount(ev) : 0;
      ask(ref, { action: 'move', drops }, (scope) => {
        const cur = resolve(ref);
        if (!cur) return;
        if (scope === 'one') {
          changeOne(cur.ev, ref.key, next);
          return;
        }
        const p = planAll(cur.ev);
        const wasSelected = sameRef(ui.getState().selected, ref);
        const ok = commitEvent({
          type: 'UpdateEvent',
          pageId: page,
          id: cur.ev.id,
          patch: { when: p.base, ...(p.ruleChanged ? { rule: p.rule ?? null } : {}) },
          clearExceptions: p.clears && exceptionCount(cur.ev) > 0,
        });
        if (ok) followShift(ref, wasSelected, dayDelta);
      });
    },
    resize(ref, to) {
      const page = pageId();
      const r = resolve(ref);
      if (!opts.canEdit() || !page || !r || r.when.allDay) return;
      const { ev, when } = r;
      const s = toInstant(wallOf(when.start), when.tz);
      const raw = toInstant(atMinutes(dateOf(to.date), to.minutes), zone);
      const end = Math.min(
        Math.max(raw, s + MIN_EVENT_MINUTES * MINUTE_MS),
        s + MAX_TIMED_DAYS * DAY_MS,
      );
      const next: When = { ...when, end: formatWall(toWall(end, when.tz)) };
      if (next.end === when.end) return;
      if (!ev.rule) {
        commitEvent({ type: 'UpdateEvent', pageId: page, id: ev.id, patch: { when: next } });
        return;
      }
      // A timed exception of an all-day series: "All events" has no duration to change.
      if (ev.when.allDay) {
        changeOne(ev, ref.key, next);
        return;
      }
      const ms = end - s;
      ask(ref, { action: 'move', drops: 0 }, (scope) => {
        const cur = resolve(ref);
        if (!cur) return;
        if (scope === 'one') changeOne(cur.ev, ref.key, next);
        else if (!cur.ev.when.allDay) {
          const base = cur.ev.when;
          const bs = toInstant(wallOf(base.start), base.tz);
          commitEvent({
            type: 'UpdateEvent',
            pageId: page,
            id: cur.ev.id,
            patch: { when: { ...base, end: formatWall(toWall(bs + ms, base.tz)) } },
          });
        }
      });
    },
    remove(ref) {
      const page = pageId();
      const ev = eventById(ref.eventId);
      if (!canDelete() || !page || !ev) return;
      const done = () => ui.setState({ selected: null, editor: null });
      if (!ev.rule) {
        if (commitEvent({ type: 'DeleteEvent', pageId: page, id: ev.id })) done();
        return;
      }
      // Cancelling one occurrence writes an exception. A full board refuses that, so there
      // only the whole series can be removed.
      const allOnly = !opts.canEdit();
      ask(
        ref,
        { action: 'delete', drops: 0, ...(allOnly ? { allOnly: true as const } : {}) },
        (scope) => {
          const cur = eventById(ref.eventId);
          if (!cur) return;
          const ok =
            scope === 'one'
              ? setOccurrence(cur, ref.key, { cancelled: true })
              : commitEvent({ type: 'DeleteEvent', pageId: page, id: cur.id });
          if (ok) done();
        },
      );
    },
    answer(scope) {
      const p = pending;
      if (scope === 'one' && ui.getState().question?.allOnly) return;
      pending = null;
      ui.setState({ question: null });
      if (!scope || !p || !canDelete() || !eventById(p.ref.eventId)) return;
      p.run(scope);
    },
    rsvp(eventId, status) {
      const page = pageId();
      if (!opts.canEdit() || !page || !eventById(eventId)) return;
      opts.commitSession({
        type: 'SetRsvp',
        pageId: page,
        id: eventId,
        userId: opts.user.id,
        status,
        name: opts.user.name,
      });
    },
    resolve,
    exportIcs(name) {
      const cal = opts.calendar.getState().calendar;
      return cal ? writeIcs(cal, { name, now: opts.now() }) : null;
    },
    importIcs(text, expectPage) {
      const page = pageId();
      if (!opts.canEdit() || !page) return null;
      // The file was read asynchronously: the user may have moved to another calendar since.
      if (expectPage !== undefined && expectPage !== page) return null;
      if (new TextEncoder().encode(text).length > MAX_ICS_BYTES) {
        opts.notify('This file is larger than 1 MB');
        return null;
      }
      const parsed = parseIcs(text, { zone });
      const known = new Set(events().map((e) => e.uid ?? `${e.id}@relay`));
      // An event without a UID matches nothing: it is always new, and stores no uid.
      const fresh = parsed.events.filter((e) => e.uid === undefined || !known.has(e.uid));
      const skipped = parsed.events.length - fresh.length;
      if (events().length + fresh.length > MAX_EVENTS) {
        opts.notify('This calendar is full (500 events)');
        return null;
      }
      const writes = fresh.map((e) => ({
        id: newId(),
        fields: {
          ...e.fields,
          ...(e.uid !== undefined ? { uid: e.uid } : {}),
          createdBy: opts.user.id,
          createdAt: opts.now(),
        },
        exceptions: e.exceptions,
      }));
      if (writes.length > 0 && importUpdateSize(writes) > MAX_PASTE_BYTES) {
        opts.notify('This file is too large to import at once');
        return null;
      }
      if (
        writes.length > 0 &&
        !commitEvent({ type: 'ImportEvents', pageId: page, events: writes })
      ) {
        opts.notify('Could not import right now');
        return null;
      }
      return { imported: writes.length, skipped, warnings: parsed.warnings };
    },
    destroy() {
      unsubscribe();
    },
  };
}
