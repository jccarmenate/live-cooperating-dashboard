import { MAX_PRESENCE_SELECTION } from '@relay/core';
import { describe, expect, it } from 'vitest';
import { Awareness } from 'y-protocols/awareness';
import * as Y from 'yjs';
import { createPresencePublisher } from '../src/sync/presence';

const user = { id: 'u1', name: 'Brisk Otter', color: '#E85A1B' };

describe('presence publisher', () => {
  it('publishes at most 100 selected ids (a select-all must fit the 8 KB frame)', () => {
    const awareness = new Awareness(new Y.Doc());
    const publisher = createPresencePublisher(awareness, user);
    const ids = Array.from({ length: 250 }, (_, i) => `shape-${i}`);
    publisher.setSelection(ids);
    const state = awareness.getLocalState() as { selection: string[] };
    expect(state.selection).toEqual(ids.slice(0, MAX_PRESENCE_SELECTION));
    publisher.destroy();
    awareness.destroy();
  });
});
