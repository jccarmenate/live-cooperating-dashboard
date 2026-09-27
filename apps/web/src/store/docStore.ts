import {
  type BoardMeta,
  type Connector,
  getRoots,
  MAIN_PAGE,
  type Normalized,
  normalizeConnectors,
  normalizeShapes,
  type PageInfo,
  pageOf,
  readConnector,
  readMeta,
  readPages,
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
  /** Visible pages, ordered. */
  pages: PageInfo[];
  /** Page whose items `shapes`/`connectors` hold. */
  activePage: string;
  /** Shapes on every visible page (vote tallies are room-wide). */
  allShapes: Record<string, Shape>;
}

export function touchedIds(events: Y.YEvent<Y.AbstractType<unknown>>[], root: unknown) {
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
 * Projects the Y.Doc into immutable snapshots of the active page, rebuilding only
 * the shapes and connectors a transaction touched. Normalization (orphan
 * connectors, invalid parents) runs on every publish; unchanged entries keep
 * object identity. An unknown or deleted active page falls back to the first
 * visible page.
 */
export function createDocStore(
  doc: Y.Doc,
  initialPage: string = MAIN_PAGE,
): { store: StoreApi<DocState>; setPage(id: string): void; destroy(): void } {
  const {
    shapes: yShapes,
    connectors: yConnectors,
    meta,
    pages: yPages,
    pageTombstones: yTombstones,
  } = getRoots(doc);
  const rawShapes: Record<string, Shape> = {};
  const rawConnectors: Record<string, Connector> = {};

  const store = createStore<DocState>(() => ({
    shapes: {},
    order: [],
    connectors: {},
    connectorOrder: [],
    meta: readMeta(meta),
    pages: readPages(yPages, yTombstones),
    activePage: initialPage,
    allShapes: {},
  }));

  let requested = initialPage;
  const resolvePage = (pages: PageInfo[]) =>
    pages.some((p) => p.id === requested) ? requested : (pages[0]?.id ?? requested);

  let lastNormalized: { page: string; value: Normalized } | null = null;

  /** `shapesChanged` is false for a connector-only transaction, so the unchanged shapes/order are reused. */
  const publish = (shapesChanged: boolean) => {
    const pages = readPages(yPages, yTombstones);
    const visible = new Set(pages.map((p) => p.id));
    const activePage = resolvePage(pages);
    const onActive: Record<string, Shape> = {};
    const allShapes: Record<string, Shape> = {};
    for (const s of Object.values(rawShapes)) {
      const p = pageOf(s);
      if (visible.has(p)) allShapes[s.id] = s;
      if (p === activePage) onActive[s.id] = s;
    }
    const normalized =
      !shapesChanged && lastNormalized?.page === activePage
        ? lastNormalized.value
        : normalizeShapes(onActive);
    lastNormalized = { page: activePage, value: normalized };
    const pageConnectors: Record<string, Connector> = {};
    for (const c of Object.values(rawConnectors))
      if (pageOf(c) === activePage) pageConnectors[c.id] = c;
    store.setState({
      ...normalized,
      ...normalizeConnectors(pageConnectors, normalized.shapes),
      pages,
      activePage,
      allShapes,
    });
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
  // A delete may write only a tombstone (e.g. an empty main), so both roots republish.
  const onPages = () => publish(true);

  yShapes.observeDeep(onShapes);
  yConnectors.observeDeep(onConnectors);
  meta.observe(onMeta);
  yPages.observeDeep(onPages);
  yTombstones.observe(onPages);
  rebuildShapes(yShapes.keys());
  rebuildConnectors(yConnectors.keys());
  publish(true);

  return {
    store,
    setPage(id: string) {
      requested = id;
      publish(true);
    },
    destroy() {
      yShapes.unobserveDeep(onShapes);
      yConnectors.unobserveDeep(onConnectors);
      meta.unobserve(onMeta);
      yPages.unobserveDeep(onPages);
      yTombstones.unobserve(onPages);
    },
  };
}
