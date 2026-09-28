import { type Connector, DEFAULT_STYLE, type Shape } from '@relay/core';
import { describe, expect, it, vi } from 'vitest';
import type { MenuEntry } from '../src/ui/ContextMenu';
import {
  type CanvasMenuActions,
  type CanvasMenuContext,
  canvasMenu,
} from '../src/ui/canvasMenuItems';

const shape = (id: string, extra: Partial<Shape> = {}): Shape => ({
  id,
  type: 'sticky',
  x: 0,
  y: 0,
  w: 100,
  h: 100,
  z: 'a0',
  style: DEFAULT_STYLE.sticky,
  createdBy: 'u1',
  authorName: 'A',
  createdAt: 0,
  ...extra,
});
const connector: Connector = {
  id: 'k1',
  from: { x: 0, y: 0 },
  to: { x: 9, y: 9 },
  routing: 'elbow',
  head: 'arrow',
  z: 'a0',
  createdBy: 'u1',
};

function actions(): CanvasMenuActions {
  const names = [
    'copy',
    'cut',
    'paste',
    'duplicate',
    'remove',
    'setZ',
    'fill',
    'toggleLock',
    'comment',
    'vote',
    'routing',
    'head',
    'create',
    'selectAll',
    'zoomToFit',
  ] as const;
  return Object.fromEntries(names.map((n) => [n, vi.fn()])) as unknown as CanvasMenuActions;
}
function ctx(extra: Partial<CanvasMenuContext> = {}): CanvasMenuContext {
  return {
    canEdit: true,
    selection: [],
    shapes: { s1: shape('s1'), s2: shape('s2', { locked: true }) },
    connectors: { k1: connector },
    world: { x: 10, y: 20 },
    hitId: null,
    voteOpen: false,
    voted: false,
    ...extra,
  };
}
const ids = (entries: MenuEntry[]) =>
  entries.flatMap((e) => ('label' in e ? [e.testId] : 'swatches' in e ? ['swatches'] : []));

describe('canvasMenu', () => {
  it('empty canvas: paste here, new items, select all, fit', () => {
    const a = actions();
    const items = canvasMenu(ctx(), a);
    expect(ids(items)).toEqual([
      'menu-paste-here',
      'menu-new-sticky',
      'menu-new-rect',
      'menu-new-frame',
      'menu-select-all',
      'menu-fit',
    ]);
    const pasteHere = items[0];
    if (pasteHere && 'label' in pasteHere) pasteHere.onSelect();
    expect(a.paste).toHaveBeenCalledWith({ x: 10, y: 20 });
  });

  it('selection: edit, order, fill, lock and comment', () => {
    expect(ids(canvasMenu(ctx({ selection: ['s1'], hitId: 's1' }), actions()))).toEqual([
      'menu-cut',
      'menu-copy',
      'menu-paste',
      'menu-duplicate',
      'menu-delete',
      'menu-front',
      'menu-back',
      'swatches',
      'menu-lock',
      'menu-comment',
    ]);
  });

  it('an all-locked selection offers Unlock and disables cut, delete and fill', () => {
    const items = canvasMenu(ctx({ selection: ['s2'], hitId: 's2' }), actions());
    const byId = (id: string) => items.find((e) => 'label' in e && e.testId === id);
    expect(byId('menu-lock')).toMatchObject({ label: 'Unlock' });
    expect(byId('menu-cut')).toMatchObject({ disabled: true });
    expect(byId('menu-delete')).toMatchObject({ disabled: true });
    expect(items.find((e) => 'swatches' in e)).toMatchObject({ disabled: true });
  });

  it('connectors add routing and arrow toggles', () => {
    const a = actions();
    const items = canvasMenu(ctx({ selection: ['k1'] }), a);
    const routing = items.find((e) => 'label' in e && e.testId === 'menu-routing');
    expect(routing).toMatchObject({ label: 'Straight' });
    if (routing && 'label' in routing) routing.onSelect();
    expect(a.routing).toHaveBeenCalledWith('straight');
    expect(items.find((e) => 'label' in e && e.testId === 'menu-head')).toMatchObject({
      label: 'Arrow off',
    });
  });

  it('a sticky under the pointer during an open vote can be voted on', () => {
    const items = canvasMenu(ctx({ selection: ['s1'], hitId: 's1', voteOpen: true }), actions());
    expect(items.find((e) => 'label' in e && e.testId === 'menu-vote')).toMatchObject({
      label: 'Vote',
    });
    const voted = canvasMenu(
      ctx({ selection: ['s1'], hitId: 's1', voteOpen: true, voted: true }),
      actions(),
    );
    expect(voted.find((e) => 'label' in e && e.testId === 'menu-vote')).toMatchObject({
      label: 'Remove vote',
    });
  });

  it('viewers get only Copy (with a selection) and Zoom to fit', () => {
    expect(ids(canvasMenu(ctx({ canEdit: false, selection: ['s1'] }), actions()))).toEqual([
      'menu-copy',
      'menu-fit',
    ]);
    expect(ids(canvasMenu(ctx({ canEdit: false }), actions()))).toEqual(['menu-fit']);
  });
});
