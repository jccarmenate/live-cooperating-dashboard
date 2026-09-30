import type { BoardSession } from '../board/session';

/** Board shortcuts and clipboard handlers act only on board pages. */
export const onBoardPage = (session: BoardSession): boolean => {
  const { activePage, pages } = session.doc.getState();
  return pages.find((p) => p.id === activePage)?.type === 'board';
};

/** Calendar shortcuts act only on calendar pages. */
export const onCalendarPage = (session: BoardSession): boolean => {
  const { activePage, pages } = session.doc.getState();
  return pages.find((p) => p.id === activePage)?.type === 'calendar';
};
