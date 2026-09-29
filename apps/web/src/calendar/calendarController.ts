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
  type RsvpStatus,
  type Rule,
  todayIn,
  toInstant,
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
    if (w.allDay)
      return {
        allDay: true,
        startDate: w.start,
        startTime: '09:00',
        endDate: w.end,
        endTime: '10:00',
      };
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
    if (end - start < MIN_EVENT_MINUTES * 60_000) return 'An event lasts at least 15 minutes';
    if (end - start > MAX_TIMED_DAYS * 86_400_000) return 'An event can last at most 14 days';
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

  /** Start date of a when in its own frame (the event's zone for timed events). */
  const startDay = (w: When): number =>
    dayNumber(w.allDay ? dateOf(w.start) : (parseWall(w.start) ?? EPOCH));
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
      return {
        allDay: true,
        start: formatDate(baseDate),
        end: formatDate(addDays(baseDate, span)),
      };
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
  const changeOne = (
    ev: CalendarEvent,
    key: string,
    when: When,
    fields: Partial<Record<'title' | 'notes' | 'color', string>> = {},
  ) => {
    const prev = ev.exceptions[key];
    const kept =
      prev && 'when' in prev ? { title: prev.title, notes: prev.notes, color: prev.color } : {};
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
        ...draftOf(
          null,
          { allDay: true, start: date, end: date },
          '',
          '',
          EVENT_COLORS[0] as string,
        ),
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
            selected: { eventId: id, key: formatDate(dateOf(when.start.slice(0, 10))) },
          });
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
        commitEvent({
          type: 'UpdateEvent',
          pageId: page,
          id: ev.id,
          patch: { title, notes, color, when, rule: rule ?? null },
        });
        ui.setState({ editor: null });
        return;
      }
      const key = editor.ref.key;
      const base = rebase(ev.when, key, when);
      const ruleChanged = JSON.stringify(rule ?? null) !== JSON.stringify(ev.rule);
      const timeChanged =
        startDay(when) !== startDay(r.when) ||
        timeOfDay(when) !== timeOfDay(r.when) ||
        when.allDay !== r.when.allDay;
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
        next = {
          allDay: true,
          start: formatDate(addDays(dateOf(when.start), shift)),
          end: formatDate(addDays(dateOf(when.end), shift)),
        };
      } else {
        const s = toInstant(parseWall(when.start) ?? { ...EPOCH, hh: 0, mm: 0 }, when.tz);
        const e = toInstant(parseWall(when.end) ?? { ...EPOCH, hh: 0, mm: 0 }, when.tz);
        const local = toWall(s, zone);
        const minutes = to.minutes ?? local.hh * 60 + local.mm;
        const start = toInstant(
          { ...dateOf(to.date), hh: Math.floor(minutes / 60), mm: minutes % 60 },
          zone,
        );
        next = {
          allDay: false,
          start: formatWall(toWall(start, when.tz)),
          end: formatWall(toWall(start + (e - s), when.tz)),
          tz: when.tz,
        };
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
      const raw = toInstant(
        { ...dateOf(to.date), hh: Math.floor(to.minutes / 60), mm: to.minutes % 60 },
        zone,
      );
      const end = Math.min(
        Math.max(raw, s + MIN_EVENT_MINUTES * 60_000),
        s + MAX_TIMED_DAYS * 86_400_000,
      );
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
            patch: {
              when: { ...ev.when, end: formatWall(fromWallMinutes(wallMinutes(bs) + minutes)) },
            },
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
    destroy() {
      unsubscribe();
    },
  };
}
