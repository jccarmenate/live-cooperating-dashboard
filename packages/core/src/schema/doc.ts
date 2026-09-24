import type * as Y from 'yjs';
import { SCHEMA_VERSION } from './types';

export type YShape = Y.Map<unknown>;

export interface Roots {
  meta: Y.Map<unknown>;
  shapes: Y.Map<YShape>;
  connectors: Y.Map<Y.Map<unknown>>;
}

export function getRoots(doc: Y.Doc): Roots {
  return {
    meta: doc.getMap<unknown>('meta'),
    shapes: doc.getMap<YShape>('shapes'),
    connectors: doc.getMap<Y.Map<unknown>>('connectors'),
  };
}

/** Initializes board metadata once. Returns false if already initialized. */
export function initMeta(doc: Y.Doc, init: { title: string; breadcrumb: string[] }): boolean {
  const { meta } = getRoots(doc);
  if (meta.has('schemaVersion')) return false;
  doc.transact(() => {
    meta.set('schemaVersion', SCHEMA_VERSION);
    meta.set('title', init.title);
    meta.set('breadcrumb', init.breadcrumb);
  });
  return true;
}
