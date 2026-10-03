import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { swatchBackground } from './swatches';

export interface MenuItem {
  label: string;
  onSelect(): void;
  disabled?: boolean;
  danger?: boolean;
  testId?: string;
  /** Shortcut shown on the right. */
  hint?: string;
}

export interface MenuSeparator {
  separator: true;
}

export interface MenuSwatches {
  swatches: { color: string; label: string; onSelect(): void; testId?: string }[];
  disabled?: boolean;
}

export type MenuEntry = MenuItem | MenuSeparator | MenuSwatches;

const EDGE = 8;

/**
 * A small menu at client point (x, y), kept inside the viewport. It closes on an outside
 * press, Escape, or after a choice. Arrow keys move between the items.
 */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuEntry[];
  onClose(): void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const left = Math.max(EDGE, Math.min(x, window.innerWidth - el.offsetWidth - EDGE));
    const top = Math.max(EDGE, Math.min(y, window.innerHeight - el.offsetHeight - EDGE));
    setPos({ left, top });
  }, [x, y]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    // Fallback for when focus is outside the menu (keys inside it stop at the menu root).
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

  const move = (delta: number) => {
    const buttons = [
      ...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not([disabled])') ?? []),
    ];
    if (buttons.length === 0) return;
    const i = buttons.indexOf(document.activeElement as HTMLButtonElement);
    buttons[(i + delta + buttons.length) % buttons.length]?.focus();
  };

  const choose = (onSelect: () => void) => {
    onClose();
    onSelect();
  };

  return (
    <div
      ref={ref}
      role="menu"
      data-testid="context-menu"
      className="fixed z-50 min-w-48 border-2 border-ink bg-white py-1 shadow-hard"
      style={pos}
      onContextMenu={(e) => e.preventDefault()}
      // Keys pressed inside the menu never reach the window's board shortcuts (Delete, tool
      // letters, Escape's cancel); Escape is handled here because the window listener no
      // longer sees it.
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onClose();
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          move(e.key === 'ArrowDown' ? 1 : -1);
        }
      }}
    >
      {items.map((item, i) => {
        if ('separator' in item) {
          // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity
          return <hr key={`sep-${i}`} className="my-1 border-ink/20" />;
        }
        if ('swatches' in item) {
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: one swatch row per menu position
            <div key={`swatches-${i}`} className="flex gap-1.5 px-3 py-1.5">
              {item.swatches.map((s) => (
                <button
                  key={s.label}
                  type="button"
                  role="menuitem"
                  aria-label={s.label}
                  title={s.label}
                  data-testid={s.testId}
                  disabled={item.disabled}
                  className="size-swatch border-2 border-ink hover:-translate-y-px focus:outline-2 focus:outline-cobalt disabled:cursor-not-allowed disabled:opacity-40"
                  style={{ background: swatchBackground(s.color) }}
                  onClick={() => choose(s.onSelect)}
                />
              ))}
            </div>
          );
        }
        return (
          <button
            key={item.label}
            type="button"
            role="menuitem"
            data-testid={item.testId}
            disabled={item.disabled}
            className={`flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left font-mono text-xs pointer-coarse:py-2.5 hover:bg-sun focus:bg-sun focus:outline-none disabled:cursor-not-allowed disabled:text-ink/40 disabled:hover:bg-transparent ${item.danger ? 'text-flame' : ''}`}
            onClick={() => choose(item.onSelect)}
          >
            <span>{item.label}</span>
            {item.hint && <span className="text-2xs text-ink/50">{item.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}
