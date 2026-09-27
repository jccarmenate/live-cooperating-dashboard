import { createStore } from 'zustand/vanilla';

export const TOAST_MS = 3000;

export const toasts = createStore<{ items: { id: number; message: string }[] }>(() => ({
  items: [],
}));

let next = 1;

/** Shows a transient notice at the bottom centre. */
export function toast(message: string): void {
  const id = next++;
  toasts.setState((s) => ({ items: [...s.items, { id, message }] }));
  setTimeout(
    () => toasts.setState((s) => ({ items: s.items.filter((t) => t.id !== id) })),
    TOAST_MS,
  );
}
