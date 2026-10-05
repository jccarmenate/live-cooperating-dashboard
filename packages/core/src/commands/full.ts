import type { Command } from './types';

/**
 * Whether a command only deletes. On a board over its size cap the server accepts an update
 * only when it adds no structs, so these are the commands that still reach the other users.
 * `DeletePage` is not one: it writes a tombstone. A `SetCells` qualifies when it clears every
 * cell it names; keeping a format would write the cell again.
 */
export function allowedWhenFull(command: Command): boolean {
  switch (command.type) {
    case 'DeleteShapes':
    case 'DeleteRows':
    case 'DeleteCols':
    case 'DeleteEvent':
      return true;
    case 'SetCells':
      return command.cells.every((c) => !c.src && !c.fmt);
    default:
      return false;
  }
}

/** What the board lets a user change: everything, deletions only, or nothing. */
export type BoardAccess = 'edit' | 'delete-only' | 'read-only';

/** Whether a user with `access` may apply `command`. */
export function allowedFor(access: BoardAccess, command: Command): boolean {
  return access === 'edit' || (access === 'delete-only' && allowedWhenFull(command));
}
