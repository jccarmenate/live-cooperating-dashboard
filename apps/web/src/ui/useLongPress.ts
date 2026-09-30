import { type PointerEvent, useEffect, useRef } from 'react';
import { LONG_PRESS_MS, moved } from '../render/touch';

type At = { x: number; y: number };

/**
 * Long press for menus that open on a right-click: iOS never turns a held finger into
 * `contextmenu`. Returns a binder, so one hook serves a whole list: spread
 * `longPress((at) => openMenu(at))` next to each item's `onContextMenu`. `at` is in client px.
 */
export function useLongPress() {
  const press = useRef<(At & { timer: number }) | null>(null);

  const clear = () => {
    if (press.current) window.clearTimeout(press.current.timer);
    press.current = null;
  };
  useEffect(
    () => () => {
      if (press.current) window.clearTimeout(press.current.timer);
    },
    [],
  );

  return (onLongPress: (at: At) => void) => ({
    onPointerDown(e: PointerEvent) {
      clear();
      if (e.pointerType !== 'touch') return;
      const at = { x: e.clientX, y: e.clientY };
      const timer = window.setTimeout(() => {
        press.current = null;
        onLongPress(at);
      }, LONG_PRESS_MS);
      press.current = { ...at, timer };
    },
    onPointerMove(e: PointerEvent) {
      const p = press.current;
      if (p && moved(p, { x: e.clientX, y: e.clientY })) clear();
    },
    onPointerUp: clear,
    onPointerCancel: clear,
  });
}
