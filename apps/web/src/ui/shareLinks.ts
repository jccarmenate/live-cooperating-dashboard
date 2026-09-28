import type { Role } from '@relay/core';
import { hashFor } from '../sync/key';

/**
 * The links the Share dialog offers; null while one is not known yet. An editor's view link
 * uses the server-sent view key, never its own (edit) key. Before the server's hello names the
 * role, our own key may be an edit key, so no link is offered at all.
 */
export function shareLinks(opts: {
  origin: string;
  roomId: string;
  key: string | null;
  role: Role | null;
  viewKey: string | null;
  page: string;
}): { edit: string | null; view: string | null } {
  const base = `${opts.origin}/r/${opts.roomId}`;
  if (opts.role === 'edit') {
    return {
      edit: `${base}${hashFor(opts.key, opts.page)}`,
      view: opts.viewKey ? `${base}${hashFor(opts.viewKey, opts.page)}` : null,
    };
  }
  if (opts.role === 'view') return { edit: null, view: `${base}${hashFor(opts.key, opts.page)}` };
  return { edit: null, view: null };
}
