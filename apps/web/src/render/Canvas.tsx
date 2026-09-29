import {
  isHandle,
  PALETTE,
  type PointerInfo,
  type Preview,
  panBy,
  screenToWorld,
  wheelZoomFactor,
} from '@relay/core';
import { type MouseEvent, type PointerEvent, useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import type { BoardSession } from '../board/session';
import { blurStrayFocus } from '../ui/typing';
import { ConnectorView } from './ConnectorView';
import { GraphOverlay } from './GraphOverlay';
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
  const frameOrder = useStore(
    session.doc,
    useShallow((s) => s.order.filter((id) => s.shapes[id]?.type === 'frame')),
  );
  const shapeOrder = useStore(
    session.doc,
    useShallow((s) => s.order.filter((id) => s.shapes[id]?.type !== 'frame')),
  );
  const connectorOrder = useStore(
    session.doc,
    useShallow((s) => s.connectorOrder),
  );
  const camera = useStore(controller.ui, (s) => s.camera);
  const preview = useStore(controller.ui, (s) => s.preview);
  const svgRef = useRef<SVGSVGElement>(null);
  const spaceHeld = useStore(controller.ui, (s) => s.spaceHeld);
  // Pan gestures bypass the tool FSM: the camera is view state, not a document edit.
  const pan = useRef<{ pointerId: number; x: number; y: number } | null>(null);
  const [panning, setPanning] = useState(false);

  // Measure the canvas so the controller can fit, centre and publish the viewport.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const measure = () => {
      const b = el.getBoundingClientRect();
      controller.setViewportSize(b.width, b.height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [controller]);

  // A native non-passive listener: React's onWheel is passive, so it could not stop the
  // browser's own ctrl+wheel page zoom. Ctrl/⌘+wheel (and pinch) zooms, a plain wheel pans.
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    // The listener sits on the container, not just the <svg>, so ctrl+wheel over an
    // overlay (minimap, zoom controls, toolbar) still zooms the board instead of the page.
    const target = el.parentElement ?? el;
    // `target`'s type is a union of two Elements, so TS can't resolve the 'wheel'-specific
    // addEventListener overload; take the generic Event and narrow it by hand.
    const onWheel = (evt: Event) => {
      const e = evt as globalThis.WheelEvent;
      // A plain wheel over a scrollable overlay (comment thread, panel, textareas) scrolls it natively.
      if (
        !e.ctrlKey &&
        !e.metaKey &&
        (evt.target as Element | null)?.closest?.('[data-scroll-region]')
      )
        return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : 1;
      if (e.ctrlKey || e.metaKey) {
        const b = el.getBoundingClientRect();
        controller.zoomBy(wheelZoomFactor(e.deltaY * unit), {
          x: e.clientX - b.left,
          y: e.clientY - b.top,
        });
      } else {
        const cam = controller.ui.getState().camera;
        controller.setCamera(panBy(cam, -e.deltaX * unit, -e.deltaY * unit));
      }
    };
    target.addEventListener('wheel', onWheel, { passive: false });
    return () => target.removeEventListener('wheel', onWheel);
  }, [controller]);

  const endPan = (e: PointerEvent<SVGSVGElement>): boolean => {
    if (pan.current?.pointerId !== e.pointerId) return false;
    pan.current = null;
    setPanning(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    return true;
  };

  const info = (e: PointerEvent | MouseEvent): PointerInfo => {
    const bounds = svgRef.current?.getBoundingClientRect();
    const screen = { x: e.clientX - (bounds?.left ?? 0), y: e.clientY - (bounds?.top ?? 0) };
    // Hit-test by position, not e.target: while the SVG holds pointer capture —
    // and for the click/dblclick that follows it — the browser retargets events
    // to the <svg> itself, which would hide the shape under the pointer.
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const hit = el?.closest('[data-shape-id]');
    const handle = el?.closest('[data-handle]')?.getAttribute('data-handle');
    const connectorId = el?.closest('[data-connector-id]')?.getAttribute('data-connector-id');
    const columnId = el?.closest('[data-column-id]')?.getAttribute('data-column-id');
    const frameId = columnId ? hit?.getAttribute('data-shape-id') : null;
    return {
      world: screenToWorld(controller.ui.getState().camera, screen),
      shift: e.shiftKey,
      hitId: hit?.getAttribute('data-shape-id') ?? null,
      ...(isHandle(handle) ? { handle } : {}),
      ...(connectorId ? { connectorId } : {}),
      ...(columnId && frameId ? { column: { frameId, columnId } } : {}),
    };
  };

  const transform = `scale(${camera.zoom}) translate(${camera.x} ${camera.y})`;

  return (
    <svg
      ref={svgRef}
      data-testid="canvas"
      aria-label="Board canvas"
      className="absolute inset-0 size-full touch-none select-none"
      style={{ cursor: panning ? 'grabbing' : spaceHeld ? 'grab' : undefined }}
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault();
      }}
      onPointerDown={(e) => {
        // The preventDefault calls below keep focus where it is; see blurStrayFocus. The
        // board-area editors keep their own focus rules below.
        blurStrayFocus(e.currentTarget.parentElement);
        if (e.button === 1 || (e.button === 0 && controller.ui.getState().spaceHeld)) {
          e.preventDefault();
          e.currentTarget.setPointerCapture(e.pointerId);
          pan.current = { pointerId: e.pointerId, x: e.clientX, y: e.clientY };
          setPanning(true);
          return;
        }
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
        // The column title and connector label inputs commit through their own blur.
        const { editingColumn, editingConnector } = controller.ui.getState();
        if (editingColumn || editingConnector) {
          (document.activeElement as HTMLElement | null)?.blur();
        }
        controller.dispatch({ type: 'pointerDown', p });
      }}
      onPointerMove={(e) => {
        const p = info(e);
        publisher.setCursor(p.world);
        controller.setPointer(p.world);
        const g = pan.current;
        if (g && g.pointerId === e.pointerId) {
          const cam = controller.ui.getState().camera;
          controller.setCamera(panBy(cam, e.clientX - g.x, e.clientY - g.y));
          pan.current = { ...g, x: e.clientX, y: e.clientY };
          return;
        }
        controller.dispatch({ type: 'pointerMove', p });
      }}
      onPointerUp={(e) => {
        if (endPan(e)) return;
        controller.dispatch({ type: 'pointerUp', p: info(e) });
        if (e.currentTarget.hasPointerCapture(e.pointerId)) {
          e.currentTarget.releasePointerCapture(e.pointerId);
        }
      }}
      onPointerCancel={(e) => {
        if (endPan(e)) return;
        if (controller.ui.getState().tool.mode !== 'idle') controller.dispatch({ type: 'cancel' });
      }}
      onLostPointerCapture={(e) => {
        if (endPan(e)) return;
        // Capture is also lost after every pointerUp: at rest a cancel changes nothing in the
        // tool, and must not reach the controller as an Escape (it clears algorithm results).
        if (controller.ui.getState().tool.mode !== 'idle') controller.dispatch({ type: 'cancel' });
      }}
      onPointerLeave={() => {
        publisher.setCursor(null);
        controller.setPointer(null);
      }}
      onDoubleClick={(e) => {
        // A pan never dispatches tool events: with Space held, Space's auto-repeat
        // would otherwise type spaces into the editor this just opened.
        if (controller.ui.getState().spaceHeld) return;
        const p = info(e);
        // A double-click on a connector (not on a shape) edits its label; editors only.
        if (!p.hitId && p.connectorId && session.conn.clock.getState().role === 'edit') {
          controller.editConnectorLabel(p.connectorId);
          return;
        }
        controller.dispatch({ type: 'doubleClick', p });
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        if (controller.ui.getState().spaceHeld) return;
        const p = info(e);
        controller.openMenu({
          screen: { x: e.clientX, y: e.clientY },
          world: p.world,
          hitId: p.hitId,
          connectorId: p.connectorId ?? null,
        });
      }}
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
        {frameOrder.map((id) => (
          <ShapeView key={id} id={id} session={session} />
        ))}
        {connectorOrder.map((id) => (
          <ConnectorView key={id} id={id} session={session} />
        ))}
        {shapeOrder.map((id) => (
          <ShapeView key={id} id={id} session={session} />
        ))}
        <SelectionLayer session={session} />
        <GraphOverlay session={session} />
        {preview && <PreviewShape preview={preview} zoom={camera.zoom} />}
      </g>
    </svg>
  );
}
