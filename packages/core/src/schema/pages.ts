import { generateKeyBetween } from 'fractional-indexing';
import * as Y from 'yjs';
import { MAX_PAGE_TITLE } from './defaults';
import type { PageInfo, PageType } from './types';

/** The page that holds everything created before pages existed. */
export const MAIN_PAGE = 'main';

const PAGE_TYPES: readonly string[] = ['board', 'sheet', 'calendar'];

export const MAIN_DEFAULTS: Omit<PageInfo, 'id'> = {
  type: 'board',
  title: 'Board',
  order: 'a0',
  createdBy: '',
  createdAt: 0,
};

const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** The page an item lives on (absent pageId = main). */
export const pageOf = (x: { pageId?: string }): string => x.pageId ?? MAIN_PAGE;

/** Longest page id an item may name; a longer one reads as main. */
const MAX_PAGE_ID = 64;

/** The page a stored `pageId` value names: a non-empty string of at most 64 chars, else main. */
export const pageIdOf = (v: unknown): string =>
  typeof v === 'string' && v.length > 0 && v.length <= MAX_PAGE_ID ? v : MAIN_PAGE;

function readPage(id: string, m: Y.Map<unknown>): PageInfo {
  const base = id === MAIN_PAGE ? MAIN_DEFAULTS : null;
  const type = str(m.get('type')) ?? base?.type;
  const createdAt = m.get('createdAt');
  return {
    id,
    type: type && PAGE_TYPES.includes(type) ? (type as PageType) : 'unknown',
    title: (str(m.get('title')) ?? base?.title ?? 'Untitled').slice(0, MAX_PAGE_TITLE),
    order: str(m.get('order')) ?? base?.order ?? 'a0',
    createdBy: str(m.get('createdBy')) ?? '',
    createdAt: typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : 0,
  };
}

/**
 * Visible pages, by order then id: the entries whose id is not tombstoned, plus the
 * implicit main page when it has no entry and is not tombstoned. An entry that is not a map
 * (a misbehaving client) counts as absent.
 */
export function readPages(pages: Y.Map<Y.Map<unknown>>, tombstones: Y.Map<boolean>): PageInfo[] {
  const out: PageInfo[] = [];
  for (const [id, m] of pages.entries()) {
    if (m instanceof Y.Map && !tombstones.has(id)) out.push(readPage(id, m));
  }
  if (!(pages.get(MAIN_PAGE) instanceof Y.Map) && !tombstones.has(MAIN_PAGE)) {
    out.push({ id: MAIN_PAGE, ...MAIN_DEFAULTS });
  }
  return out.sort((a, b) =>
    a.order !== b.order ? (a.order < b.order ? -1 : 1) : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
}

/** A fractional key strictly between two neighbours (null = open end); tolerant of malformed keys. */
export function orderBetween(before: string | null, after: string | null): string {
  try {
    return generateKeyBetween(before, after);
  } catch {
    try {
      return generateKeyBetween(before, null);
    } catch {
      return generateKeyBetween(null, null);
    }
  }
}
