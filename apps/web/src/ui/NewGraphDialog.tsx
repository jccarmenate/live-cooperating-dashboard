import {
  type EdgeListError,
  FAMILY_PARAMS,
  type FamilyKind,
  type FamilyOptions,
  type FamilyParams,
  familyGraph,
  parseEdgeList,
} from '@relay/core';
import { useCallback, useState } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { Dialog } from './Dialog';

const FAMILIES: { kind: FamilyKind; label: string }[] = [
  { kind: 'complete', label: 'Complete Kₙ' },
  { kind: 'cycle', label: 'Cycle Cₙ' },
  { kind: 'path', label: 'Path Pₙ' },
  { kind: 'star', label: 'Star' },
  { kind: 'wheel', label: 'Wheel' },
  { kind: 'bipartite', label: 'Complete bipartite Kₘ,ₙ' },
  { kind: 'grid', label: 'Grid m × n' },
  { kind: 'tree', label: 'k-ary tree' },
  { kind: 'random', label: 'Random G(n, p)' },
];

const PARAM_LABEL: Record<keyof FamilyParams, string> = {
  n: 'n',
  m: 'm',
  k: 'k (children)',
  depth: 'depth',
  p: 'p (edge chance)',
};

export function NewGraphDialog({ session }: { session: BoardSession }) {
  const { controller } = session;
  const open = useStore(controller.ui, (s) => s.graphDialog);
  const close = useCallback(() => controller.setGraphDialog(false), [controller]);
  const [tab, setTab] = useState<'families' | 'edges'>('families');
  const [family, setFamily] = useState<FamilyKind>('complete');
  const [params, setParams] = useState<FamilyParams>({ n: 5, m: 3, k: 2, depth: 3, p: 0.3 });
  const [opts, setOpts] = useState<FamilyOptions>({
    directed: false,
    weighted: false,
    names: 'letters',
  });
  const [edges, setEdges] = useState('A-B, B-C:2\nC->D:5, D-A');
  const [errors, setErrors] = useState<EdgeListError[]>([]);
  if (!open) return null;

  const create = () => {
    if (tab === 'families') {
      const r = familyGraph(family, params, opts);
      if ('error' in r) {
        setErrors([{ line: 0, message: r.error }]);
        return;
      }
      setErrors([]);
      controller.createGraph(r);
      return;
    }
    const r = parseEdgeList(edges);
    setErrors(r.errors);
    if (r.draft) controller.createGraph(r.draft);
  };
  const tabClass = (t: typeof tab) =>
    `flex-1 py-1.5 font-mono text-[11px] font-bold uppercase ${tab === t ? 'bg-sun' : 'bg-white hover:bg-paper'}`;
  const field = 'mt-1 w-full border-2 border-ink/40 px-2 py-1 font-mono text-xs';

  return (
    <Dialog title="New graph" onClose={close} wide>
      <div data-testid="graph-dialog">
        <div className="flex border-2 border-ink">
          <button
            type="button"
            data-testid="graph-tab-families"
            className={tabClass('families')}
            onClick={() => setTab('families')}
          >
            Families
          </button>
          <button
            type="button"
            data-testid="graph-tab-edges"
            className={tabClass('edges')}
            onClick={() => setTab('edges')}
          >
            Edge list
          </button>
        </div>
        {tab === 'families' ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="font-mono text-[10px] uppercase text-ink/60 sm:col-span-2">
              Family
              <select
                data-testid="graph-family"
                value={family}
                onChange={(e) => setFamily(e.target.value as FamilyKind)}
                className={field}
              >
                {FAMILIES.map((f) => (
                  <option key={f.kind} value={f.kind}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            {(
              Object.entries(FAMILY_PARAMS[family]) as [
                keyof FamilyParams,
                readonly [number, number],
              ][]
            ).map(([key, [min, max]]) => (
              <label key={key} className="font-mono text-[10px] uppercase text-ink/60">
                {PARAM_LABEL[key]} ({min}–{max})
                <input
                  data-testid={`graph-${key}`}
                  type="number"
                  min={min}
                  max={max}
                  step={key === 'p' ? 0.05 : 1}
                  value={params[key]}
                  onChange={(e) => setParams({ ...params, [key]: Number(e.target.value) })}
                  className={field}
                />
              </label>
            ))}
            <label className="flex items-center gap-2 font-mono text-xs">
              <input
                data-testid="graph-directed"
                type="checkbox"
                checked={opts.directed}
                onChange={(e) => setOpts({ ...opts, directed: e.target.checked })}
              />
              Directed
            </label>
            <label className="flex items-center gap-2 font-mono text-xs">
              <input
                data-testid="graph-weighted"
                type="checkbox"
                checked={opts.weighted}
                onChange={(e) => setOpts({ ...opts, weighted: e.target.checked })}
              />
              Weighted (1–9)
            </label>
            <label className="font-mono text-[10px] uppercase text-ink/60">
              Node names
              <select
                data-testid="graph-names"
                value={opts.names}
                onChange={(e) =>
                  setOpts({ ...opts, names: e.target.value as FamilyOptions['names'] })
                }
                className={field}
              >
                <option value="letters">Letters (A, B, …)</option>
                <option value="numbers">Numbers (1, 2, …)</option>
              </select>
            </label>
          </div>
        ) : (
          <label className="mt-3 block font-mono text-[10px] uppercase text-ink/60">
            One edge per line or comma: A-B undirected, A-&gt;B directed, A-B:5 weight, lone names
            are nodes
            <textarea
              data-testid="graph-edges"
              data-scroll-region
              value={edges}
              onChange={(e) => setEdges(e.target.value)}
              rows={8}
              className={`${field} resize-y normal-case text-ink`}
            />
          </label>
        )}
        {errors.length > 0 && (
          <ul data-testid="graph-errors" className="mt-3 grid gap-1 font-mono text-xs text-flame">
            {errors.map((e) => (
              <li key={`${e.line}:${e.message}`}>
                {e.line > 0 ? `Line ${e.line}: ${e.message}` : e.message}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            className="border-2 border-ink px-3 py-1 font-mono text-xs uppercase hover:bg-paper"
            onClick={close}
          >
            Cancel
          </button>
          <button
            type="button"
            data-testid="graph-create"
            className="border-2 border-ink bg-sun px-3 py-1 font-mono text-xs font-bold uppercase hover:brightness-105"
            onClick={create}
          >
            Create
          </button>
        </div>
      </div>
    </Dialog>
  );
}
