import { ZOOM_STEP } from '@relay/core';
import { Minus, Plus } from 'lucide-react';
import type { MouseEvent } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';

// Keep focus on the page: a focused button would be "clicked" by the Space used for panning.
const noFocus = (e: MouseEvent) => e.preventDefault();

export function ZoomControls({ session }: { session: BoardSession }) {
  const { controller } = session;
  const zoom = useStore(controller.ui, (s) => s.camera.zoom);
  const pointer = useStore(controller.ui, (s) => s.pointer);
  const step = 'grid size-ctl place-items-center hover:bg-sun';
  return (
    <div className="absolute bottom-4 left-4 flex items-center gap-3">
      <div className="flex items-center border-2 border-ink bg-white shadow-hard">
        <button
          type="button"
          data-testid="zoom-out"
          aria-label="Zoom out"
          className={step}
          onMouseDown={noFocus}
          onClick={() => controller.zoomBy(1 / ZOOM_STEP)}
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          data-testid="zoom-reset"
          aria-label="Reset zoom to 100%"
          className="h-ctl min-w-14 border-x-2 border-ink px-2 font-mono text-xs font-bold hover:bg-sun"
          onMouseDown={noFocus}
          onClick={() => controller.resetZoom()}
        >
          {`${Math.round(zoom * 100)}%`}
        </button>
        <button
          type="button"
          data-testid="zoom-in"
          aria-label="Zoom in"
          className={step}
          onMouseDown={noFocus}
          onClick={() => controller.zoomBy(ZOOM_STEP)}
        >
          <Plus size={14} />
        </button>
      </div>
      {pointer && (
        <span
          data-testid="coords"
          className="border-2 border-ink bg-white px-2 py-1 font-mono text-[11px] shadow-hard"
        >
          {`X ${Math.round(pointer.x)} · Y ${Math.round(pointer.y)}`}
        </span>
      )}
    </div>
  );
}
