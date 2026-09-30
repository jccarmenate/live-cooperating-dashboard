import { type ReactNode, useEffect, useRef } from 'react';
import { pushDialog } from './dialogStack';

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function Dialog({
  title,
  onClose,
  children,
  wide = false,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
  wide?: boolean;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // Focus moves into the dialog so board shortcuts (Delete, tool letters) cannot act behind it,
  // and returns to where it was when the dialog closes.
  useEffect(() => {
    const previous = document.activeElement;
    panel.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  // Escape still closes the dialog when focus is not inside the panel (e.g. it never entered,
  // or the focused control was removed and focus fell back to the page body), but only the
  // topmost of stacked dialogs. A backdrop click closes the dialog on its own.
  const close = useRef(onClose);
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);
  useEffect(() => {
    const entry = pushDialog();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && entry.isTop()) close.current();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      entry.remove();
    };
  }, []);
  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-ink/30 px-4"
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        data-testid="dialog"
        // Keys pressed inside the dialog never reach the window's board shortcuts; Escape is
        // handled here because the window listener above no longer sees it.
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') onClose();
          if (e.key !== 'Tab' || !panel.current) return;
          // Tab cycles inside the dialog.
          const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
          const first = items[0];
          const last = items.at(-1);
          if (!first || !last) {
            e.preventDefault();
            return;
          }
          const active = document.activeElement;
          if (e.shiftKey && (active === first || active === panel.current)) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && active === last) {
            e.preventDefault();
            first.focus();
          }
        }}
        // A dialog taller than the window (the event editor on a short screen) scrolls inside.
        className={`max-h-[calc(100dvh-2rem)] w-full overflow-y-auto ${wide ? 'max-w-2xl' : 'max-w-md'} border-[3px] border-ink bg-white p-5 shadow-hard`}
      >
        <h2 className="font-display text-lg uppercase">{title}</h2>
        <div className="mt-3">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  onConfirm,
  onClose,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm(): void;
  onClose(): void;
}) {
  return (
    <Dialog title={title} onClose={onClose}>
      <p className="break-words font-mono text-xs">{message}</p>
      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          data-testid="confirm-cancel"
          className="border-2 border-ink px-3 py-1 font-mono text-xs uppercase hover:bg-paper"
          onClick={onClose}
        >
          Cancel
        </button>
        <button
          type="button"
          data-testid="confirm-ok"
          className="border-2 border-ink bg-flame px-3 py-1 font-mono text-xs font-bold uppercase text-white"
          onClick={() => {
            onClose();
            onConfirm();
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
