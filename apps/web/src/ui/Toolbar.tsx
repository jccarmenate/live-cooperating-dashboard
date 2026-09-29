import type { ToolId } from '@relay/core';
import {
  ArrowUpRight,
  Braces,
  Circle,
  Frame,
  MessageCircle,
  MousePointer2,
  Network,
  Slash,
  Square,
  StickyNote,
  Type,
} from 'lucide-react';
import { type ComponentType, useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';

interface Tool {
  id: ToolId;
  label: string;
  key: string;
  Icon: ComponentType<{ className?: string }>;
}

/** The geometric shapes share one toolbar button that opens a flyout. */
const SHAPES: readonly Tool[] = [
  { id: 'rect', label: 'Rectangle', key: 'R', Icon: Square },
  { id: 'ellipse', label: 'Ellipse', key: 'O', Icon: Circle },
  { id: 'line', label: 'Line', key: 'L', Icon: Slash },
];

const BEFORE_SHAPES: readonly Tool[] = [
  { id: 'select', label: 'Select', key: 'V', Icon: MousePointer2 },
];

const AFTER_SHAPES: readonly Tool[] = [
  { id: 'connector', label: 'Connector', key: 'A', Icon: ArrowUpRight },
  { id: 'text', label: 'Text', key: 'T', Icon: Type },
  { id: 'sticky', label: 'Sticky note', key: 'S', Icon: StickyNote },
  { id: 'code', label: 'Code block', key: 'C', Icon: Braces },
  { id: 'frame', label: 'Frame', key: 'F', Icon: Frame },
  { id: 'comment', label: 'Comment', key: 'M', Icon: MessageCircle },
];

const buttonClass = (pressed: boolean) =>
  `grid size-9 place-items-center border-2 border-ink ${pressed ? 'bg-sun' : 'bg-white hover:bg-paper'}`;

function ToolButton({ tool, active, onPick }: { tool: Tool; active: boolean; onPick(): void }) {
  const { id, label, key, Icon } = tool;
  return (
    <button
      type="button"
      data-testid={`tool-${id}`}
      aria-label={`${label} (${key})`}
      aria-pressed={active}
      title={`${label} (${key})`}
      onClick={onPick}
      className={buttonClass(active)}
    >
      <Icon className="size-4" />
    </button>
  );
}

/** One button for rectangle, ellipse and line; it shows the last shape used and opens a flyout. */
function ShapesButton({ session, active }: { session: BoardSession; active: ToolId }) {
  const [open, setOpen] = useState(false);
  // Kept by the controller (flyout or R, O, L), so it survives the toolbar remounting.
  const lastShape = useStore(session.controller.ui, (s) => s.lastShape);
  const last = SHAPES.find((s) => s.id === lastShape) ?? (SHAPES[0] as Tool);
  const ref = useRef<HTMLDivElement>(null);
  const current = SHAPES.find((s) => s.id === active);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const Icon = last.Icon;
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-testid="tool-shapes"
        data-current={last.id}
        aria-label="Shapes (R, O, L)"
        aria-haspopup="true"
        aria-expanded={open}
        aria-pressed={current !== undefined}
        title="Shapes (R, O, L)"
        onClick={() => setOpen((o) => !o)}
        className={`relative ${buttonClass(current !== undefined)}`}
      >
        <Icon className="size-4" />
        <span aria-hidden className="absolute bottom-0 right-0.5 text-[8px] leading-none">
          ▸
        </span>
      </button>
      {open && (
        <fieldset
          aria-label="Shapes"
          data-testid="shapes-flyout"
          className="absolute left-full top-0 ml-2 flex gap-1.5 border-[3px] border-ink bg-white p-1.5 shadow-hard"
        >
          {SHAPES.map((tool) => (
            <ToolButton
              key={tool.id}
              tool={tool}
              active={active === tool.id}
              onPick={() => {
                session.controller.dispatch({ type: 'setTool', tool: tool.id });
                setOpen(false);
              }}
            />
          ))}
        </fieldset>
      )}
    </div>
  );
}

/** The Graph menu: New graph (editors) and Algorithms (everyone). */
function GraphButton({ session, canEdit }: { session: BoardSession; canEdit: boolean }) {
  const { controller } = session;
  const open = useStore(controller.ui, (s) => s.graphMenu);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) controller.setGraphMenu(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') controller.setGraphMenu(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, controller]);
  const item =
    'block w-full px-3 py-1.5 text-left font-mono text-xs hover:bg-sun disabled:cursor-not-allowed disabled:text-ink/40 disabled:hover:bg-transparent';
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        data-testid="tool-graph"
        aria-label="Graph (G)"
        title="Graph (G)"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => controller.setGraphMenu(!open)}
        className={buttonClass(open)}
      >
        <Network className="size-4" />
      </button>
      {open && (
        <div
          role="menu"
          data-testid="graph-menu"
          className="absolute left-full top-0 z-30 ml-2 min-w-40 border-[3px] border-ink bg-white py-1 shadow-hard"
        >
          <button
            type="button"
            role="menuitem"
            data-testid="graph-new"
            disabled={!canEdit}
            className={item}
            onClick={() => controller.setGraphDialog(true)}
          >
            New graph…
          </button>
          <button
            type="button"
            role="menuitem"
            data-testid="graph-algorithms"
            className={item}
            onClick={() => {
              controller.setGraphMenu(false);
              controller.setAlgorithmsPanel(true);
            }}
          >
            Algorithms…
          </button>
        </div>
      )}
    </div>
  );
}

export function Toolbar({ session }: { session: BoardSession }) {
  const active = useStore(session.controller.ui, (s) => s.tool.tool);
  const role = useStore(session.conn.clock, (c) => c.role);
  const pick = (id: ToolId) => session.controller.dispatch({ type: 'setTool', tool: id });
  return (
    <nav
      aria-label="Tools"
      className="absolute left-3 top-3 flex flex-col gap-1.5 border-[3px] border-ink bg-white p-1.5 shadow-hard"
    >
      {BEFORE_SHAPES.map((tool) => (
        <ToolButton
          key={tool.id}
          tool={tool}
          active={active === tool.id}
          onPick={() => pick(tool.id)}
        />
      ))}
      <ShapesButton session={session} active={active} />
      {AFTER_SHAPES.filter((t) => t.id !== 'comment' || role === 'edit').map((tool) => (
        <ToolButton
          key={tool.id}
          tool={tool}
          active={active === tool.id}
          onPick={() => pick(tool.id)}
        />
      ))}
      <GraphButton session={session} canEdit={role === 'edit'} />
      <span className="my-0.5 h-px bg-ink/20" aria-hidden />
      <button
        type="button"
        data-testid="help-button"
        aria-label="Keyboard shortcuts (?)"
        title="Keyboard shortcuts (?)"
        onClick={() => session.controller.setHelp(true)}
        className="grid size-9 place-items-center border-2 border-ink bg-white font-display text-sm hover:bg-paper"
      >
        ?
      </button>
    </nav>
  );
}
