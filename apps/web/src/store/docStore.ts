import {
  type BoardMeta,
  getRoots,
  normalizeShapes,
  readMeta,
  readShape,
  type Shape,
} from '@relay/core';
import type * as Y from 'yjs';
import { createStore, type StoreApi } from 'zustand/vanilla';

export interface DocState {
  shapes: Record<string, Shape>;
  order: string[];
  meta: BoardMeta;
}

/** Projects the Y.Doc into immutable snapshots, rebuilding only the shapes a transaction touched. */
export function createDocStore(doc: Y.Doc): { store: StoreApi<DocState>; destroy(): void } {
  const { shapes: yShapes, meta } = getRoots(doc);
  const raw: Record<string, Shape> = {};

  const store = createStore<DocState>(() => ({ shapes: {}, order: [], meta: readMeta(meta) }));

  const rebuild = (ids: Iterable<string>) => {
    for (const id of ids) {
      const m = yShapes.get(id);
      const shape = m ? readShape(id, m) : null;
      if (shape) raw[id] = shape;
      else delete raw[id];
    }
    store.setState(normalizeShapes(raw));
  };

  const onShapes = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
    const touched = new Set<string>();
    for (const event of events) {
      if (event.target === yShapes) {
        for (const key of event.changes.keys.keys()) touched.add(key);
      } else if (event.path.length > 0) {
        touched.add(String(event.path[0]));
      }
    }
    rebuild(touched);
  };
  const onMeta = () => store.setState({ meta: readMeta(meta) });

  yShapes.observeDeep(onShapes);
  meta.observe(onMeta);
  rebuild(yShapes.keys());

  return {
    store,
    destroy() {
      yShapes.unobserveDeep(onShapes);
      meta.unobserve(onMeta);
    },
  };
}
