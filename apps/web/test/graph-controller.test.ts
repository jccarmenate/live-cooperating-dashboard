import {
  applyCommand,
  type Connector,
  DEFAULT_STYLE,
  familyGraph,
  type GraphDraft,
  getRoots,
  LOCAL_ORIGIN,
  MAX_CONNECTOR_LABEL,
  type NewShape,
  parseEdgeList,
  readConnector,
  type Shape,
} from '@relay/core';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createBoardController } from '../src/board/controller';
import { labelUnchanged } from '../src/render/connectorLabel';
import { createActivityStore } from '../src/store/activityStore';
import { createDocStore } from '../src/store/docStore';

export function setup() {
  const doc = new Y.Doc();
  const docs = createDocStore(doc);
  const activity = createActivityStore(doc);
  let n = 0;
  const notify = vi.fn();
  const controller = createBoardController({
    doc,
    docStore: docs.store,
    setPage: docs.setPage,
    activity: activity.store,
    user: { id: 'u1', name: 'Brisk Otter', color: '#E85A1B' },
    newId: () => `id${++n}`,
    now: () => 1000,
    notify,
  });
  return { doc, docs, controller, notify };
}

const node = (id: string, x: number, y: number, text = id): NewShape => ({
  id,
  type: 'ellipse',
  x,
  y,
  w: 56,
  h: 56,
  style: DEFAULT_STYLE.ellipse,
  text,
  createdBy: 'u1',
  authorName: 'A',
  createdAt: 0,
});

export function twoNodes(doc: Y.Doc) {
  applyCommand(doc, { type: 'CreateShape', shape: node('a', 0, 0, 'A') }, LOCAL_ORIGIN);
  applyCommand(doc, { type: 'CreateShape', shape: node('b', 300, 0, 'B') }, LOCAL_ORIGIN);
  applyCommand(
    doc,
    {
      type: 'Connect',
      connector: {
        id: 'k',
        from: { shapeId: 'a', anchor: 'auto' },
        to: { shapeId: 'b', anchor: 'auto' },
        routing: 'straight',
        head: 'none',
        createdBy: 'u1',
      },
    },
    LOCAL_ORIGIN,
  );
}

const label = (doc: Y.Doc) => {
  const m = getRoots(doc).connectors.get('k');
  return m ? readConnector('k', m)?.label : undefined;
};

describe('connector label editing', () => {
  it('opens, commits as one undo step, and closes', () => {
    const { doc, controller } = setup();
    twoNodes(doc);
    controller.editConnectorLabel('k');
    expect(controller.ui.getState().editingConnector).toBe('k');
    controller.setConnectorLabel('k', ' 12 ');
    expect(label(doc)).toBe('12');
    expect(controller.ui.getState().editingConnector).toBeNull();
    controller.undo();
    expect(getRoots(doc).connectors.get('k')).toBeDefined();
    expect(label(doc)).toBeUndefined();
  });

  it('keeps the editor open, and writes nothing, when a gesture is in progress', () => {
    const { doc, controller } = setup();
    twoNodes(doc);
    controller.editConnectorLabel('k');
    controller.dispatch({
      type: 'pointerDown',
      p: { world: { x: 28, y: 28 }, shift: false, hitId: 'a' },
    });
    expect(controller.ui.getState().tool.mode).not.toBe('idle');
    controller.setConnectorLabel('k', '7');
    expect(label(doc)).toBeUndefined();
    expect(controller.ui.getState().editingConnector).toBe('k');
    controller.dispatch({
      type: 'pointerUp',
      p: { world: { x: 28, y: 28 }, shift: false, hitId: 'a' },
    });
    controller.setConnectorLabel('k', '7');
    expect(label(doc)).toBe('7');
    expect(controller.ui.getState().editingConnector).toBeNull();
  });

  it('closes the editor when the connector is deleted or the page changes', () => {
    const { doc, controller } = setup();
    twoNodes(doc);
    controller.editConnectorLabel('k');
    applyCommand(doc, { type: 'DeleteShapes', ids: ['k'] }, 'remote');
    expect(controller.ui.getState().editingConnector).toBeNull();
    twoNodes(doc);
    controller.editConnectorLabel('k');
    controller.setPage(controller.createPage('board'));
    expect(controller.ui.getState().editingConnector).toBeNull();
  });
});

describe('labelUnchanged', () => {
  it('compares the normalised value with the label the editor opened with', () => {
    expect(labelUnchanged('12', ' 12 ')).toBe(true);
    expect(labelUnchanged('', '   ')).toBe(true);
    expect(labelUnchanged('', '')).toBe(true);
    expect(labelUnchanged('12', '13')).toBe(false);
    expect(labelUnchanged('12', '')).toBe(false);
    expect(labelUnchanged('', 'x')).toBe(false);
    const long = 'x'.repeat(MAX_CONNECTOR_LABEL);
    expect(labelUnchanged(long, `${long}yz`)).toBe(true);
  });
});

describe('creating graphs', () => {
  it('creates a family as ellipses and connectors, selected, in one undo step', () => {
    const { doc, docs, controller } = setup();
    controller.setViewportSize(800, 600);
    const d = familyGraph(
      'complete',
      { n: 4, m: 1, k: 1, depth: 0, p: 0 },
      {
        directed: false,
        weighted: false,
        names: 'letters',
      },
    ) as GraphDraft;
    expect(controller.createGraph(d)).toBe(true);
    const state = docs.store.getState();
    expect(
      Object.values(state.shapes)
        .map((s) => s.text)
        .sort(),
    ).toEqual(['A', 'B', 'C', 'D']);
    expect(Object.keys(state.connectors)).toHaveLength(6);
    expect(controller.ui.getState().tool.selection).toHaveLength(10);
    controller.undo();
    expect(getRoots(doc).shapes.size).toBe(0);
  });

  it('keeps edge-list labels and directions', () => {
    const { docs, controller } = setup();
    controller.setViewportSize(800, 600);
    controller.createGraph(parseEdgeList('A->B:5').draft as GraphDraft);
    const [c] = Object.values(docs.store.getState().connectors);
    expect(c).toMatchObject({ head: 'arrow', label: '5' });
  });

  it('menu and dialog flags', () => {
    const { controller } = setup();
    controller.setGraphMenu(true);
    expect(controller.ui.getState().graphMenu).toBe(true);
    controller.setGraphDialog(true);
    expect(controller.ui.getState()).toMatchObject({ graphMenu: false, graphDialog: true });
  });
});

describe('algorithms', () => {
  it('runs on the page graph, stores the result locally, and clears on Escape', () => {
    const { doc, controller } = setup();
    twoNodes(doc);
    controller.setAlgorithmsPanel(true);
    const r = controller.runAlgorithm('path', 'a', 'b');
    expect(r).toEqual({ kind: 'path', nodes: ['a', 'b'], edges: ['k'], cost: 1 });
    expect(controller.ui.getState().graphResult).toEqual(r);
    controller.dispatch({ type: 'cancel' });
    expect(controller.ui.getState().graphResult).toBeNull();
  });

  it('uses only the selection when there is one', () => {
    const { doc, controller } = setup();
    twoNodes(doc);
    controller.select(['a']);
    expect(controller.runAlgorithm('components')).toEqual({ kind: 'components', groups: [['a']] });
  });

  it('the algorithms and comments panels exclude each other', () => {
    const { controller } = setup();
    controller.setAlgorithmsPanel(true);
    controller.toggleCommentsPanel();
    expect(controller.ui.getState()).toMatchObject({ commentsPanel: true, algorithmsPanel: false });
    controller.setAlgorithmsPanel(true);
    expect(controller.ui.getState()).toMatchObject({ commentsPanel: false, algorithmsPanel: true });
  });

  it('a page change clears the result', () => {
    const { doc, controller } = setup();
    twoNodes(doc);
    controller.runAlgorithm('bfs', 'a');
    controller.setPage(controller.createPage('board'));
    expect(controller.ui.getState().graphResult).toBeNull();
  });

  it('snapshots the node names of the run, so a later selection change keeps them', () => {
    const { doc, controller } = setup();
    twoNodes(doc);
    controller.runAlgorithm('bfs', 'a');
    expect(controller.ui.getState().graphNames).toEqual({ a: 'A', b: 'B' });
    controller.select(['b']);
    expect(controller.ui.getState().graphNames).toEqual({ a: 'A', b: 'B' });
    expect(controller.ui.getState().graphResult).toEqual({
      kind: 'traversal',
      order: ['a', 'b'],
      edges: ['k'],
    });
  });

  it('a cancel mid-gesture ends the gesture but keeps the result', () => {
    const { doc, controller } = setup();
    twoNodes(doc);
    controller.runAlgorithm('bfs', 'a');
    controller.dispatch({
      type: 'pointerDown',
      p: { world: { x: 28, y: 28 }, shift: false, hitId: 'a' },
    });
    expect(controller.ui.getState().tool.mode).not.toBe('idle');
    controller.dispatch({ type: 'cancel' });
    expect(controller.ui.getState().tool.mode).toBe('idle');
    expect(controller.ui.getState().graphResult).not.toBeNull();
  });

  it('clearGraphResult removes the result and its names', () => {
    const { doc, controller } = setup();
    twoNodes(doc);
    controller.runAlgorithm('bfs', 'a');
    controller.clearGraphResult();
    expect(controller.ui.getState()).toMatchObject({ graphResult: null, graphNames: {} });
  });

  it('closing the panel, directly or by opening Comments, clears the result', () => {
    const { doc, controller } = setup();
    twoNodes(doc);
    controller.setAlgorithmsPanel(true);
    controller.runAlgorithm('bfs', 'a');
    controller.setAlgorithmsPanel(true);
    expect(controller.ui.getState().graphResult).not.toBeNull();
    controller.setAlgorithmsPanel(false);
    expect(controller.ui.getState()).toMatchObject({ graphResult: null, graphNames: {} });

    controller.setAlgorithmsPanel(true);
    controller.runAlgorithm('bfs', 'a');
    controller.toggleCommentsPanel();
    expect(controller.ui.getState()).toMatchObject({
      algorithmsPanel: false,
      graphResult: null,
      graphNames: {},
    });
  });

  it('maps an algorithm that throws (a DFS deeper than the stack) to an error result', () => {
    const { docs, controller } = setup();
    // A projected chain far deeper than the call stack: the recursive DFS overflows on it.
    const N = 100_000;
    const shapes: Record<string, Shape> = {};
    const connectors: Record<string, Connector> = {};
    for (let i = 0; i < N; i++) {
      shapes[`n${i}`] = { ...node(`n${i}`, i * 100, 0), pageId: 'main' } as unknown as Shape;
      if (i > 0) {
        connectors[`e${i}`] = {
          id: `e${i}`,
          from: { shapeId: `n${i - 1}`, anchor: 'auto' },
          to: { shapeId: `n${i}`, anchor: 'auto' },
          routing: 'straight',
          head: 'none',
          createdBy: 'u1',
        } as unknown as Connector;
      }
    }
    docs.store.setState({ shapes, connectors });
    const r = controller.runAlgorithm('dfs', 'n0');
    expect(r).toEqual({ kind: 'error', message: 'The graph is too large for this algorithm' });
    expect(controller.ui.getState().graphResult).toEqual(r);
  });
});
