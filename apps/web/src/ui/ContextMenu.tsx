import { useEffect, useRef } from 'react';

export interface MenuItem {
  label: string;
  onSelect(): void;
  disabled?: boolean;
  danger?: boolean;
  testId?: string;
}

/** A small menu at screen point (x, y); closes on outside press, Escape, or after a choice. */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    ref.current?.querySelector<HTMLButtonElement>('button:not([disabled])')?.focus();
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      data-testid="context-menu"
      className="fixed z-50 min-w-40 border-2 border-ink bg-white py-1 shadow-hard"
      style={{ left: x, top: y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item) => (
        <button
          key={item.label}
          type="button"
          role="menuitem"
          data-testid={item.testId}
          disabled={item.disabled}
          className={`block w-full px-3 py-1.5 text-left font-mono text-xs hover:bg-sun focus:bg-sun focus:outline-none disabled:cursor-not-allowed disabled:text-ink/40 disabled:hover:bg-transparent ${item.danger ? 'text-flame' : ''}`}
          onClick={() => {
            onClose();
            item.onSelect();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
