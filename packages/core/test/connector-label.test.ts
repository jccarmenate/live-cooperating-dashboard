import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  applyCommand,
  type Connector,
  copyPayload,
  DEFAULT_STYLE,
  getRoots,
  MAX_CONNECTOR_LABEL,
  type NewShape,
  parseClip,
  pastePlan,
  pathMidpoint,
  readConnector,
  type Shape,
  serializeClip,
} from '../src';

const node = (id: string, x: number): NewShape => ({
  id,
  type: 'ellipse',
  x,
  y: 0,
  w: 56,
  h: 56,
  style: DEFAULT_STYLE.ellipse,
  text: id,
  createdBy: 'u1',
  authorName: 'A',
  createdAt: 0,
});

function doc2() {
  const doc = new Y.Doc();
  applyCommand(doc, { type: 'CreateShape', shape: node('a', 0) });
  applyCommand(doc, { type: 'CreateShape', shape: node('b', 200) });
  applyCommand(doc, {
    type: 'Connect',
    connector: {
      id: 'k',
      from: { shapeId: 'a', anchor: 'auto' },
      to: { shapeId: 'b', anchor: 'auto' },
      routing: 'straight',
      head: 'none',
      createdBy: 'u1',
      label: '7',
    },
  });
  return doc;
}
const read = (doc: Y.Doc) => {
  const m = getRoots(doc).connectors.get('k');
  return m ? readConnector('k', m) : null;
};

describe('connector labels', () => {
  it('Connect writes the label and readConnector reads it', () => {
    expect(read(doc2())?.label).toBe('7');
  });

  it('Connect trims the label before capping it, like SetConnectorLabel', () => {
    const connect = (label: string) => {
      const doc = doc2();
      getRoots(doc).connectors.delete('k');
      applyCommand(doc, {
        type: 'Connect',
        connector: {
          id: 'k',
          from: { shapeId: 'a', anchor: 'auto' },
          to: { shapeId: 'b', anchor: 'auto' },
          routing: 'straight',
          head: 'none',
          createdBy: 'u1',
          label,
        },
      });
      return getRoots(doc).connectors.get('k');
    };
    const padded = `${' '.repeat(10)}${'x'.repeat(60)}`;
    expect(connect(padded)?.get('label')).toBe('x'.repeat(MAX_CONNECTOR_LABEL));
    expect(connect('  7  ')?.get('label')).toBe('7');
    expect(connect('   ')?.has('label')).toBe(false);
  });

  it('SetConnectorLabel sets (trimmed, capped) and clears', () => {
    const doc = doc2();
    applyCommand(doc, { type: 'SetConnectorLabel', id: 'k', label: `  ${'x'.repeat(60)}  ` });
    expect(read(doc)?.label).toBe('x'.repeat(MAX_CONNECTOR_LABEL));
    applyCommand(doc, { type: 'SetConnectorLabel', id: 'k', label: '   ' });
    expect(read(doc)?.label).toBeUndefined();
    expect(getRoots(doc).connectors.get('k')?.has('label')).toBe(false);
    applyCommand(doc, { type: 'SetConnectorLabel', id: 'missing', label: 'x' });
  });

  it('reads a non-string or over-long stored label defensively', () => {
    const doc = doc2();
    getRoots(doc).connectors.get('k')?.set('label', 5);
    expect(read(doc)?.label).toBeUndefined();
    getRoots(doc).connectors.get('k')?.set('label', 'y'.repeat(100));
    expect(read(doc)?.label).toHaveLength(MAX_CONNECTOR_LABEL);
  });

  it('copy and paste keep the label', () => {
    const shapes: Record<string, Shape> = {
      a: { ...node('a', 0), z: 'a0' } as Shape,
      b: { ...node('b', 200), z: 'a1' } as Shape,
    };
    const connectors: Record<string, Connector> = {
      k: {
        id: 'k',
        from: { shapeId: 'a', anchor: 'auto' },
        to: { shapeId: 'b', anchor: 'auto' },
        routing: 'straight',
        head: 'none',
        z: 'a0',
        createdBy: 'u1',
        label: '3',
      },
    };
    const copied = copyPayload(['a', 'b'], shapes, connectors);
    if (!copied) throw new Error('nothing copied');
    const payload = parseClip(serializeClip(copied));
    if (!payload) throw new Error('clip did not parse');
    let n = 0;
    const plan = pastePlan(
      payload,
      {
        shapes: {},
        newId: () => `n${++n}`,
        userId: 'u1',
        userName: 'A',
        now: () => 0,
      },
      { offset: 24 },
    );
    expect(plan.connectors[0]?.label).toBe('3');
  });

  it('pathMidpoint walks half the polyline length', () => {
    expect(
      pathMidpoint([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
      ]),
    ).toEqual({ x: 5, y: 0 });
    expect(
      pathMidpoint([
        { x: 0, y: 0 },
        { x: 0, y: 10 },
        { x: 10, y: 10 },
      ]),
    ).toEqual({ x: 0, y: 10 });
    expect(pathMidpoint([{ x: 3, y: 4 }])).toEqual({ x: 3, y: 4 });
  });
});
