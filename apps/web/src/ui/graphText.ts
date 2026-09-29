import type { AlgorithmResult } from '@relay/core';

/** Node names are shown at most this long in the Algorithms panel (display only). */
export const MAX_SHOWN_NAME = 40;

/** A node name cut to `MAX_SHOWN_NAME` characters, ending in an ellipsis when cut. */
export function shortName(name: string): string {
  return name.length > MAX_SHOWN_NAME ? `${name.slice(0, MAX_SHOWN_NAME - 1)}…` : name;
}

/**
 * The result as text. Names come from the snapshot taken when it ran (a later selection or
 * move must not rename or renumber them); nodes deleted since are left out.
 */
export function describeResult(
  result: AlgorithmResult,
  names: Readonly<Record<string, string>>,
  present: (id: string) => boolean,
): string {
  const list = (ids: string[]) =>
    ids
      .filter(present)
      .map((id) => shortName(names[id] ?? '?'))
      .join(' → ');
  switch (result.kind) {
    case 'traversal':
      return `Visit order: ${list(result.order)}`;
    case 'path':
      return `${list(result.nodes)} · cost ${result.cost}`;
    case 'mst':
      return `${result.edges.length} edge${result.edges.length === 1 ? '' : 's'} · total weight ${result.total}`;
    case 'components':
      return `${result.groups.length} component${result.groups.length === 1 ? '' : 's'}`;
    case 'error':
      return result.message;
  }
}
