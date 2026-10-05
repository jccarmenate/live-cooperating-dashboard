import type { Connector, Point, Routing, Shape } from '@relay/core';
import type { MenuEntry } from './ContextMenu';
import { FILL_SWATCHES } from './swatches';

export interface CanvasMenuContext {
  canEdit: boolean;
  /** Deleting is allowed (true for an editor even on a full board). */
  canDelete: boolean;
  /** The selection after the right-click (it already contains the clicked item). */
  selection: string[];
  shapes: Readonly<Record<string, Shape>>;
  connectors: Readonly<Record<string, Connector>>;
  /** The world point that was right-clicked, and the shape under it. */
  world: Point;
  hitId: string | null;
  voteOpen: boolean;
  /** The local user has voted on the shape under the pointer. */
  voted: boolean;
}

export interface CanvasMenuActions {
  copy(): void;
  cut(): void;
  paste(at?: Point): void;
  duplicate(): void;
  remove(): void;
  setZ(where: 'front' | 'back'): void;
  fill(color: string): void;
  toggleLock(): void;
  comment(p: Point, hitId: string | null): void;
  vote(shapeId: string): void;
  routing(r: Routing): void;
  head(h: 'arrow' | 'none'): void;
  create(type: 'sticky' | 'rect' | 'frame', at: Point): void;
  selectAll(): void;
  zoomToFit(): void;
  /** Opens the "Add to calendar" dialog for a sticky. */
  addToCalendar(shapeId: string): void;
}

const SEP: MenuEntry = { separator: true };

/**
 * The right-click menu for the canvas: one for a selection, one for empty canvas, a short one for
 * viewers (which also offers Delete on a full board).
 */
export function canvasMenu(ctx: CanvasMenuContext, a: CanvasMenuActions): MenuEntry[] {
  const shapes = ctx.selection.flatMap((id) => {
    const s = ctx.shapes[id];
    return s ? [s] : [];
  });
  const connectors = ctx.selection.flatMap((id) => {
    const c = ctx.connectors[id];
    return c ? [c] : [];
  });
  const empty = shapes.length === 0 && connectors.length === 0;
  const fit: MenuEntry = {
    label: 'Zoom to fit',
    hint: 'Shift 1',
    onSelect: a.zoomToFit,
    testId: 'menu-fit',
  };
  const copy: MenuEntry = { label: 'Copy', hint: 'Ctrl C', onSelect: a.copy, testId: 'menu-copy' };

  if (!ctx.canEdit) {
    if (empty) return [fit];
    if (!ctx.canDelete) return [copy, fit];
    // A full board: nothing can be created or changed, but the selection can go.
    const removable = shapes.some((s) => !s.locked) || connectors.length > 0;
    return [
      copy,
      {
        label: 'Delete',
        hint: 'Del',
        onSelect: a.remove,
        disabled: !removable,
        danger: true,
        testId: 'menu-delete',
      },
      fit,
    ];
  }

  if (empty) {
    return [
      {
        label: 'Paste here',
        hint: 'Ctrl V',
        onSelect: () => a.paste(ctx.world),
        testId: 'menu-paste-here',
      },
      SEP,
      {
        label: 'New sticky here',
        onSelect: () => a.create('sticky', ctx.world),
        testId: 'menu-new-sticky',
      },
      {
        label: 'New rectangle here',
        onSelect: () => a.create('rect', ctx.world),
        testId: 'menu-new-rect',
      },
      {
        label: 'New frame here',
        onSelect: () => a.create('frame', ctx.world),
        testId: 'menu-new-frame',
      },
      SEP,
      { label: 'Select all', hint: 'Ctrl A', onSelect: a.selectAll, testId: 'menu-select-all' },
      fit,
    ];
  }

  const unlocked = shapes.filter((s) => !s.locked);
  const allLocked = shapes.length > 0 && unlocked.length === 0;
  const editable = unlocked.length > 0 || connectors.length > 0;
  const items: MenuEntry[] = [
    { label: 'Cut', hint: 'Ctrl X', onSelect: a.cut, disabled: !editable, testId: 'menu-cut' },
    copy,
    { label: 'Paste', hint: 'Ctrl V', onSelect: () => a.paste(), testId: 'menu-paste' },
    { label: 'Duplicate', hint: 'Ctrl D', onSelect: a.duplicate, testId: 'menu-duplicate' },
    {
      label: 'Delete',
      hint: 'Del',
      onSelect: a.remove,
      disabled: !editable,
      danger: true,
      testId: 'menu-delete',
    },
    SEP,
    { label: 'Bring to front', hint: ']', onSelect: () => a.setZ('front'), testId: 'menu-front' },
    { label: 'Send to back', hint: '[', onSelect: () => a.setZ('back'), testId: 'menu-back' },
  ];
  if (shapes.length > 0) {
    items.push(
      {
        swatches: FILL_SWATCHES.map((s) => ({
          color: s.color,
          label: `Fill ${s.label.toLowerCase()}`,
          onSelect: () => a.fill(s.color),
          testId: `menu-fill-${s.name}`,
        })),
        disabled: allLocked,
      },
      { label: allLocked ? 'Unlock' : 'Lock', onSelect: a.toggleLock, testId: 'menu-lock' },
    );
  }
  if (connectors.length > 0) {
    const allElbow = connectors.every((c) => c.routing === 'elbow');
    const allArrow = connectors.every((c) => c.head === 'arrow');
    items.push(
      SEP,
      {
        label: allElbow ? 'Straight' : 'Elbow',
        hint: 'E',
        onSelect: () => a.routing(allElbow ? 'straight' : 'elbow'),
        testId: 'menu-routing',
      },
      {
        label: allArrow ? 'Arrow off' : 'Arrow on',
        onSelect: () => a.head(allArrow ? 'none' : 'arrow'),
        testId: 'menu-head',
      },
    );
  }
  items.push(SEP, {
    label: 'Comment here',
    onSelect: () => a.comment(ctx.world, ctx.hitId),
    testId: 'menu-comment',
  });
  if (shapes.length === 1 && connectors.length === 0 && shapes[0]?.type === 'sticky') {
    items.push({
      label: 'Add to calendar…',
      onSelect: () => a.addToCalendar(shapes[0]?.id as string),
      testId: 'menu-add-calendar',
    });
  }
  const hit = ctx.hitId ? ctx.shapes[ctx.hitId] : undefined;
  if (ctx.voteOpen && hit?.type === 'sticky') {
    items.push({
      label: ctx.voted ? 'Remove vote' : 'Vote',
      onSelect: () => a.vote(hit.id),
      testId: 'menu-vote',
    });
  }
  return items;
}
