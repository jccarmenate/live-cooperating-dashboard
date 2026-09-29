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
