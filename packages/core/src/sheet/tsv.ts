const NEEDS_QUOTE = /[\t\n\r"]/;

/** Tab-separated text as Excel and Google Sheets write it (quoted when a field has a tab, newline or quote). */
export function toTsv(rows: string[][]): string {
  return rows
    .map((row) =>
      row.map((f) => (NEEDS_QUOTE.test(f) ? `"${f.replace(/"/g, '""')}"` : f)).join('\t'),
    )
    .join('\n');
}

/** Parses tab-separated text; quoted fields may hold tabs, newlines and doubled quotes. */
export function parseTsv(text: string): string[][] {
  const t = text.replace(/\r\n?/g, '\n');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let atFieldStart = true;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i] as string;
    if (quoted) {
      if (ch === '"') {
        if (t[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && atFieldStart) {
      quoted = true;
      atFieldStart = false;
    } else if (ch === '\t') {
      row.push(field);
      field = '';
      atFieldStart = true;
    } else if (ch === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
      atFieldStart = true;
    } else {
      field += ch;
      atFieldStart = false;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}
