import { useStore } from 'zustand';
import { toasts } from './toasts';

export function ToastHost() {
  const items = useStore(toasts, (s) => s.items);
  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed bottom-6 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2"
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
