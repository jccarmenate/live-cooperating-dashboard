import { EVENT_COLORS, pageOf, type RsvpStatus } from '@relay/core';
import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { Dialog } from '../ui/Dialog';
import { toast } from '../ui/toasts';
import type { CalendarController, EditorDraft, EditorState } from './calendarController';
import { WEEKDAY_SHORT, zoneNote } from './layout';
import { openOnBoard } from './openOnBoard';
import { rsvpSummary } from './rsvp';

const input =
  'w-full border-2 border-ink bg-white px-2 py-1 pointer-coarse:py-2 font-mono text-xs disabled:bg-paper';
const label = 'flex flex-col gap-1 font-mono text-[11px] uppercase text-ink/70';
const btn =
  'border-2 border-ink px-3 py-1.5 pointer-coarse:py-2.5 font-mono text-xs uppercase disabled:opacity-40';

/** Each opening of the editor (a fresh draft object) gets its own key, so its form starts over. */
const draftKeys = new WeakMap<EditorDraft, number>();
let lastDraftKey = 0;
function keyOf(draft: EditorDraft): number {
  let key = draftKeys.get(draft);
  if (key === undefined) {
    key = ++lastDraftKey;
    draftKeys.set(draft, key);
  }
  return key;
}

export function EventEditor({ session, ctl }: { session: BoardSession; ctl: CalendarController }) {
  const editor = useStore(ctl.ui, (s) => s.editor);
  if (!editor) return null;
  return <EditorDialog key={keyOf(editor.draft)} session={session} ctl={ctl} editor={editor} />;
}

/**
 * The form keeps its own draft: the controller's `editor.draft` stays what was opened, and
 * `save` compares the two to see what the user changed.
 */
function EditorDialog({
  session,
  ctl,
  editor,
}: {
  session: BoardSession;
  ctl: CalendarController;
  editor: EditorState;
}) {
  const [draft, setDraft] = useState<EditorDraft>(editor.draft);
  const canEdit = useStore(session.conn.clock, (c) => c.role === 'edit');
  const eventId = editor.ref?.eventId ?? null;
  // The event itself (same object until it changes): RSVP answers and the link re-render.
  const ev = useStore(session.calendar, (s) =>
    eventId ? (s.calendar?.events.find((e) => e.id === eventId) ?? null) : null,
  );
  const link = ev?.link ?? null;
  const linkAlive = useStore(session.doc, (d) => {
    if (!link) return false;
    const shape = d.allShapes[link.shapeId];
    return d.pages.some((p) => p.id === link.pageId) && !!shape && pageOf(shape) === link.pageId;
  });
  const title = useRef<HTMLInputElement>(null);
  // A new event starts in its title (after the dialog has focused its panel).
  useEffect(() => {
    if (!editor.ref) title.current?.focus();
  }, [editor.ref]);

  const ro = editor.readOnly || !canEdit;
  const set = (patch: Partial<EditorDraft>) => setDraft((d) => ({ ...d, ...patch }));
  const resolved = editor.ref && ev ? ctl.resolve(editor.ref) : null;
  const tzNote = resolved ? zoneNote(resolved.when, ctl.zone, editor.draft.startDate) : null;
  const summary = ev ? rsvpSummary(ev.rsvp) : null;
  const mine = ev?.rsvp[session.user.id]?.status ?? null;
  const answer = (s: RsvpStatus) => {
    if (ev) ctl.rsvp(ev.id, mine === s ? null : s);
  };

  return (
    <Dialog
      title={editor.ref ? (ro ? 'Event' : 'Edit event') : 'New event'}
      onClose={() => ctl.closeEditor()}
      wide
    >
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
          <input
            ref={title}
            data-testid="cal-title-input"
            className={input}
            disabled={ro}
            maxLength={120}
            value={draft.title}
            onChange={(e) => set({ title: e.target.value })}
          />
        </label>
        <label className="flex items-center gap-2 font-mono text-xs">
          <input
            data-testid="cal-allday"
            type="checkbox"
            disabled={ro}
            checked={draft.allDay}
            onChange={(e) => set({ allDay: e.target.checked })}
          />
          All day
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className={label}>
            Start
            <input
              data-testid="cal-start-date"
              type="date"
              className={input}
              disabled={ro}
              value={draft.startDate}
              onChange={(e) => set({ startDate: e.target.value })}
            />
          </label>
          {!draft.allDay ? (
            <label className={label}>
              &nbsp;
              <input
                data-testid="cal-start-time"
                aria-label="Start time"
                type="time"
                step={900}
                className={input}
                disabled={ro}
                value={draft.startTime}
                onChange={(e) => set({ startTime: e.target.value })}
              />
            </label>
          ) : (
            <span />
          )}
          <label className={label}>
            End
            <input
              data-testid="cal-end-date"
              type="date"
              className={input}
              disabled={ro}
              value={draft.endDate}
              onChange={(e) => set({ endDate: e.target.value })}
            />
          </label>
          {!draft.allDay ? (
            <label className={label}>
              &nbsp;
              <input
                data-testid="cal-end-time"
                aria-label="End time"
                type="time"
                step={900}
                className={input}
                disabled={ro}
                value={draft.endTime}
                onChange={(e) => set({ endTime: e.target.value })}
              />
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
            <select
              data-testid="cal-repeat"
              className={input}
              disabled={ro}
              value={draft.repeat}
              onChange={(e) => set({ repeat: e.target.value as EditorDraft['repeat'] })}
            >
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
                <input
                  data-testid="cal-interval"
                  type="number"
                  min={1}
                  max={99}
                  className={`${input} w-16`}
                  disabled={ro}
                  value={draft.interval}
                  onChange={(e) => set({ interval: Number(e.target.value) })}
                />
              </label>
              <label className={label}>
                Ends
                <select
                  data-testid="cal-ends"
                  className={input}
                  disabled={ro}
                  value={draft.ends}
                  onChange={(e) => set({ ends: e.target.value as EditorDraft['ends'] })}
                >
                  <option value="never">Never</option>
                  <option value="on">On a date</option>
                  <option value="after">After N times</option>
                </select>
              </label>
              {draft.ends === 'on' && (
                <input
                  data-testid="cal-until"
                  type="date"
                  aria-label="Ends on"
                  className={`${input} w-40`}
                  disabled={ro}
                  value={draft.until}
                  onChange={(e) => set({ until: e.target.value })}
                />
              )}
              {draft.ends === 'after' && (
                <input
                  data-testid="cal-count"
                  type="number"
                  aria-label="Number of times"
                  min={1}
                  max={999}
                  className={`${input} w-20`}
                  disabled={ro}
                  value={draft.count}
                  onChange={(e) => set({ count: Number(e.target.value) })}
                />
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
                onClick={() =>
                  set({
                    byDay: draft.byDay.includes(i)
                      ? draft.byDay.filter((x) => x !== i)
                      : [...draft.byDay, i],
                  })
                }
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
          <textarea
            data-testid="cal-notes"
            rows={3}
            className={input}
            disabled={ro}
            maxLength={2000}
            value={draft.notes}
            onChange={(e) => set({ notes: e.target.value })}
          />
        </label>
        {ev && summary && (
          <div
            data-testid="cal-rsvp"
            className="flex flex-col gap-1 border-t-2 border-ink/20 pt-2 font-mono text-xs"
          >
            <p data-testid="cal-rsvp-summary">
              {`${summary.yes.length} going · ${summary.maybe.length} maybe · ${summary.no.length} not going`}
            </p>
            {summary.yes.length + summary.maybe.length + summary.no.length > 0 && (
              <p className="break-words text-[11px] text-ink/60">
                {[
                  ...summary.yes.map((n) => `${n} ✓`),
                  ...summary.maybe.map((n) => `${n} ?`),
                  ...summary.no.map((n) => `${n} ✗`),
                ].join(', ')}
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
            onClick={() => openOnBoard(ctl, session.controller, link, toast)}
          >
            {linkAlive ? 'Open on board' : 'Sticky deleted'}
          </button>
        )}
        <div className="flex justify-between gap-2 border-t-2 border-ink/20 pt-2">
          {editor.ref && !ro ? (
            <button
              type="button"
              data-testid="cal-delete"
              className={`${btn} bg-white text-flame`}
              onClick={() => editor.ref && ctl.remove(editor.ref)}
            >
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="cal-cancel"
              className={`${btn} bg-white`}
              onClick={() => ctl.closeEditor()}
            >
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
