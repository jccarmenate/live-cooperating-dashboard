import * as Y from 'yjs';
import { applyCommand } from '../commands/apply';
import type { ImportedEventWrite } from '../commands/types';

/** Bytes of the update an ImportEvents of `events` would send (measured on a scratch doc). */
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
