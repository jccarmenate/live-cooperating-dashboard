import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { peerColorsByEvent } from './peerColors';

/**
 * Up to 3 dots in the colours of peers who have this event open. It owns its presence
 * subscription, so memoised event boxes still update when a peer opens or closes the event.
 */
export function EventDots({ session, eventId }: { session: BoardSession; eventId: string }) {
  const page = useStore(session.doc, (d) => d.activePage);
  // A string, not an array: presence ticks that change nothing here do not re-render. The map
  // is built once per presence state for every dot in the view.
  const colors = useStore(
    session.presence,
    (p) => peerColorsByEvent(p.peers, page).get(eventId) ?? '',
  );
  if (!colors) return null;
  return (
    <span
      data-testid="cal-event-dots"
      className="pointer-events-none absolute top-0.5 right-0.5 flex gap-0.5"
    >
      {colors.split(',').map((c, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: two peers may share a colour
          key={`${c}${i}`}
          className="size-2 rounded-full border border-white"
          style={{ background: c }}
        />
      ))}
    </span>
  );
}
