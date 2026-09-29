import {
  applyCommand,
  DEFAULT_STYLE,
  getRoots,
  LOCAL_ORIGIN,
  MAX_CONNECTOR_LABEL,
  type NewShape,
  readConnector,
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
