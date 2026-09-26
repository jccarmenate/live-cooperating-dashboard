import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyCommand,
  DEFAULT_STYLE,
  diffText,
  getRoots,
  type NewShape,
  readShape,
  transformCaret,
} from '../src';

function sticky(id: string, extra: Partial<NewShape> = {}): NewShape {
  return {
    id,
    type: 'sticky',
    x: 0,
    y: 0,
    w: 180,
    h: 140,
    style: DEFAULT_STYLE.sticky,
    text: 'hi',
    createdBy: 'u1',
    authorName: 'Brisk Otter',
    createdAt: 1,
    ...extra,
  };
}

function readText(doc: Y.Doc, id: string): string | undefined {
  const m = getRoots(doc).shapes.get(id);
  return m ? readShape(id, m)?.text : undefined;
}

describe('diffText', () => {
  it('returns null for equal strings', () => {
    expect(diffText('abc', 'abc')).toBeNull();
  });

  it('detects insertions, deletions and replacements', () => {
    expect(diffText('hello', 'hello!')).toEqual({ index: 5, deleteCount: 0, insert: '!' });
    expect(diffText('hello', 'hllo')).toEqual({ index: 1, deleteCount: 1, insert: '' });
    expect(diffText('cat', 'cut')).toEqual({ index: 1, deleteCount: 1, insert: 'u' });
    expect(diffText('', 'new')).toEqual({ index: 0, deleteCount: 0, insert: 'new' });
  });

  it('applying the diff reproduces the target', () => {
    const cases: [string, string][] = [
      ['aaa', 'aaaa'],
      ['abcabc', 'abc'],
      ['x', ''],
      ['sprint retro', 'sprint 14 retro'],
    ];
    for (const [a, b] of cases) {
      const d = diffText(a, b);
      if (!d) throw new Error('expected a diff');
      expect(a.slice(0, d.index) + d.insert + a.slice(d.index + d.deleteCount)).toBe(b);
    }
  });

  describe('surrogate pairs', () => {
    // Each emoji below is one UTF-16 surrogate pair (two code units). A
    // naive common-prefix/suffix scan can land the diff boundary between the
    // two halves of a pair, which corrupts a real Y.Text (ContentString
    // splice replaces both halves with U+FFFD).
    const cases: [string, string][] = [
      ['\u{1F600}', '\u{1F601}\u{1F600}'], // 😀 -> 😁😀
      ['a\u{1F600}', 'a\u{1F601}'], // a😀 -> a😁
      ['\u{1F601}\u{1F600}', '\u{1F600}'], // 😁😀 -> 😀
    ];

    it('never splits a surrogate pair when applied as a plain-string slice', () => {
      for (const [prev, next] of cases) {
        const d = diffText(prev, next);
        if (!d) throw new Error('expected a diff');
        expect(prev.slice(0, d.index) + d.insert + prev.slice(d.index + d.deleteCount)).toBe(next);
      }
    });

    it('applies cleanly to a real Y.Text via SetText', () => {
      for (const [prev, next] of cases) {
        const doc = new Y.Doc();
        applyCommand(doc, { type: 'CreateShape', shape: sticky('s1', { text: prev }) });
        const d = diffText(prev, next);
        if (!d) throw new Error('expected a diff');
        applyCommand(doc, { type: 'SetText', id: 's1', ...d });
        expect(readText(doc, 's1')).toBe(next);
      }
    });
  });
});

describe('transformCaret', () => {
  const d = { index: 5, deleteCount: 2, insert: 'XYZ' };
  it('keeps carets before the edit', () => {
    expect(transformCaret(3, d)).toBe(3);
    expect(transformCaret(5, d)).toBe(5);
  });
  it('shifts carets after the edit', () => {
    expect(transformCaret(10, d)).toBe(11);
  });
  it('moves carets inside a deleted range to the end of the insertion', () => {
    expect(transformCaret(6, d)).toBe(8);
  });
});
