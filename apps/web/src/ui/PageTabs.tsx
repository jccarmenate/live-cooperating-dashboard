import type { PageInfo, PageType } from '@relay/core';
import { Plus } from 'lucide-react';
import { useState } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { onPage } from '../render/pageFilter';
import { ContextMenu, type MenuItem } from './ContextMenu';
import { ConfirmDialog } from './Dialog';
import { toast } from './toasts';

type Menu = { x: number; y: number; items: MenuItem[] } | null;

export function PageTabs({ session }: { session: BoardSession }) {
  const { controller } = session;
  const pages = useStore(session.doc, (d) => d.pages);
  const active = useStore(session.doc, (d) => d.activePage);
  const peers = useStore(session.presence, (s) => s.peers);
  const canEdit = useStore(session.conn.clock, (c) => c.role === 'edit');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [menu, setMenu] = useState<Menu>(null);
  const [confirm, setConfirm] = useState<PageInfo | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);

  const add = (type: PageType) => {
    const id = controller.createPage(type);
    controller.setPage(id);
  };

  return (
    <nav
      aria-label="Pages"
      data-testid="page-tabs"
      className="flex h-9 shrink-0 items-end gap-1 overflow-x-auto border-b-2 border-ink bg-paper px-3"
    >
      {pages.map((p, index) => {
        const here = peers.filter((peer) => onPage(peer, p.id));
        const selected = p.id === active;
        return (
          // biome-ignore lint/a11y/noStaticElementInteractions: a drag-and-drop wrapper; the tab button inside is the accessible control
          <div
            key={p.id}
            className="flex"
            draggable={canEdit && renaming !== p.id}
            onDragStart={() => setDragId(p.id)}
            onDragOver={(e) => {
              if (dragId) e.preventDefault();
            }}
            onDrop={() => {
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
                className="h-8 w-32 border-2 border-b-0 border-ink bg-white px-2 font-mono text-xs outline-none"
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === 'Enter') {
                    controller.renamePage(p.id, e.currentTarget.value);
                    setRenaming(null);
                  } else if (e.key === 'Escape') {
                    setRenaming(null);
                  }
                }}
                onBlur={(e) => {
                  controller.renamePage(p.id, e.currentTarget.value);
                  setRenaming(null);
                }}
              />
            ) : (
              <button
                type="button"
                role="tab"
                data-testid="page-tab"
                data-page-id={p.id}
                aria-selected={selected}
                title={p.title}
                className={`flex h-8 max-w-48 items-center gap-1.5 border-2 border-b-0 border-ink px-3 font-mono text-xs ${selected ? 'bg-white font-bold' : 'bg-paper hover:bg-white'}`}
                onClick={() => controller.setPage(p.id)}
                onDoubleClick={() => canEdit && setRenaming(p.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  if (!canEdit) return;
                  setMenu({
                    x: e.clientX,
                    y: e.clientY,
                    items: [
                      {
                        label: 'Rename',
                        testId: 'page-menu-rename',
                        onSelect: () => setRenaming(p.id),
                      },
                      {
                        label: 'Delete',
                        testId: 'page-menu-delete',
                        danger: true,
                        disabled: pages.length <= 1,
                        onSelect: () => setConfirm(p),
                      },
                    ],
                  });
                }}
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
                {
                  label: 'Spreadsheet (soon)',
                  testId: 'page-add-sheet',
                  disabled: true,
                  onSelect: () => {},
                },
                {
                  label: 'Calendar (soon)',
                  testId: 'page-add-calendar',
                  disabled: true,
                  onSelect: () => {},
                },
              ],
            });
          }}
        >
          <Plus size={14} />
        </button>
      )}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={() => setMenu(null)} />
      )}
      {confirm && (
        <ConfirmDialog
          title="Delete page"
          message={`Delete “${confirm.title}” and everything on it for everyone? This cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={() => {
            controller.deletePage(confirm.id);
            toast('Page deleted');
          }}
          onClose={() => setConfirm(null)}
        />
      )}
    </nav>
  );
}
