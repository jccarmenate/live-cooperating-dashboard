import { useStore } from 'zustand';
import { toasts } from './toasts';

export function ToastHost() {
  const items = useStore(toasts, (s) => s.items);
  return (
    <div
      aria-live="polite"
      // Clear of the home indicator on notched phones.
      className="pointer-events-none fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-col items-center gap-2 text-center"
    >
      {items.map((t) => (
        <div
          key={t.id}
          data-testid="toast"
          role="status"
          className="border-2 border-ink bg-ink px-3 py-1.5 font-mono text-xs text-paper shadow-hard"
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
