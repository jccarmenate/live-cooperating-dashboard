import { MAIN_PAGE, MAX_PAGE_TITLE, type PageInfo, type PageType, type Peer } from '@relay/core';
import { Plus } from 'lucide-react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { onPage } from '../render/pageFilter';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { ConfirmDialog } from './Dialog';
import { MEDIA, overflowEdges, useMediaQuery } from './responsive';
import { toast } from './toasts';
import { useLongPress } from './useLongPress';

type Menu = { x: number; y: number; items: MenuItem[] } | null;

/**
 * What the tabs show of presence: who is on which page. The presence store replaces `peers`
 * on every awareness change (a remote cursor moves every 50ms); selecting this string instead
 * re-renders the tabs only when a peer changes page, joins, leaves or changes name or colour.
 */
const peerDotsSignature = (peers: readonly Peer[]): string =>
  JSON.stringify(peers.map((p) => [p.page ?? MAIN_PAGE, p.clientId, p.user.color, p.user.name]));

export function PageTabs({ session }: { session: BoardSession }) {
  const { controller } = session;
  const pages = useStore(session.doc, (d) => d.pages);
  const active = useStore(session.doc, (d) => d.activePage);
  useStore(session.presence, (s) => peerDotsSignature(s.peers));
  const peers = session.presence.getState().peers;
  const canEdit = useStore(session.conn.clock, (c) => c.role === 'edit');
  const touch = useMediaQuery(MEDIA.coarse);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [confirm, setConfirm] = useState<PageInfo | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  // One rename session commits at most once, whichever of Enter, Escape or blur comes first.
  const renameFinished = useRef(false);
  const scroller = useRef<HTMLElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measureEdges = useCallback(() => {
    const el = scroller.current;
    if (!el) return;
    const next = overflowEdges(el.scrollLeft, el.clientWidth, el.scrollWidth);
    setEdges((e) => (e.left === next.left && e.right === next.right ? e : next));
  }, []);
  // After every render (tabs come, go and get renamed) and whenever the row is resized.
  useLayoutEffect(measureEdges);
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const observer = new ResizeObserver(measureEdges);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measureEdges]);
  // The active tab scrolls into view, e.g. after a new page or a link to a page.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the active page changes
  useEffect(() => {
    scroller.current
      ?.querySelector('[role="tab"][aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [active]);

  const closeMenu = useCallback(() => setMenu(null), []);
  // Stable, so the dialog's window Escape listener is not re-attached on every render.
  const closeConfirm = useCallback(() => setConfirm(null), []);

  const add = (type: PageType) => {
    const id = controller.createPage(type);
    controller.setPage(id);
  };

  const startRename = (id: string) => {
    renameFinished.current = false;
    setRenaming(id);
  };

  const longPress = useLongPress();

  /** The tab's menu (right-click or press and hold). Moving works by touch, unlike dragging. */
  const openTabMenu = (page: PageInfo, index: number, at: { x: number; y: number }) => {
    if (!canEdit) return;
    setMenu({
      x: at.x,
      y: at.y,
      items: [
        {
          label: 'Rename',
          testId: 'page-menu-rename',
          onSelect: () => startRename(page.id),
        },
        {
          label: 'Move left',
          testId: 'page-menu-left',
          disabled: index === 0,
          onSelect: () => controller.movePage(page.id, index - 1),
        },
        {
          label: 'Move right',
          testId: 'page-menu-right',
          disabled: index === pages.length - 1,
          onSelect: () => controller.movePage(page.id, index + 1),
        },
        {
          label: 'Delete',
          testId: 'page-menu-delete',
          danger: true,
          disabled: pages.length <= 1,
          onSelect: () => setConfirm(page),
        },
      ],
    });
  };

  /** Ends the rename of `page`, committing `value` unless it is null, empty or unchanged. */
  const finishRename = (page: PageInfo, value: string | null) => {
    if (renameFinished.current) return;
    renameFinished.current = true;
    const text = value?.trim();
    if (text && text !== page.title) controller.renamePage(page.id, text);
    setRenaming(null);
  };

  return (
    <div className="relative shrink-0">
      <nav
        ref={scroller}
        // Unlabelled: the tablist inside carries the "Pages" name, so it is not announced twice.
        className="flex h-9 items-end gap-1 overflow-x-auto border-b-2 border-ink bg-paper px-3"
        onScroll={measureEdges}
      >
        <div
          role="tablist"
          aria-label="Pages"
          data-testid="page-tabs"
          className="flex items-end gap-1"
        >
          {pages.map((p, index) => {
            const here = peers.filter((peer) => onPage(peer, p.id));
            const selected = p.id === active;
            return (
              // biome-ignore lint/a11y/noStaticElementInteractions: a drag-and-drop wrapper; the tab button inside is the accessible control
              <div
                key={p.id}
                role="presentation"
                className="flex"
                // Not on touch screens: a held finger there opens the tab menu (Move left/right).
                draggable={canEdit && !touch && renaming !== p.id}
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', p.id);
                  setDragId(p.id);
                }}
                onDragEnd={() => setDragId(null)}
                onDragOver={(e) => {
                  if (dragId) e.preventDefault();
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragId && dragId !== p.id) controller.movePage(dragId, index);
                  setDragId(null);
                }}
              >
                {renaming === p.id ? (
                  <input
                    // biome-ignore lint/a11y/noAutofocus: renaming starts typing right away
                    autoFocus
                    data-testid="page-rename-input"
                    aria-label="Page name"
                    defaultValue={p.title}
                    maxLength={MAX_PAGE_TITLE}
                    className="h-8 w-32 border-2 border-b-0 border-ink bg-white px-2 font-mono text-xs outline-none"
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      // Enter that confirms an IME composition is not a commit.
                      if (e.nativeEvent.isComposing) return;
                      if (e.key === 'Enter') finishRename(p, e.currentTarget.value);
                      else if (e.key === 'Escape') finishRename(p, null);
                    }}
                    onBlur={(e) => finishRename(p, e.currentTarget.value)}
                  />
                ) : (
                  <button
                    type="button"
                    role="tab"
                    data-testid="page-tab"
                    data-page-id={p.id}
                    aria-selected={selected}
                    title={p.title}
                    className={`flex h-8 max-w-48 scroll-mx-8 items-center gap-1.5 border-2 border-b-0 border-ink px-3 font-mono text-xs ${selected ? 'bg-white font-bold' : 'bg-paper hover:bg-white'}`}
                    onClick={() => controller.setPage(p.id)}
                    onDoubleClick={() => canEdit && startRename(p.id)}
                    onContextMenu={(e) => {
                      e.preventDefault();
                      openTabMenu(p, index, { x: e.clientX, y: e.clientY });
                    }}
                    {...longPress((at) => openTabMenu(p, index, at))}
                  >
                    <span className="truncate">{p.title}</span>
                    {here.slice(0, 3).map((peer) => (
                      <span
                        key={peer.clientId}
                        data-testid="page-peer-dot"
                        title={peer.user.name}
                        className="inline-block size-2 shrink-0 rounded-full border border-ink"
                        style={{ background: peer.user.color }}
                      />
                    ))}
                  </button>
                )}
              </div>
            );
          })}
        </div>
        {canEdit && (
          <button
            type="button"
            data-testid="page-add"
            aria-label="New page"
            className="mb-0.5 grid size-7 place-items-center border-2 border-ink bg-white hover:bg-sun"
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMenu({
                x: r.left,
                y: r.bottom + 4,
                items: [
                  { label: 'Board', testId: 'page-add-board', onSelect: () => add('board') },
                  { label: 'Spreadsheet', testId: 'page-add-sheet', onSelect: () => add('sheet') },
                  {
                    label: 'Calendar',
                    testId: 'page-add-calendar',
                    onSelect: () => add('calendar'),
                  },
                ],
              });
            }}
          >
            <Plus size={14} />
          </button>
        )}
        {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
        {confirm && (
          <ConfirmDialog
            title="Delete page"
            message={`Delete “${confirm.title}” and everything on it for everyone? This cannot be undone.`}
            confirmLabel="Delete"
            onConfirm={() => {
              if (controller.deletePage(confirm.id)) toast('Page deleted');
            }}
            onClose={closeConfirm}
          />
        )}
      </nav>
      {/* Fades on the edges that hide tabs: on a phone they show that the row scrolls. */}
      {edges.left && (
        <span
          aria-hidden
          data-testid="tabs-more-left"
          className="pointer-events-none absolute top-0 bottom-0.5 left-0 w-8 bg-linear-to-r from-paper to-transparent"
        />
      )}
      {edges.right && (
        <span
          aria-hidden
          data-testid="tabs-more-right"
          className="pointer-events-none absolute top-0 bottom-0.5 right-0 w-8 bg-linear-to-l from-paper to-transparent"
        />
      )}
    </div>
  );
}
