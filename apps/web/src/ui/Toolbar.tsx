import type { ToolId } from '@relay/core';
import {
  ArrowUpRight,
  Braces,
  Circle,
  Frame,
  MessageCircle,
  MousePointer2,
  Slash,
  Square,
  StickyNote,
  Type,
} from 'lucide-react';
import type { ComponentType } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';

const TOOLS: {
  id: ToolId;
  label: string;
  key: string;
  Icon: ComponentType<{ className?: string }>;
}[] = [
  { id: 'select', label: 'Select', key: 'V', Icon: MousePointer2 },
  { id: 'rect', label: 'Rectangle', key: 'R', Icon: Square },
  { id: 'ellipse', label: 'Ellipse', key: 'O', Icon: Circle },
  { id: 'line', label: 'Line', key: 'L', Icon: Slash },
  { id: 'connector', label: 'Connector', key: 'A', Icon: ArrowUpRight },
  { id: 'text', label: 'Text', key: 'T', Icon: Type },
  { id: 'sticky', label: 'Sticky note', key: 'S', Icon: StickyNote },
  { id: 'code', label: 'Code block', key: 'C', Icon: Braces },
  { id: 'frame', label: 'Frame', key: 'F', Icon: Frame },
  { id: 'comment', label: 'Comment', key: 'M', Icon: MessageCircle },
];

export function Toolbar({ session }: { session: BoardSession }) {
  const active = useStore(session.controller.ui, (s) => s.tool.tool);
  const role = useStore(session.conn.clock, (c) => c.role);
  return (
    <nav
      aria-label="Tools"
      className="absolute left-3 top-3 flex flex-col gap-1.5 border-[3px] border-ink bg-white p-1.5 shadow-hard"
    >
      {TOOLS.filter((t) => t.id !== 'comment' || role === 'edit').map(
        ({ id, label, key, Icon }) => (
          <button
            key={id}
            type="button"
            data-testid={`tool-${id}`}
            aria-label={`${label} (${key})`}
            aria-pressed={active === id}
            title={`${label} (${key})`}
            onClick={() => session.controller.dispatch({ type: 'setTool', tool: id })}
            className={`grid size-9 place-items-center border-2 border-ink ${active === id ? 'bg-sun' : 'bg-white hover:bg-paper'}`}
          >
            <Icon className="size-4" />
          </button>
        ),
      )}
    </nav>
  );
}
