import {
  isHandle,
  PALETTE,
  type PointerInfo,
  type Preview,
  panBy,
  screenToWorld,
} from '@relay/core';
import { type MouseEvent, type PointerEvent, useRef, type WheelEvent } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { BoardSession } from '../board/session';
import { SelectionLayer } from './SelectionLayer';
import { ShapeView } from './ShapeView';

function PreviewShape({ preview, zoom }: { preview: Preview; zoom: number }) {
  const { kind, rect: r } = preview;
  const stroke = {
    stroke: PALETTE.cobalt,
    strokeWidth: 2 / zoom,
    strokeDasharray: `${6 / zoom} ${4 / zoom}`,
    pointerEvents: 'none' as const,
  };
  if (kind === 'line') {
    return <line x1={r.x} y1={r.y} x2={r.x + r.w} y2={r.y + r.h} {...stroke} />;
  }
  if (kind === 'ellipse') {
    return (
      <ellipse
        cx={r.x + r.w / 2}
        cy={r.y + r.h / 2}
        rx={r.w / 2}
        ry={r.h / 2}
        fill="none"
        {...stroke}
      />
    );
  }
  return (
    <rect
      data-testid={kind === 'marquee' ? 'marquee' : undefined}
      x={r.x}
      y={r.y}
      width={r.w}
      height={r.h}
      fill={kind === 'marquee' ? `${PALETTE.cobalt}14` : 'none'}
      {...stroke}
    />
  );
}

export function Canvas({ session }: { session: BoardSession }) {
  const { controller, publisher } = session;
  const order = useStore(
    session.doc,
    useShallow((s) => s.order),
  );
  const camera = useStore(controller.ui, (s) => s.camera);
  const preview = useStore(controller.ui, (s) => s.preview);
  const svgRef = useRef<SVGSVGElement>(null);

  const info = (e: PointerEvent | MouseEvent): PointerInfo => {
    const bounds = svgRef.current?.getBoundingClientRect();
    const screen = { x: e.clientX - (bounds?.left ?? 0), y: e.clientY - (bounds?.top ?? 0) };
    // Hit-test by position, not e.target: while the SVG holds pointer capture —
    // and for the click/dblclick that follows it — the browser retargets events
    // to the <svg> itself, which would hide the shape under the pointer.
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const hit = el?.closest('[data-shape-id]');
    const handle = el?.closest('[data-handle]')?.getAttribute('data-handle');
    return {
      world: screenToWorld(controller.ui.getState().camera, screen),
      shift: e.shiftKey,
      hitId: hit?.getAttribute('data-shape-id') ?? null,
      ...(isHandle(handle) ? { handle } : {}),
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
      onPointerCancel={() => controller.dispatch({ type: 'cancel' })}
      onLostPointerCapture={() => controller.dispatch({ type: 'cancel' })}
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
        {preview && <PreviewShape preview={preview} zoom={camera.zoom} />}
      </g>
    </svg>
  );
}
