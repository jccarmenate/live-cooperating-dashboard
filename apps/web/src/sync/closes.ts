/** Statuses in which the provider is disconnected and does not retry by itself. */
export type StoppedStatus = 'unauthorized' | 'crowded' | 'throttled' | 'too-large';

export type CloseAction =
  | { kind: 'reconnect' }
  | { kind: 'stop'; status: StoppedStatus }
  | { kind: 'wait'; ms: number };

/** How long to wait before reconnecting after the server closed for too many messages. */
export const THROTTLE_WAIT_MS = 5000;
const THROTTLE_WINDOW_MS = 60_000;
const THROTTLE_STOP_AFTER = 3;

/**
 * What to do when the server closes the socket. The provider reconnects by itself, which is
 * wrong when the reconnect would fail the same way: a change too large to sync would be sent
 * again, and a full room would be dialled every few seconds.
 */
export function closeAction(
  code: number | undefined,
  throttledAt: readonly number[],
  now: number,
): { action: CloseAction; throttledAt: number[] } {
  const same = [...throttledAt];
  switch (code) {
    case 4401:
      return { action: { kind: 'stop', status: 'unauthorized' }, throttledAt: same };
    case 4503:
      return { action: { kind: 'stop', status: 'crowded' }, throttledAt: same };
    case 1009:
      return { action: { kind: 'stop', status: 'too-large' }, throttledAt: same };
    case 4429: {
      const recent = [...throttledAt.filter((t) => now - t < THROTTLE_WINDOW_MS), now];
      return recent.length >= THROTTLE_STOP_AFTER
        ? { action: { kind: 'stop', status: 'throttled' }, throttledAt: recent }
        : { action: { kind: 'wait', ms: THROTTLE_WAIT_MS }, throttledAt: recent };
    }
    default:
      return { action: { kind: 'reconnect' }, throttledAt: same };
  }
}
