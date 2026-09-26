import {
  type BoardMeta,
  type Connector,
  getRoots,
  type Normalized,
  normalizeConnectors,
  normalizeShapes,
  readConnector,
  readMeta,
  readShape,
  type Shape,
} from '@relay/core';
import type * as Y from 'yjs';
import { createStore, type StoreApi } from 'zustand/vanilla';

export interface DocState {
  shapes: Record<string, Shape>;
  order: string[];
  connectors: Record<string, Connector>;
  connectorOrder: string[];
  meta: BoardMeta;
}

function touchedIds(events: Y.YEvent<Y.AbstractType<unknown>>[], root: unknown) {
  const touched = new Set<string>();
  for (const event of events) {
    if (event.target === root) {
      for (const key of event.changes.keys.keys()) touched.add(key);
    } else if (event.path.length > 0) {
      touched.add(String(event.path[0]));
    }
  }
  return touched;
}

/**
 * Projects the Y.Doc into immutable snapshots, rebuilding only the shapes and
 * connectors a transaction touched. Normalization (orphan connectors, invalid
 * parents) runs on every publish; unchanged entries keep object identity.
 */
export function createDocStore(doc: Y.Doc): { store: StoreApi<DocState>; destroy(): void } {
  const { shapes: yShapes, connectors: yConnectors, meta } = getRoots(doc);
  const rawShapes: Record<string, Shape> = {};
  const rawConnectors: Record<string, Connector> = {};

  const store = createStore<DocState>(() => ({
    shapes: {},
    order: [],
    connectors: {},
    connectorOrder: [],
    meta: readMeta(meta),
  }));

  let lastNormalized: Normalized | null = null;

  /** `shapesChanged` is false for a connector-only transaction, so the unchanged shapes/order are reused. */
  const publish = (shapesChanged: boolean) => {
    const normalized =
      shapesChanged || !lastNormalized ? normalizeShapes(rawShapes) : lastNormalized;
    lastNormalized = normalized;
    store.setState({ ...normalized, ...normalizeConnectors(rawConnectors, normalized.shapes) });
  };

  const rebuildShapes = (ids: Iterable<string>) => {
    for (const id of ids) {
      const m = yShapes.get(id);
      const shape = m ? readShape(id, m) : null;
      if (shape) rawShapes[id] = shape;
      else delete rawShapes[id];
    }
  };
  const rebuildConnectors = (ids: Iterable<string>) => {
    for (const id of ids) {
      const m = yConnectors.get(id);
      const connector = m ? readConnector(id, m) : null;
      if (connector) rawConnectors[id] = connector;
      else delete rawConnectors[id];
    }
  };

  const onShapes = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
    rebuildShapes(touchedIds(events, yShapes));
    publish(true);
  };
  const onConnectors = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
    rebuildConnectors(touchedIds(events, yConnectors));
    publish(false);
  };
  const onMeta = () => store.setState({ meta: readMeta(meta) });

  yShapes.observeDeep(onShapes);
  yConnectors.observeDeep(onConnectors);
  meta.observe(onMeta);
  rebuildShapes(yShapes.keys());
  rebuildConnectors(yConnectors.keys());
  publish(true);

  return {
    store,
    destroy() {
      yShapes.unobserveDeep(onShapes);
      yConnectors.unobserveDeep(onConnectors);
      meta.unobserve(onMeta);
    },
  };
}
