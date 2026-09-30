import * as Y from 'yjs';
import { applyCommand } from '../commands/apply';
import type { ImportedEventWrite } from '../commands/types';

/**
 * Bytes of the update an ImportEvents of `events` would send, measured on an empty scratch doc.
 * An upper bound on what is written (on a real page the command stops at the event cap, so it
 * may write fewer events, never more), but not an exact byte bound: on a busy page larger
 * clocks and client ids encode a few bytes longer (about 0.06% measured on 150 events). The
 * 192 KiB paste budget sits well under the relay's 256 KiB message limit to absorb that.
 */
export function importUpdateSize(events: ImportedEventWrite[]): number {
  const scratch = new Y.Doc();
  try {
    applyCommand(scratch, {
      type: 'CreatePage',
      page: { id: 'p', type: 'calendar', title: '', order: 'a0', createdBy: '', createdAt: 0 },
    });
    const before = Y.encodeStateVector(scratch);
    applyCommand(scratch, { type: 'ImportEvents', pageId: 'p', events });
    return Y.encodeStateAsUpdate(scratch, before).byteLength;
  } finally {
    scratch.destroy();
  }
}
