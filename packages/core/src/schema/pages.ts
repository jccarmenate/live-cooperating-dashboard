import { generateKeyBetween } from 'fractional-indexing';
import * as Y from 'yjs';
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

function readPage(id: string, m: Y.Map<unknown>): PageInfo | null {
  if (m.get('deleted') === true) return null;
  const base = id === MAIN_PAGE ? MAIN_DEFAULTS : null;
  const type = str(m.get('type')) ?? base?.type;
  const createdAt = m.get('createdAt');
  return {
    id,
    type: type && PAGE_TYPES.includes(type) ? (type as PageType) : 'unknown',
    title: str(m.get('title')) ?? base?.title ?? 'Untitled',
    order: str(m.get('order')) ?? base?.order ?? 'a0',
    createdBy: str(m.get('createdBy')) ?? '',
    createdAt: typeof createdAt === 'number' && Number.isFinite(createdAt) ? createdAt : 0,
  };
}

/** Visible pages: live entries plus the implicit main page when it has no entry, by order then id. */
export function readPages(pages: Y.Map<Y.Map<unknown>>): PageInfo[] {
  const out: PageInfo[] = [];
  for (const [id, m] of pages.entries()) {
    if (!(m instanceof Y.Map)) continue;
    const page = readPage(id, m);
    if (page) out.push(page);
  }
  if (!pages.has(MAIN_PAGE)) out.push({ id: MAIN_PAGE, ...MAIN_DEFAULTS });
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
