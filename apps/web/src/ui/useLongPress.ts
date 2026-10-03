import { type MouseEvent, type PointerEvent, useEffect, useRef } from 'react';
import { LONG_PRESS_MS, moved } from '../render/touch';

type At = { x: number; y: number };

/**
 * Long press for menus that open on a right-click: iOS never turns a held finger into
 * `contextmenu`. Returns a binder, so one hook serves a whole list: spread
 * `longPress((at) => openMenu(at))` next to each item's `onContextMenu`. `at` is in client px.
 */
export function useLongPress() {
  const press = useRef<(At & { timer: number }) | null>(null);
  // Set when a hold fired: some browsers (iOS Safari) still send a click as the finger lifts,
  // which would also activate the tab or button that was held.
  const fired = useRef(false);

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
      fired.current = false;
      if (e.pointerType !== 'touch') return;
      const at = { x: e.clientX, y: e.clientY };
      const timer = window.setTimeout(() => {
        press.current = null;
        fired.current = true;
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
    onClickCapture(e: MouseEvent) {
      if (!fired.current) return;
      fired.current = false;
      e.preventDefault();
      e.stopPropagation();
    },
  });
}
