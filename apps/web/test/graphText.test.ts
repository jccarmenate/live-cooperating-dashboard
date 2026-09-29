import type { AlgorithmResult } from '@relay/core';
import { describe, expect, it } from 'vitest';
import { describeResult, MAX_SHOWN_NAME, shortName } from '../src/ui/graphText';

const long = 'N'.repeat(60);

describe('shortName', () => {
  it('keeps names up to 40 characters', () => {
    expect(MAX_SHOWN_NAME).toBe(40);
    expect(shortName('A')).toBe('A');
    expect(shortName('x'.repeat(40))).toBe('x'.repeat(40));
  });

  it('cuts longer names to 40 characters ending in an ellipsis', () => {
    const shown = shortName(long);
    expect(shown).toHaveLength(40);
    expect(shown).toBe(`${'N'.repeat(39)}…`);
  });
});

describe('describeResult', () => {
  const names = { a: 'A', b: long };
  const present = () => true;

  it('shortens long names in the visit order and path', () => {
    const visit: AlgorithmResult = { kind: 'traversal', order: ['a', 'b'], edges: [] };
    expect(describeResult(visit, names, present)).toBe(`Visit order: A → ${shortName(long)}`);
    const path: AlgorithmResult = { kind: 'path', nodes: ['a', 'b'], edges: [], cost: 3 };
    expect(describeResult(path, names, present)).toBe(`A → ${shortName(long)} · cost 3`);
  });

  it('leaves out nodes deleted since the run', () => {
    const visit: AlgorithmResult = { kind: 'traversal', order: ['a', 'b'], edges: [] };
    expect(describeResult(visit, names, (id) => id === 'a')).toBe('Visit order: A');
  });
});
