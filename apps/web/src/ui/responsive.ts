import { useCallback, useSyncExternalStore } from 'react';

/**
 * The media queries layouts switch on. CSS uses the matching variants (`max-sm:`, `short:`,
 * `pointer-coarse:`); keep both in sync with the comment in app/globals.css.
 */
export const MEDIA = {
  /** Phones: narrower than Tailwind's `sm` (640px). */
  compact: '(max-width: 639.98px)',
  /** Short windows: landscape phones and small laptop windows. */
  short: '(max-height: 559.98px)',
  /** Touch screens, where there is no precise pointer, hover or keyboard shortcuts. */
  coarse: '(pointer: coarse)',
} as const;

/** Whether `query` matches, kept live. False on the server and while hydrating. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}
