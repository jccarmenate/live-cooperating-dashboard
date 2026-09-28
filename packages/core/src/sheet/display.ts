import { type CellValue, MAX_TEXT_RESULT } from './evaluate';
import type { CellAlign, CellFormat, NumFormat } from './model';

const formatters = new Map<string, Intl.NumberFormat>();

function formatter(locale: string | undefined, kind: NumFormat | 'general'): Intl.NumberFormat {
  const key = `${locale ?? ''}|${kind}`;
  let f = formatters.get(key);
  if (!f) {
    const options: Intl.NumberFormatOptions =
      kind === 'number'
        ? { minimumFractionDigits: 2, maximumFractionDigits: 2 }
        : kind === 'percent'
          ? { style: 'percent', maximumFractionDigits: 2 }
          : kind === 'eur'
            ? { style: 'currency', currency: 'EUR' }
            : kind === 'usd'
              ? { style: 'currency', currency: 'USD' }
              : { maximumSignificantDigits: 10, useGrouping: false };
    f = new Intl.NumberFormat(locale, options);
    formatters.set(key, f);
  }
  return f;
}

/** The text a cell shows. */
export function formatValue(v: CellValue, fmt?: CellFormat, locale?: string): string {
  switch (v.t) {
    case 'empty':
      return '';
    case 'err':
      return v.v;
    case 'bool':
      return v.v ? 'TRUE' : 'FALSE';
    case 'str':
      // Defence in depth: evaluation already caps text results.
      return v.v.length > MAX_TEXT_RESULT ? v.v.slice(0, MAX_TEXT_RESULT) : v.v;
    case 'num':
      return formatter(locale, fmt?.num ?? 'general').format(v.v);
  }
}

export const defaultAlign = (v: CellValue): CellAlign =>
  v.t === 'num' ? 'right' : v.t === 'bool' || v.t === 'err' ? 'center' : 'left';
