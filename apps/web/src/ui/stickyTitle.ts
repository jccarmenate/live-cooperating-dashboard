import { MAX_EVENT_TITLE } from '@relay/core';

/** An event title from a sticky's text: its first non-empty line, or "Untitled". */
export function stickyTitle(text: string | undefined): string {
  const line = (text ?? '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  return line ? line.slice(0, MAX_EVENT_TITLE) : 'Untitled';
}
