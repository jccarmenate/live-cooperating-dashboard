import { runAlgorithm } from '@relay/core';
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { createBoardController } from '../src/board/controller';
import { createActivityStore } from '../src/store/activityStore';
import { createDocStore } from '../src/store/docStore';

// A module mock applies to the whole file, so these tests live apart from graph-controller.
vi.mock('@relay/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@relay/core')>()),
  runAlgorithm: vi.fn(),
}));

function setup() {
  const doc = new Y.Doc();
  const docs = createDocStore(doc);
  const activity = createActivityStore(doc);
  return createBoardController({
    doc,
    docStore: docs.store,
    setPage: docs.setPage,
    activity: activity.store,
    user: { id: 'u1', name: 'Brisk Otter', color: '#E85A1B' },
  });
}

describe('an algorithm that throws', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('a RangeError (stack overflow) becomes "too large"', () => {
    vi.mocked(runAlgorithm).mockImplementation(() => {
      throw new RangeError('Maximum call stack size exceeded');
    });
    const controller = setup();
    const r = controller.runAlgorithm('dfs', 'a');
    expect(r).toEqual({ kind: 'error', message: 'The graph is too large for this algorithm' });
    expect(controller.ui.getState().graphResult).toEqual(r);
  });

  it('any other error becomes "Could not run the algorithm" and is logged', () => {
    const boom = new Error('boom');
    vi.mocked(runAlgorithm).mockImplementation(() => {
      throw boom;
    });
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    const controller = setup();
    const r = controller.runAlgorithm('bfs', 'a');
    expect(r).toEqual({ kind: 'error', message: 'Could not run the algorithm' });
    expect(controller.ui.getState().graphResult).toEqual(r);
    expect(log).toHaveBeenCalledWith(boom);
  });
});
