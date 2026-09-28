import {
  type CellValue,
  evaluateSheet,
  getRoots,
  readSheet,
  type SheetSnapshot,
} from '@relay/core';
import type * as Y from 'yjs';
import { createStore, type StoreApi } from 'zustand/vanilla';
import { type DocState, touchedIds } from './docStore';

export interface SheetState {
  /** The active page when it is a sheet page, else null. */
  pageId: string | null;
  sheet: SheetSnapshot | null;
  /** Computed values of the sheet's non-empty cells. */
  values: Map<string, CellValue>;
}

/** Projects the active sheet page (if any) and evaluates its formulas after every change to it. */
export function createSheetStore(
  doc: Y.Doc,
  docStore: StoreApi<DocState>,
): { store: StoreApi<SheetState>; destroy(): void } {
  const { sheets } = getRoots(doc);
  const store = createStore<SheetState>(() => ({ pageId: null, sheet: null, values: new Map() }));

  const refresh = () => {
    const { activePage, pages } = docStore.getState();
    const isSheet = pages.find((p) => p.id === activePage)?.type === 'sheet';
    const sheet = isSheet ? readSheet(sheets.get(activePage)) : null;
    store.setState({
      pageId: isSheet ? activePage : null,
      sheet,
      values: sheet ? evaluateSheet(sheet) : new Map(),
    });
  };

  const onSheets = (events: Y.YEvent<Y.AbstractType<unknown>>[]) => {
    const active = docStore.getState().activePage;
    if (touchedIds(events, sheets).has(active)) refresh();
  };
  const unsubscribe = docStore.subscribe((s, prev) => {
    if (s.activePage !== prev.activePage || s.pages !== prev.pages) refresh();
  });
  sheets.observeDeep(onSheets);
  refresh();

  return {
    store,
    destroy() {
      unsubscribe();
      sheets.unobserveDeep(onSheets);
    },
  };
}
