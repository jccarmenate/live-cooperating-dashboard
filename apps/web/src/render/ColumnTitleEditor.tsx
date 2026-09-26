import { COLUMN_HEADER_H, frameColumns, worldToScreen } from '@relay/core';
import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { useShape } from './useShape';

export function ColumnTitleEditor({ session }: { session: BoardSession }) {
  const { controller } = session;
  const editing = useStore(controller.ui, (s) => s.editingColumn);
  const frame = useShape(session, editing?.frameId ?? null);
  const camera = useStore(controller.ui, (s) => s.camera);
  const ref = useRef<HTMLInputElement>(null);
  const finished = useRef(false);
  const key = editing ? `${editing.frameId}:${editing.columnId}` : null;

  useEffect(() => {
    if (!key) return;
    finished.current = false;
    ref.current?.focus();
    ref.current?.select();
  }, [key]);

  const column =
    editing && frame ? frameColumns(frame).find((c) => c.id === editing.columnId) : undefined;
  if (!editing || !column) return null;

  const finish = (commit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    const value = ref.current?.value.trim() ?? '';
    if (commit && value && value !== column.title) {
      controller.renameColumn(editing.frameId, column.id, value);
    } else {
      controller.stopEditingColumn();
    }
  };

  const pos = worldToScreen(camera, { x: column.x, y: column.y });
  return (
    <div
      className="absolute left-0 top-0 origin-top-left"
      style={{
        transform: `translate(${pos.x}px, ${pos.y}px) scale(${camera.zoom})`,
        width: column.w,
        height: COLUMN_HEADER_H,
      }}
    >
      <input
        key={key}
        ref={ref}
        data-testid="column-editor"
        aria-label="Column title"
        defaultValue={column.title}
        className="size-full border-2 border-cobalt bg-white px-3 font-mono text-[11px] font-bold uppercase tracking-wider outline-none"
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Enter') finish(true);
          else if (e.key === 'Escape') finish(false);
        }}
        onBlur={() => finish(true)}
      />
    </div>
  );
}
