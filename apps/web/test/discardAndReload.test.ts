import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectRoom, type RoomConnection } from '../src/sync/connection';

const mocks = vi.hoisted(() => ({
  destroyLocal: vi.fn<() => Promise<void> | undefined>(),
  clearDocument: vi.fn<(name: string) => Promise<void>>(),
}));

// The room's local copy and its socket are not what is under test: discardAndReload is the order
// of delete, then reload, and that it never rejects.
vi.mock('y-indexeddb', () => ({
  IndexeddbPersistence: class {
    destroy = mocks.destroyLocal;
  },
  clearDocument: mocks.clearDocument,
}));
vi.mock('y-partyserver/provider', () => ({
  default: class {
    on = vi.fn();
    connect = vi.fn();
    disconnect = vi.fn();
    destroy = vi.fn();
    sendMessage = vi.fn();
  },
}));
vi.mock('../src/sync/ownAwareness', () => ({ sendOnlyOwnAwareness: vi.fn() }));

describe('discardAndReload', () => {
  const reload = vi.fn();
  let room: RoomConnection;

  beforeEach(() => {
    vi.stubGlobal('window', { location: { reload } });
    mocks.destroyLocal.mockReset();
    mocks.clearDocument.mockReset();
    reload.mockReset();
    room = connectRoom({ roomId: 'r1', key: null, host: 'localhost:8787' });
  });
  afterEach(() => {
    room.destroy();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('reloads only once the local copy is deleted', async () => {
    mocks.destroyLocal.mockResolvedValue(undefined);
    let finish: () => void = () => {};
    mocks.clearDocument.mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    const done = room.discardAndReload();
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.clearDocument).toHaveBeenCalledWith('relay:r1');
    expect(reload).not.toHaveBeenCalled();
    finish();
    await done;
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('logs a delete that fails and still reloads, and the promise does not reject', async () => {
    const failure = new Error('IndexedDB is unavailable');
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.destroyLocal.mockRejectedValueOnce(failure);
    await expect(room.discardAndReload()).resolves.toBeUndefined();
    expect(log).toHaveBeenCalledWith(expect.any(String), failure);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});
