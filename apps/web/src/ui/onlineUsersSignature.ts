import type { Identity } from '@relay/core';

/**
 * A signature string for the `onlineUsers` result, stable across presence updates that don't
 * change the online set (id/name/color). The presence store replaces `peers` with a fresh
 * array/objects on every awareness change (a remote cursor moves every 50ms); selecting this
 * signature instead of the derived Identity[] directly lets the Header re-render only when the
 * set of online users actually changes, via `useStore`'s default `Object.is` equality on strings.
 */
export function onlineUsersSignature(users: readonly Identity[]): string {
  return JSON.stringify(users.map((u) => [u.id, u.name, u.color]));
}
