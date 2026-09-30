import type { Peer } from '@relay/core';
import { onPage } from '../render/pageFilter';

let last: { peers: Peer[]; page: string; byEvent: Map<string, string> } | null = null;

/**
 * Per open event, the colours (comma-joined, at most 3) of the peers on `page` who have it open.
 * Built once per presence state and page, so a view's many event dots share one pass over the
 * peers instead of filtering them once each.
 */
export function peerColorsByEvent(peers: Peer[], page: string): Map<string, string> {
  if (last?.peers === peers && last.page === page) return last.byEvent;
  const lists = new Map<string, string[]>();
  for (const peer of peers) {
    if (!peer.calEvent || !onPage(peer, page)) continue;
    const list = lists.get(peer.calEvent) ?? [];
    if (list.length < 3) list.push(peer.user.color);
    lists.set(peer.calEvent, list);
  }
  const byEvent = new Map([...lists].map(([id, colors]) => [id, colors.join(',')]));
  last = { peers, page, byEvent };
  return byEvent;
}
