import { type AlgorithmKind, readGraph } from '@relay/core';
import { useState } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { describeResult, shortName } from './graphText';

const KINDS: { kind: AlgorithmKind; label: string }[] = [
  { kind: 'bfs', label: 'Breadth-first search' },
  { kind: 'dfs', label: 'Depth-first search' },
  { kind: 'path', label: 'Shortest path (Dijkstra)' },
  { kind: 'mst', label: 'Minimum spanning tree' },
  { kind: 'components', label: 'Connected components' },
];

export function AlgorithmsPanel({ session }: { session: BoardSession }) {
  const { controller } = session;
  const open = useStore(controller.ui, (s) => s.algorithmsPanel);
  const selection = useStore(controller.ui, (s) => s.tool.selection);
  const result = useStore(controller.ui, (s) => s.graphResult);
  const resultNames = useStore(controller.ui, (s) => s.graphNames);
  const shapes = useStore(session.doc, (d) => d.shapes);
  const connectors = useStore(session.doc, (d) => d.connectors);
  const [kind, setKind] = useState<AlgorithmKind>('bfs');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  if (!open) return null;

  const graph = readGraph(selection, shapes, connectors);
  // readGraph falls back to the whole page when no selected id is a shape (connectors only).
  const onSelection = selection.some((id) => shapes[id] !== undefined);
  const startId = graph.nodes.some((n) => n.id === start) ? start : (graph.nodes[0]?.id ?? '');
  const endId = graph.nodes.some((n) => n.id === end) ? end : (graph.nodes.at(-1)?.id ?? '');
  const field =
    'mt-1 w-full border-2 border-ink/40 px-2 py-1 pointer-coarse:py-2 font-mono text-xs text-ink normal-case';

  return (
    <aside
      data-testid="algorithms-panel"
      data-scroll-region
      aria-label="Graph algorithms"
      // Above the selection's properties bar; scrolls when the screen is shorter than the panel.
      className="absolute top-3 right-3 z-20 flex max-h-[calc(100%-1.5rem)] w-72 flex-col gap-3 overflow-y-auto border-[3px] border-ink bg-white p-3 shadow-hard max-sm:left-20 max-sm:w-auto"
    >
      <div className="flex items-center justify-between">
        <h2 className="font-display text-sm uppercase">Algorithms</h2>
        <button
          type="button"
          aria-label="Close"
          className="border-2 border-ink px-1.5 font-mono text-xs hover:bg-paper"
          onClick={() => controller.setAlgorithmsPanel(false)}
        >
          ×
        </button>
      </div>
      <p className="font-mono text-2xs text-ink/60">
        {onSelection ? 'On the selection' : 'On the whole page'} · {graph.nodes.length} nodes ·{' '}
        {graph.edges.length} edges
      </p>
      <label className="font-mono text-2xs uppercase text-ink/60">
        Algorithm
        <select
          data-testid="algo-kind"
          value={kind}
          onChange={(e) => setKind(e.target.value as AlgorithmKind)}
          className={field}
        >
          {KINDS.map((k) => (
            <option key={k.kind} value={k.kind}>
              {k.label}
            </option>
          ))}
        </select>
      </label>
      {(kind === 'bfs' || kind === 'dfs' || kind === 'path') && (
        <label className="font-mono text-2xs uppercase text-ink/60">
          Start
          <select
            data-testid="algo-start"
            value={startId}
            onChange={(e) => setStart(e.target.value)}
            className={field}
          >
            {graph.nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {shortName(n.name)}
              </option>
            ))}
          </select>
        </label>
      )}
      {kind === 'path' && (
        <label className="font-mono text-2xs uppercase text-ink/60">
          End
          <select
            data-testid="algo-end"
            value={endId}
            onChange={(e) => setEnd(e.target.value)}
            className={field}
          >
            {graph.nodes.map((n) => (
              <option key={n.id} value={n.id}>
                {shortName(n.name)}
              </option>
            ))}
          </select>
        </label>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          data-testid="algo-run"
          className="flex-1 border-2 border-ink bg-sun py-1 pointer-coarse:py-2 font-mono text-xs font-bold uppercase hover:brightness-105"
          onClick={() => controller.runAlgorithm(kind, startId, endId)}
        >
          Run
        </button>
        <button
          type="button"
          data-testid="algo-clear"
          className="border-2 border-ink px-3 py-1 pointer-coarse:py-2 font-mono text-xs uppercase hover:bg-paper"
          onClick={() => controller.clearGraphResult()}
        >
          Clear
        </button>
      </div>
      {result && (
        <p
          data-testid="algo-result"
          className={`max-h-40 overflow-y-auto break-words font-mono text-xs ${result.kind === 'error' ? 'text-flame' : ''}`}
        >
          {describeResult(result, resultNames, (id) => shapes[id] !== undefined)}
        </p>
      )}
    </aside>
  );
}
