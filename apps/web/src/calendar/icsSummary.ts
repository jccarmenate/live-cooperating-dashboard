import type { IcsWarning } from '@relay/core';

/** Warnings the import summary lists at most; a file of distinct unknown zones can warn once per event. */
export const MAX_SHOWN_WARNINGS = 100;

/** The warnings to list, and how many more there are past the cap. */
export function capWarnings(
  warnings: IcsWarning[],
  max = MAX_SHOWN_WARNINGS,
): { shown: IcsWarning[]; more: number } {
  const shown = warnings.slice(0, max);
  return { shown, more: warnings.length - shown.length };
}
