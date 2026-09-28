import { type Point, parseClip, voteKey } from '@relay/core';
import { useCallback } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { useVoteOpen } from '../render/voting';
import { ContextMenu } from './ContextMenu';
import { canvasMenu } from './canvasMenuItems';
import { readClip, writeClip } from './clipboard';
import { toast } from './toasts';

export function CanvasMenu({ session }: { session: BoardSession }) {
  const { controller } = session;
  const menu = useStore(controller.ui, (s) => s.menu);
  const selection = useStore(controller.ui, (s) => s.tool.selection);
  const shapes = useStore(session.doc, (d) => d.shapes);
  const connectors = useStore(session.doc, (d) => d.connectors);
  const canEdit = useStore(session.conn.clock, (c) => c.role === 'edit');
  const voteKeys = useStore(session.activity, (a) => a.voteKeys);
  const voteOpen = useVoteOpen(session);
  const close = useCallback(() => controller.closeMenu(), [controller]);
  if (!menu) return null;

  const paste = async (at?: Point) => {
    const text = await readClip(controller.lastCopied());
    if (text !== null && controller.pasteText(text, at)) return;
    // A valid clip that was refused has already said why (too much to paste at once).
    if (text === null || parseClip(text) === null) toast('Nothing to paste — try Ctrl+V');
  };
  const items = canvasMenu(
    {
      canEdit,
      selection,
      shapes,
      connectors,
      world: menu.world,
      hitId: menu.hitId,
      voteOpen,
      voted: menu.hitId !== null && voteKeys.includes(voteKey(menu.hitId, session.user.id)),
    },
    {
      copy: () => {
        const text = controller.copySelection();
        if (text) void writeClip(text);
      },
      cut: () => {
        const text = controller.cutSelection();
        if (text) void writeClip(text);
      },
      paste: (at) => void paste(at),
      duplicate: () => controller.duplicate(),
      remove: () => controller.dispatch({ type: 'deleteSelection' }),
      setZ: (where) => controller.setZ(where),
      fill: (color) => controller.setStyle({ fill: color }),
      toggleLock: () => controller.toggleLock(),
      comment: (p, hitId) => controller.commentAt(p, hitId),
      vote: (id) => controller.toggleVote(id),
      routing: (r) => controller.setRouting(r),
      head: (h) => controller.setHead(h),
      create: (type, at) => controller.createAt(type, at),
      selectAll: () => controller.selectAll(),
      zoomToFit: () => controller.zoomToFit(),
    },
  );
  return <ContextMenu x={menu.screen.x} y={menu.screen.y} items={items} onClose={close} />;
}
