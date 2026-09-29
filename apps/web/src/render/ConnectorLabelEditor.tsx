import {
  connectorPath,
  isAttached,
  MAX_CONNECTOR_LABEL,
  pathMidpoint,
  worldToScreen,
} from '@relay/core';
import { useLayoutEffect, useRef } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';

/** Inline input over the middle of a connector while its label is edited. */
export function ConnectorLabelEditor({ session }: { session: BoardSession }) {
  const { controller } = session;
  const id = useStore(controller.ui, (s) => s.editingConnector);
  const connector = useStore(session.doc, (d) => (id ? d.connectors[id] : undefined));
  const shapes = useStore(session.doc, (d) => d.shapes);
  const camera = useStore(controller.ui, (s) => s.camera);
  const ref = useRef<HTMLInputElement>(null);

  useLayoutEffect(() => {
    if (!id) return;
    ref.current?.focus();
    ref.current?.select();
  }, [id]);

  if (!id || !connector) return null;
  const lookup = {
    ...(isAttached(connector.from) && shapes[connector.from.shapeId]
      ? { [connector.from.shapeId]: shapes[connector.from.shapeId] }
      : {}),
    ...(isAttached(connector.to) && shapes[connector.to.shapeId]
      ? { [connector.to.shapeId]: shapes[connector.to.shapeId] }
      : {}),
  };
  const path = connectorPath(connector, lookup);
  if (!path) return null;
  const at = worldToScreen(camera, pathMidpoint(path));
  const commit = (value: string) => {
    if (controller.ui.getState().editingConnector === id) controller.setConnectorLabel(id, value);
  };
  return (
    <input
      ref={ref}
      data-testid="connector-label-input"
      aria-label="Connector label"
      defaultValue={connector.label ?? ''}
      maxLength={MAX_CONNECTOR_LABEL}
      className="absolute z-20 w-40 -translate-x-1/2 -translate-y-1/2 border-2 border-cobalt bg-white px-1.5 py-0.5 text-center font-mono text-xs outline-none"
      style={{ left: at.x, top: at.y }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
        if (e.key === 'Enter') {
          e.preventDefault();
          commit(e.currentTarget.value);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          controller.editConnectorLabel(null);
        }
      }}
      onBlur={(e) => commit(e.currentTarget.value)}
    />
  );
}
