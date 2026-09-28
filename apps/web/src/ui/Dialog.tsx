import { type ReactNode, useEffect, useRef } from 'react';

export function Dialog({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // Focus moves into the dialog so board shortcuts (Delete, tool letters) cannot act behind it.
  useEffect(() => {
    panel.current?.focus();
  }, []);
  // Escape still closes the dialog when focus has left the panel (e.g. a click on the backdrop).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
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
        }}
        className="w-full max-w-md border-[3px] border-ink bg-white p-5 shadow-hard"
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
      <p className="font-mono text-xs">{message}</p>
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
