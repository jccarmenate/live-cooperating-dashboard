declare const process: { env: Record<string, string | undefined> };

import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import {
  allowedFor,
  allowedWhenFull,
  applyCommand,
  type Command,
  DEFAULT_STYLE,
  type EventFields,
  getRoots,
  LOCAL_ORIGIN,
  type NewShape,
  SESSION_ORIGIN,
} from '../src';

const RUNS = Number(process.env.RELAY_FC_RUNS ?? 150);
const SHAPES = ['s0', 's1', 's2', 's3', 's4'];
const ROWS = ['r0', 'r1', 'r2'];
const COLS = ['c0', 'c1'];
const EVENTS = ['e0', 'e1'];

/** A board with shapes, connectors, a sheet with formatted cells and a calendar with events. */
function fixture(): Y.Doc {
  const doc = new Y.Doc();
  const run = (c: Command, origin = LOCAL_ORIGIN) => applyCommand(doc, c, origin);
  for (const id of SHAPES) {
    run({
      type: 'CreateShape',
      shape: {
        id,
        type: 'sticky',
        x: 0,
        y: 0,
        w: 180,
        h: 140,
        style: DEFAULT_STYLE.sticky,
        text: `note ${id}`,
        createdBy: 'u',
        authorName: 'U',
        createdAt: 0,
      },
    });
  }
  run({
    type: 'Connect',
    connector: {
      id: 'k0',
      from: { shapeId: 's0', anchor: 'auto' },
      to: { shapeId: 's1', anchor: 'auto' },
      routing: 'elbow',
      head: 'arrow',
      createdBy: 'u',
    },
  });
  run({
    type: 'Connect',
    connector: {
      id: 'k1',
      from: { x: 0, y: 0 },
      to: { shapeId: 's2', anchor: 'auto' },
      routing: 'straight',
      head: 'none',
      createdBy: 'u',
    },
  });
  run(
    {
      type: 'CreatePage',
      page: { id: 'sheet', type: 'sheet', title: 'S', order: 'a1', createdBy: 'u', createdAt: 0 },
      sheet: {
        rows: ['a0', 'a1', 'a2'].map((order, i) => ({ id: ROWS[i] as string, order })),
        cols: ['a0', 'a1'].map((order, i) => ({ id: COLS[i] as string, order })),
      },
    },
    SESSION_ORIGIN,
  );
  run({
    type: 'SetCells',
    pageId: 'sheet',
    cells: ROWS.flatMap((row) =>
      COLS.map((col) => ({ row, col, src: `${row}${col}`, fmt: { bold: true as const } })),
    ),
  });
  run(
    {
      type: 'CreatePage',
      page: { id: 'cal', type: 'calendar', title: 'C', order: 'a2', createdBy: 'u', createdAt: 0 },
    },
    SESSION_ORIGIN,
  );
  for (const id of EVENTS) {
    run({
      type: 'CreateEvent',
      pageId: 'cal',
      id,
      fields: {
        title: `event ${id}`,
        color: '#E85A1B',
        when: { allDay: true, start: '2026-10-05', end: '2026-10-05' },
        createdBy: 'u',
        createdAt: 0,
      },
    });
  }
  return doc;
}

/** The Yjs updates a command produces. */
function updatesOf(doc: Y.Doc, command: Command): Uint8Array[] {
  const updates: Uint8Array[] = [];
  const onUpdate = (u: Uint8Array) => updates.push(u);
  doc.on('update', onUpdate);
  applyCommand(doc, command, LOCAL_ORIGIN);
  doc.off('update', onUpdate);
  return updates;
}

/** A server that holds what `doc` holds now, and is handed every update after it. */
function mirrorOf(doc: Y.Doc): Y.Doc {
  const server = new Y.Doc();
  Y.applyUpdate(server, Y.encodeStateAsUpdate(doc));
  return server;
}

/**
 * Whether a full board's server would refuse `update` for splitting: a delete range that starts
 * or ends inside a struct of `server` that is not yet deleted (Yjs would cut it in two, and the
 * document would grow). The sync server's `isPureDeletion` checks the same thing.
 */
function splitsLiveStruct(update: Uint8Array, server: Y.Doc): boolean {
  for (const [client, ranges] of Y.decodeUpdate(update).ds.clients) {
    const held = server.store.clients.get(client) ?? [];
    for (const { clock, len } of ranges) {
      const first = held[Y.findIndexSS(held, clock)];
      const last = held[Y.findIndexSS(held, clock + len - 1)];
      if (first && !first.deleted && first.id.clock < clock) return true;
      if (last && !last.deleted && last.id.clock + last.length > clock + len) return true;
    }
  }
  return false;
}

const some = <T>(items: readonly T[]) => fc.subarray([...items], { minLength: 1 });
const allowedArb: fc.Arbitrary<Command> = fc.oneof(
  some([...SHAPES, 'k0', 'k1']).map((ids): Command => ({ type: 'DeleteShapes', ids })),
  some(ROWS).map((ids): Command => ({ type: 'DeleteRows', pageId: 'sheet', ids })),
  some(COLS).map((ids): Command => ({ type: 'DeleteCols', pageId: 'sheet', ids })),
  fc.constantFrom(...EVENTS).map((id): Command => ({ type: 'DeleteEvent', pageId: 'cal', id })),
  some(ROWS.flatMap((row) => COLS.map((col) => ({ row, col, src: '' })))).map(
    (cells): Command => ({ type: 'SetCells', pageId: 'sheet', cells }),
  ),
);

const sticky = (id: string): NewShape => ({
  id,
  type: 'sticky',
  x: 0,
  y: 0,
  w: 180,
  h: 140,
  style: DEFAULT_STYLE.sticky,
  text: `note ${id}`,
  createdBy: 'u',
  authorName: 'U',
  createdAt: 0,
});
const eventFields = (title: string): EventFields => ({
  title,
  color: '#E85A1B',
  when: { allDay: true, start: '2026-10-05', end: '2026-10-06' },
  createdBy: 'u',
  createdAt: 0,
});
const entry = (id: string) => ({ id, authorId: 'u', author: 'U', body: 'hi', ts: 0 });

/** Every command type, so the generator below cannot miss one when the union grows. */
const COMMAND_TYPES: Record<Command['type'], true> = {
  CreateShape: true,
  MoveShapes: true,
  ResizeShapes: true,
  SetText: true,
  DeleteShapes: true,
  Connect: true,
  SetRouting: true,
  SetConnectorLabel: true,
  Reparent: true,
  RenameColumn: true,
  StartVote: true,
  EndVote: true,
  CastVote: true,
  RetractVote: true,
  AddComment: true,
  ReplyComment: true,
  ResolveComment: true,
  CreatePage: true,
  RenamePage: true,
  MovePage: true,
  DeletePage: true,
  RenameBoard: true,
  SetZ: true,
  SetStyle: true,
  SetLocked: true,
  SetHead: true,
  PasteItems: true,
  SetCells: true,
  InsertRows: true,
  InsertCols: true,
  DeleteRows: true,
  DeleteCols: true,
  MoveRow: true,
  MoveCol: true,
  SetColWidth: true,
  CreateEvent: true,
  UpdateEvent: true,
  DeleteEvent: true,
  SetOccurrence: true,
  ClearOccurrence: true,
  ImportEvents: true,
  SetRsvp: true,
};

/** Any command, over the fixture's ids and some that do not exist: allowed or not. */
const wideArb: fc.Arbitrary<Command> = (() => {
  const fresh = fc.nat(9).map((n) => `n${n}`);
  const shapeId = fc.constantFrom(...SHAPES, 'ghost');
  const connectorId = fc.constantFrom('k0', 'k1', 'ghost');
  const rowId = fc.constantFrom(...ROWS, 'ghost');
  const colId = fc.constantFrom(...COLS, 'ghost');
  const eventId = fc.constantFrom(...EVENTS, 'ghost');
  const pageId = fc.constantFrom('sheet', 'cal', 'main', 'ghost');
  const coord = fc.integer({ min: 0, max: 500 });
  const text = fc.string({ maxLength: 6 });
  return fc.oneof(
    fresh.map((id): Command => ({ type: 'CreateShape', shape: sticky(id) })),
    fc
      .array(fc.record({ id: shapeId, x: coord, y: coord }), { maxLength: 3 })
      .map((moves): Command => ({ type: 'MoveShapes', moves })),
    fc
      .array(
        fc.record({
          id: shapeId,
          x: coord,
          y: coord,
          w: fc.integer({ min: 20, max: 400 }),
          h: fc.integer({ min: 20, max: 400 }),
        }),
        { maxLength: 3 },
      )
      .map((rects): Command => ({ type: 'ResizeShapes', rects })),
    fc
      .record({ id: shapeId, index: fc.nat(10), deleteCount: fc.nat(5), insert: text })
      .map((r): Command => ({ type: 'SetText', ...r })),
    some([...SHAPES, 'k0', 'k1', 'ghost']).map((ids): Command => ({ type: 'DeleteShapes', ids })),
    fc.record({ id: fresh, from: shapeId, to: shapeId }).map(
      ({ id, from, to }): Command => ({
        type: 'Connect',
        connector: {
          id,
          from: { shapeId: from, anchor: 'auto' },
          to: { shapeId: to, anchor: 'auto' },
          routing: 'straight',
          head: 'arrow',
          createdBy: 'u',
        },
      }),
    ),
    fc
      .record({ id: connectorId, routing: fc.constantFrom('straight' as const, 'elbow' as const) })
      .map((r): Command => ({ type: 'SetRouting', ...r })),
    fc
      .record({ id: connectorId, label: text })
      .map((r): Command => ({ type: 'SetConnectorLabel', ...r })),
    fc
      .record({ id: connectorId, head: fc.constantFrom('arrow' as const, 'none' as const) })
      .map((r): Command => ({ type: 'SetHead', ...r })),
    fc.record({ id: shapeId, parentId: fc.option(shapeId, { nil: null }) }).map(
      ({ id, parentId }): Command => ({
        type: 'Reparent',
        moves: [{ id, parentId, columnId: null }],
      }),
    ),
    fc
      .record({ frameId: shapeId, title: text })
      .map((r): Command => ({ type: 'RenameColumn', columnId: 'c', ...r })),
    fc
      .integer({ min: 1, max: 3 })
      .map((maxPerUser): Command => ({ type: 'StartVote', endsAt: 1, maxPerUser, startedBy: 'u' })),
    fc.constant<Command>({ type: 'EndVote' }),
    shapeId.map((shapeId): Command => ({ type: 'CastVote', shapeId, userId: 'u' })),
    shapeId.map((shapeId): Command => ({ type: 'RetractVote', shapeId, userId: 'u' })),
    fresh.map(
      (id): Command => ({
        type: 'AddComment',
        id,
        pageId: 'main',
        anchor: { x: 1, y: 2 },
        createdBy: 'u',
        createdAt: 0,
        entry: entry(`${id}e`),
      }),
    ),
    fresh.map((id): Command => ({ type: 'ReplyComment', commentId: id, entry: entry('re') })),
    fc
      .record({ id: fresh, resolved: fc.boolean() })
      .map((r): Command => ({ type: 'ResolveComment', ...r })),
    fc
      .record({
        id: fc.constantFrom('pg1', 'pg2'),
        type: fc.constantFrom('board', 'sheet', 'calendar'),
      })
      .map(
        ({ id, type }): Command => ({
          type: 'CreatePage',
          page: { id, type, title: id, order: 'a3', createdBy: 'u', createdAt: 0 },
        }),
      ),
    fc.record({ id: pageId, title: text }).map((r): Command => ({ type: 'RenamePage', ...r })),
    fc
      .record({ id: pageId, order: fc.constantFrom('a0V', 'a5', 'b1') })
      .map((r): Command => ({ type: 'MovePage', ...r })),
    pageId.map((id): Command => ({ type: 'DeletePage', id })),
    text.map((title): Command => ({ type: 'RenameBoard', title })),
    fc
      .record({ ids: some(SHAPES), where: fc.constantFrom('front' as const, 'back' as const) })
      .map((r): Command => ({ type: 'SetZ', ...r })),
    some(SHAPES).map((ids): Command => ({ type: 'SetStyle', ids, patch: { fill: '#112233' } })),
    fc
      .record({ ids: some(SHAPES), locked: fc.boolean() })
      .map((r): Command => ({ type: 'SetLocked', ...r })),
    fresh.map((id): Command => ({ type: 'PasteItems', shapes: [sticky(id)], connectors: [] })),
    fc
      .array(
        fc.record({
          row: rowId,
          col: colId,
          src: fc.constantFrom('', '', '', '1', 'x'),
          fmt: fc.constantFrom(undefined, { bold: true as const }),
        }),
        { minLength: 1, maxLength: 4 },
      )
      .map(
        (cells): Command => ({
          type: 'SetCells',
          pageId: 'sheet',
          cells: cells.map(({ fmt, ...c }) => (fmt ? { ...c, fmt } : c)),
        }),
      ),
    fresh.map(
      (id): Command => ({ type: 'InsertRows', pageId: 'sheet', rows: [{ id, order: 'a1V' }] }),
    ),
    fresh.map(
      (id): Command => ({ type: 'InsertCols', pageId: 'sheet', cols: [{ id, order: 'a1V' }] }),
    ),
    some([...ROWS, 'ghost']).map((ids): Command => ({ type: 'DeleteRows', pageId: 'sheet', ids })),
    some([...COLS, 'ghost']).map((ids): Command => ({ type: 'DeleteCols', pageId: 'sheet', ids })),
    rowId.map((id): Command => ({ type: 'MoveRow', pageId: 'sheet', id, order: 'a0V' })),
    colId.map((id): Command => ({ type: 'MoveCol', pageId: 'sheet', id, order: 'a0V' })),
    colId.map((id): Command => ({ type: 'SetColWidth', pageId: 'sheet', id, width: 120 })),
    fresh.map(
      (id): Command => ({ type: 'CreateEvent', pageId: 'cal', id, fields: eventFields(id) }),
    ),
    fc.record({ id: eventId, title: text }).map(
      ({ id, title }): Command => ({
        type: 'UpdateEvent',
        pageId: 'cal',
        id,
        patch: { title },
      }),
    ),
    eventId.map((id): Command => ({ type: 'DeleteEvent', pageId: 'cal', id })),
    eventId.map(
      (id): Command => ({
        type: 'SetOccurrence',
        pageId: 'cal',
        id,
        key: '2026-10-05',
        value: { cancelled: true },
      }),
    ),
    eventId.map(
      (id): Command => ({ type: 'ClearOccurrence', pageId: 'cal', id, key: '2026-10-05' }),
    ),
    fresh.map(
      (id): Command => ({
        type: 'ImportEvents',
        pageId: 'cal',
        events: [{ id, fields: eventFields(id), exceptions: {} }],
      }),
    ),
    fc
      .record({
        id: eventId,
        status: fc.constantFrom('yes' as const, 'maybe' as const, 'no' as const, null),
      })
      .map(
        ({ id, status }): Command => ({
          type: 'SetRsvp',
          pageId: 'cal',
          id,
          userId: 'u',
          status,
          name: 'U',
        }),
      ),
  );
})();

describe('allowedWhenFull', () => {
  it('the fixture really holds what the commands delete', () => {
    const roots = getRoots(fixture());
    expect(roots.shapes.size).toBe(SHAPES.length);
    expect(roots.connectors.size).toBe(2);
    expect(roots.sheets.has('sheet')).toBe(true);
    const sheet = roots.sheets.get('sheet');
    const sizeOf = (key: string) => (sheet?.get(key) as Y.Map<unknown> | undefined)?.size;
    expect(sizeOf('rows')).toBe(ROWS.length);
    expect(sizeOf('cols')).toBe(COLS.length);
    expect(sizeOf('cells')).toBe(ROWS.length * COLS.length);
    const events = roots.calendars.get('cal')?.get('events') as Y.Map<unknown> | undefined;
    expect(events?.size).toBe(EVENTS.length);
  });

  it('the wide generator reaches every command type, allowed and not', () => {
    const samples = fc.sample(wideArb, { numRuns: 4000, seed: 7 });
    const seen = new Set(samples.map((c) => c.type));
    expect([...seen].sort()).toEqual(Object.keys(COMMAND_TYPES).sort());
    expect(samples.some(allowedWhenFull)).toBe(true);
    expect(samples.some((c) => !allowedWhenFull(c))).toBe(true);
  });

  it('allows the deleting commands and a SetCells that only clears', () => {
    expect(allowedWhenFull({ type: 'DeleteShapes', ids: ['s0'] })).toBe(true);
    expect(allowedWhenFull({ type: 'DeleteRows', pageId: 'p', ids: ['r'] })).toBe(true);
    expect(allowedWhenFull({ type: 'DeleteCols', pageId: 'p', ids: ['c'] })).toBe(true);
    expect(allowedWhenFull({ type: 'DeleteEvent', pageId: 'p', id: 'e' })).toBe(true);
    expect(
      allowedWhenFull({ type: 'SetCells', pageId: 'p', cells: [{ row: 'r', col: 'c', src: '' }] }),
    ).toBe(true);
  });

  it('refuses everything that writes, including DeletePage and a clear that keeps a format', () => {
    expect(allowedWhenFull({ type: 'DeletePage', id: 'p' })).toBe(false);
    expect(allowedWhenFull({ type: 'MoveShapes', moves: [] })).toBe(false);
    expect(allowedWhenFull({ type: 'EndVote' })).toBe(false);
    expect(
      allowedWhenFull({ type: 'SetCells', pageId: 'p', cells: [{ row: 'r', col: 'c', src: 'x' }] }),
    ).toBe(false);
    expect(
      allowedWhenFull({
        type: 'SetCells',
        pageId: 'p',
        cells: [{ row: 'r', col: 'c', src: '', fmt: { bold: true } }],
      }),
    ).toBe(false);
  });

  it('an allowed command deletes something and adds no struct (a full server accepts it)', () => {
    const doc = fixture();
    const updates = updatesOf(doc, { type: 'DeleteShapes', ids: ['s0'] });
    expect(updates.length).toBeGreaterThan(0);
    expect(getRoots(doc).shapes.has('s0')).toBe(false);
    for (const u of updates) expect(Y.decodeUpdate(u).structs).toHaveLength(0);
  });

  it('every allowed command produces updates with no structs and no split, over random sequences', () => {
    fc.assert(
      fc.property(fc.array(allowedArb, { minLength: 1, maxLength: 8 }), (commands) => {
        const doc = fixture();
        const server = mirrorOf(doc);
        commands.forEach((command, i) => {
          expect(allowedWhenFull(command)).toBe(true);
          const updates = updatesOf(doc, command);
          // The first command acts on a fixture that holds what it names: later ones may find
          // it already deleted. Without this the arms could pass over an empty fixture.
          if (i === 0) expect(updates.length).toBeGreaterThan(0);
          for (const u of updates) {
            expect(Y.decodeUpdate(u).structs).toHaveLength(0);
            expect(splitsLiveStruct(u, server)).toBe(false);
            Y.applyUpdate(server, u);
          }
        });
      }),
      { numRuns: RUNS },
    );
  });

  it('whatever a command is, allowed implies updates with no structs and no split', () => {
    fc.assert(
      fc.property(fc.array(wideArb, { minLength: 1, maxLength: 12 }), (commands) => {
        const doc = fixture();
        const server = mirrorOf(doc);
        for (const command of commands) {
          const allowed = allowedWhenFull(command);
          for (const u of updatesOf(doc, command)) {
            if (allowed) {
              expect(Y.decodeUpdate(u).structs).toHaveLength(0);
              expect(splitsLiveStruct(u, server)).toBe(false);
            }
            Y.applyUpdate(server, u);
          }
        }
      }),
      { numRuns: RUNS },
    );
  });
});

describe('allowedFor', () => {
  const move = { type: 'MoveShapes' as const, moves: [] };
  const remove = { type: 'DeleteShapes' as const, ids: ['a'] };

  it('edit applies everything, delete-only what only deletes, read-only nothing', () => {
    expect(allowedFor('edit', move)).toBe(true);
    expect(allowedFor('edit', remove)).toBe(true);
    expect(allowedFor('delete-only', move)).toBe(false);
    expect(allowedFor('delete-only', remove)).toBe(true);
    expect(allowedFor('read-only', move)).toBe(false);
    expect(allowedFor('read-only', remove)).toBe(false);
  });
});
