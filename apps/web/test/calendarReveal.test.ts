import { applyCommand } from '@relay/core';
import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createBoardController } from '../src/board/controller';
import { openOnBoard } from '../src/calendar/openOnBoard';
import { createActivityStore } from '../src/store/activityStore';
import { createDocStore } from '../src/store/docStore';

function setup() {
  const doc = new Y.Doc();
  const docs = createDocStore(doc);
  const activity = createActivityStore(doc);
  const board = createBoardController({
    doc,
    docStore: docs.store,
    setPage: docs.setPage,
    activity: activity.store,
    user: { id: 'u1', name: 'Brisk Otter', color: '#E85A1B' },
  });
  return { doc, docs, board };
}

describe('revealShape', () => {
  it('switches to the page, selects the shape and centres it once the viewport is known', () => {
    const { doc, docs, board } = setup();
    applyCommand(doc, {
      type: 'CreateShape',
      shape: {
        id: 's1',
        type: 'sticky',
        x: 1000,
        y: 2000,
        w: 180,
        h: 140,
        style: { fill: '#F5D547', stroke: '#111111', font: 'sans' },
        createdBy: 'u1',
        authorName: 'B',
        createdAt: 0,
      },
    });
    const cal = board.createPage('calendar');
    board.setPage(cal);
    expect(board.revealShape('main', 's1')).toBe(true);
    expect(docs.store.getState().activePage).toBe('main');
    expect(board.ui.getState().tool.selection).toEqual(['s1']);
    board.setViewportSize(800, 600);
    const { camera } = board.ui.getState();
    // The sticky's centre (1090, 2070) is at the viewport centre (400, 300).
    expect((1090 + camera.x) * camera.zoom).toBeCloseTo(400);
    expect((2070 + camera.y) * camera.zoom).toBeCloseTo(300);
  });

  it('refuses a missing shape or page', () => {
    const { board } = setup();
    expect(board.revealShape('main', 'ghost')).toBe(false);
    expect(board.revealShape('nope', 'ghost')).toBe(false);
  });

  it('does nothing when the shape is missing or on another page', () => {
    const { doc, docs, board } = setup();
    applyCommand(doc, {
      type: 'CreateShape',
      shape: {
        id: 's1',
        type: 'sticky',
        x: 0,
        y: 0,
        w: 180,
        h: 140,
        style: { fill: '#F5D547', stroke: '#111111', font: 'sans' },
        createdBy: 'u1',
        authorName: 'B',
        createdAt: 0,
      },
    });
    const cal = board.createPage('calendar');
    board.setPage(cal);
    expect(board.revealShape('main', 'ghost')).toBe(false);
    expect(board.revealShape(cal, 's1')).toBe(false);
    expect(docs.store.getState().activePage).toBe(cal);
  });

  it('centres at once when the viewport is known, and a later page change drops a pending centre', () => {
    const { doc, docs, board } = setup();
    applyCommand(doc, {
      type: 'CreateShape',
      shape: {
        id: 's1',
        type: 'sticky',
        x: 1000,
        y: 2000,
        w: 180,
        h: 140,
        style: { fill: '#F5D547', stroke: '#111111', font: 'sans' },
        createdBy: 'u1',
        authorName: 'B',
        createdAt: 0,
      },
    });
    const cal = board.createPage('calendar');
    board.setPage(cal);
    // Pending, then the user goes elsewhere before the canvas is measured.
    expect(board.revealShape('main', 's1')).toBe(true);
    board.setPage(cal);
    board.setPage('main');
    board.setViewportSize(800, 600);
    expect(board.ui.getState().camera).toEqual({ x: 0, y: 0, zoom: 1 });
    // Measured: centres immediately.
    board.setPage(cal);
    expect(board.revealShape('main', 's1')).toBe(true);
    expect(docs.store.getState().activePage).toBe('main');
    const { camera } = board.ui.getState();
    expect((1090 + camera.x) * camera.zoom).toBeCloseTo(400);
    expect((2070 + camera.y) * camera.zoom).toBeCloseTo(300);
  });
});

describe('Open on board', () => {
  it('closes the editor and says so when the sticky has gone', () => {
    const { docs, board } = setup();
    const cal = board.createPage('calendar');
    board.setPage(cal);
    const closeEditor = vi.fn();
    const notify = vi.fn();
    openOnBoard({ closeEditor }, board, { pageId: 'main', shapeId: 'ghost' }, notify);
    expect(closeEditor).toHaveBeenCalled();
    expect(notify).toHaveBeenCalledWith('Sticky deleted');
    expect(docs.store.getState().activePage).toBe(cal);
  });
});
