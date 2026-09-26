import { PALETTE, type PointerInfo, panBy, screenToWorld } from '@relay/core';
import { type MouseEvent, type PointerEvent, useRef, type WheelEvent } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { SelectionLayer } from './SelectionLayer';
import { ShapeView } from './ShapeView';

export function Canvas({ session }: { session: BoardSession }) {
  const { controller, publisher } = session;
  const order = useStore(session.doc, (s) => s.order);
  const camera = useStore(controller.ui, (s) => s.camera);
  const preview = useStore(controller.ui, (s) => s.preview);
  const svgRef = useRef<SVGSVGElement>(null);

  const info = (e: PointerEvent | MouseEvent): PointerInfo => {
    const bounds = svgRef.current?.getBoundingClientRect();
    const screen = { x: e.clientX - (bounds?.left ?? 0), y: e.clientY - (bounds?.top ?? 0) };
    const hit = (e.target as Element).closest('[data-shape-id]');
    return {
      world: screenToWorld(controller.ui.getState().camera, screen),
      shift: e.shiftKey,
      hitId: hit?.getAttribute('data-shape-id') ?? null,
    };
  };

  const transform = `scale(${camera.zoom}) translate(${camera.x} ${camera.y})`;

  return (
    <svg
      ref={svgRef}
      data-testid="canvas"
      aria-label="Board canvas"
      className="absolute inset-0 size-full touch-none select-none"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        // Needed so a freshly created shape's textarea keeps focus (below);
        // it also means the browser won't blur an already-open editor on
        // its own, so we must do that explicitly when the click lands
        // outside the shape currently being edited.
        e.preventDefault();
        e.currentTarget.setPointerCapture(e.pointerId);
        const p = info(e);
        const { editingId } = controller.ui.getState();
        if (editingId && p.hitId !== editingId) {
          controller.stopEditing();
          (document.activeElement as HTMLElement | null)?.blur();
        }
        controller.dispatch({ type: 'pointerDown', p });
      }}
      onPointerMove={(e) => {
        const p = info(e);
        publisher.setCursor(p.world);
        controller.dispatch({ type: 'pointerMove', p });
      }}
      onPointerUp={(e) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
        controller.dispatch({ type: 'pointerUp', p: info(e) });
      }}
      onPointerLeave={() => publisher.setCursor(null)}
      onDoubleClick={(e) => controller.dispatch({ type: 'doubleClick', p: info(e) })}
      onWheel={(e: WheelEvent) =>
        controller.setCamera(panBy(controller.ui.getState().camera, -e.deltaX, -e.deltaY))
      }
    >
      <defs>
        <pattern
          id="relay-dots"
          width={24}
          height={24}
          patternUnits="userSpaceOnUse"
          patternTransform={transform}
        >
          <circle cx={1} cy={1} r={1} fill="#11111130" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#relay-dots)" />
      <g transform={transform}>
        {order.map((id) => (
          <ShapeView key={id} id={id} session={session} />
        ))}
        <SelectionLayer session={session} />
        {preview && (
          <rect
            x={preview.x}
            y={preview.y}
            width={preview.w}
            height={preview.h}
            fill="none"
            stroke={PALETTE.cobalt}
            strokeWidth={2 / camera.zoom}
            strokeDasharray={`${6 / camera.zoom} ${4 / camera.zoom}`}
            pointerEvents="none"
          />
        )}
      </g>
    </svg>
  );
}
