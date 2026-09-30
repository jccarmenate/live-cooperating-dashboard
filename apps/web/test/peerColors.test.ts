import type { Peer } from '@relay/core';
import { describe, expect, it } from 'vitest';
import { peerColorsByEvent } from '../src/calendar/peerColors';

const peer = (color: string, calEvent: string | undefined, page: string | null = 'cal'): Peer =>
  ({ clientId: 1, user: { id: color, name: color, color }, page, calEvent }) as unknown as Peer;

describe('peer colours by event', () => {
  it('lists up to 3 colours per open event, for peers on the page only', () => {
    const peers = [
      peer('#1', 'a'),
      peer('#2', 'a'),
      peer('#3', 'b'),
      peer('#4', 'a'),
      peer('#5', 'a'),
      peer('#6', 'a', 'other'),
      peer('#7', undefined),
    ];
    const map = peerColorsByEvent(peers, 'cal');
    expect([...map]).toEqual([
      ['a', '#1,#2,#4'],
      ['b', '#3'],
    ]);
  });

  it('builds the map once per presence state and page', () => {
    const peers = [peer('#1', 'a')];
    const first = peerColorsByEvent(peers, 'cal');
    expect(peerColorsByEvent(peers, 'cal')).toBe(first);
    expect(peerColorsByEvent(peers, 'other')).not.toBe(first);
    expect(peerColorsByEvent([...peers], 'cal')).not.toBe(first);
  });
});
