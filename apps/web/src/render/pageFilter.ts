import { MAIN_PAGE } from '@relay/core';

/** Whether a peer is looking at `page` (older clients publish no page: they are on main). */
export const onPage = (peer: { page: string | null }, page: string): boolean =>
  (peer.page ?? MAIN_PAGE) === page;
