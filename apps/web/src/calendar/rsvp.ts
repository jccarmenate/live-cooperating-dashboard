import type { Rsvp } from '@relay/core';

/** Answers grouped by status, names sorted; an empty name reads as "Someone". */
export function rsvpSummary(rsvp: Record<string, Rsvp>): {
  yes: string[];
  maybe: string[];
  no: string[];
} {
  const out = { yes: [] as string[], maybe: [] as string[], no: [] as string[] };
  for (const r of Object.values(rsvp)) out[r.status].push(r.name.trim() || 'Someone');
  for (const list of Object.values(out)) list.sort((a, b) => a.localeCompare(b));
  return out;
}
