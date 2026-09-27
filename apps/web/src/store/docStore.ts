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
 * visible page; the fallback for a deleted page is pinned at once, the one for an
 * unknown page when `pinActive` is called (after the first sync).
 */
export function createDocStore(
  doc: Y.Doc,
  initialPage: string = MAIN_PAGE,
): {
  store: StoreApi<DocState>;
  setPage(id: string): void;
  /**
   * Makes the page now showing the requested one. Call it once the document has synced:
   * an unknown page (a stale link) then stops waiting, and a later reorder or delete of
   * the first page no longer moves the user.
   */
  pinActive(): void;
  destroy(): void;
} {
  const {
    shapes: yShapes,
    connectors: yConnectors,
    meta,
    pages: yPages,
    pageTombstones: yTombstones,
  } = getRoots(doc);
  const rawShapes: Record<string, Shape> = {};
  const rawConnectors: Record<string, Connector> = {};
  // Cached so selectors keep identity across unrelated transactions: `pages` only changes
  // with the pages or tombstones root (page tabs do not re-render on every drag frame);
  // `allShapes` changes with every shapes transaction but survives connector-only
  // transactions and page switches.
  let pages = readPages(yPages, yTombstones);
  let allShapes: Record<string, Shape> = {};

  const store = createStore<DocState>(() => ({
    shapes: {},
    order: [],
    connectors: {},
    connectorOrder: [],
    meta: readMeta(meta),
    pages,
    activePage: initialPage,
    allShapes,
  }));

  let requested = initialPage;
  const resolvePage = () =>
    pages.some((p) => p.id === requested) ? requested : (pages[0]?.id ?? requested);

  let lastNormalized: { page: string; value: Normalized } | null = null;

  /**
   * Recomputes only what changed: `shapes` (the shapes root) and `pages` (the pages or
   * tombstones root). A connector-only transaction or a page switch passes neither, so
   * `pages` and `allShapes` keep their identity; the active page's shapes/order are
   * reused unless the shapes changed or the active page did.
   */
  const publish = (changed: { shapes?: boolean; pages?: boolean }) => {
    if (changed.pages) pages = readPages(yPages, yTombstones);
    const activePage = resolvePage();
    // The requested page was showing and has just been deleted: pin the fallback, or a
    // later reorder or delete of the first page would move the user again. (A requested
    // page that never showed, e.g. one not synced yet, keeps waiting until pinActive.)
    if (changed.pages && store.getState().activePage === requested && activePage !== requested) {
      requested = activePage;
    }
    if (changed.shapes || changed.pages) {
      const visible = new Set(pages.map((p) => p.id));
      allShapes = {};
      for (const s of Object.values(rawShapes)) if (visible.has(pageOf(s))) allShapes[s.id] = s;
    }
    let normalized: Normalized;
    if (!changed.shapes && lastNormalized?.page === activePage) {
      normalized = lastNormalized.value;
    } else {
      const onActive: Record<string, Shape> = {};
      for (const s of Object.values(rawShapes)) if (pageOf(s) === activePage) onActive[s.id] = s;
      normalized = normalizeShapes(onActive);
    }
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
    publish({ shapes: true });
  };
  const onConnectors = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
    rebuildConnectors(touchedIds(events, yConnectors));
    publish({});
  };
  const onMeta = () => store.setState({ meta: readMeta(meta) });
  // A delete may write only a tombstone (e.g. an empty main), so both roots republish.
  const onPages = () => publish({ pages: true });

  yShapes.observeDeep(onShapes);
  yConnectors.observeDeep(onConnectors);
  meta.observe(onMeta);
  yPages.observeDeep(onPages);
  yTombstones.observe(onPages);
  rebuildShapes(yShapes.keys());
  rebuildConnectors(yConnectors.keys());
  publish({ shapes: true });

  return {
    store,
    setPage(id: string) {
      requested = id;
      publish({});
    },
    pinActive() {
      requested = store.getState().activePage;
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
