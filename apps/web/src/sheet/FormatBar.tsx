import { type CellAlign, cellKey, type NumFormat } from '@relay/core';
import { AlignCenter, AlignLeft, AlignRight, Bold } from 'lucide-react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import type { SheetController } from './sheetController';

const ALIGN_ICONS = { left: AlignLeft, center: AlignCenter, right: AlignRight } as const;

/** Bold, alignment and number format for the selection (editors only). */
export function FormatBar({ session, ctl }: { session: BoardSession; ctl: SheetController }) {
  const anchor = useStore(ctl.ui, (s) => s.anchor);
  const fmt = useStore(session.sheet, (s) =>
    anchor ? s.sheet?.cells[cellKey(anchor.row, anchor.col)]?.fmt : undefined,
  );
  const button = (active: boolean) =>
    `grid size-7 place-items-center border-2 ${active ? 'border-ink bg-sun' : 'border-transparent hover:border-ink'}`;
  return (
    <div
      role="toolbar"
      aria-label="Cell format"
      className="flex h-10 shrink-0 items-center gap-1 border-b-2 border-ink bg-white px-2 short:border-r-2 short:border-b-0"
    >
      <button
        type="button"
        data-testid="sheet-bold"
        aria-label="Bold (Ctrl+B)"
        aria-pressed={fmt?.bold === true}
        className={button(fmt?.bold === true)}
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => ctl.toggleBold()}
      >
        <Bold className="size-4" />
      </button>
      <span className="mx-1 h-5 w-px bg-ink/20" aria-hidden />
      {(['left', 'center', 'right'] as const satisfies readonly CellAlign[]).map((align) => {
        const Icon = ALIGN_ICONS[align];
        const active = fmt?.align === align;
        return (
          <button
            key={align}
            type="button"
            data-testid={`sheet-align-${align}`}
            aria-label={`Align ${align}`}
            aria-pressed={active}
            className={button(active)}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => ctl.setFormat({ align: active ? null : align })}
          >
            <Icon className="size-4" />
          </button>
        );
      })}
      <span className="mx-1 h-5 w-px bg-ink/20" aria-hidden />
      <label className="flex items-center gap-1 font-mono text-[10px] uppercase text-ink/60">
        Format
        <select
          data-testid="sheet-num-format"
          value={fmt?.num ?? ''}
          onChange={(e) => ctl.setFormat({ num: (e.target.value || null) as NumFormat | null })}
          className="border-2 border-ink bg-white px-1 py-0.5 font-mono text-xs text-ink"
        >
          <option value="">General</option>
          <option value="number">Number</option>
          <option value="percent">Percent</option>
          <option value="eur">€ Euro</option>
          <option value="usd">$ Dollar</option>
        </select>
      </label>
    </div>
  );
}
