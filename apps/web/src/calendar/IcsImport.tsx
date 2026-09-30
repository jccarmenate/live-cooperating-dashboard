import type { IcsWarning } from '@relay/core';
import { Dialog } from '../ui/Dialog';
import { capWarnings } from './icsSummary';

export interface IcsImportResult {
  imported: number;
  skipped: number;
  warnings: IcsWarning[];
}

export function IcsImport({
  result,
  onClose,
}: {
  result: IcsImportResult | null;
  onClose(): void;
}) {
  if (!result) return null;
  const { shown, more } = capWarnings(result.warnings);
  return (
    <Dialog title="Import .ics" onClose={onClose}>
      <div data-testid="cal-import-summary" className="flex flex-col gap-2 font-mono text-xs">
        <p>
          Imported {result.imported} {result.imported === 1 ? 'event' : 'events'}
        </p>
        {result.skipped > 0 && <p>{result.skipped} already in this calendar</p>}
        {shown.length > 0 && (
          <ul className="max-h-48 overflow-y-auto border-2 border-ink/20 p-2">
            {shown.map((w, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: warnings can repeat; the list is rebuilt whole
              <li key={i}>
                Line {w.line}: {w.message}
              </li>
            ))}
            {more > 0 && <li>…and {more} more</li>}
          </ul>
        )}
        <button
          type="button"
          className="self-end border-2 border-ink bg-sun px-3 py-1.5 uppercase"
          onClick={onClose}
        >
          OK
        </button>
      </div>
    </Dialog>
  );
}
