import { PALETTE } from '@relay/core';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';

const PAD = 4;

export function SelectionLayer({ session }: { session: BoardSession }) {
  const selection = useStore(session.controller.ui, (s) => s.tool.selection);
  const zoom = useStore(session.controller.ui, (s) => s.camera.zoom);
  const shapes = useStore(session.doc, (s) => s.shapes);
  const peers = useStore(session.presence, (s) => s.peers);
  const stroke = 2 / zoom;

  const single = selection.length === 1 ? shapes[selection[0] ?? ''] : undefined;

  return (
    <g pointerEvents="none">
      {peers.flatMap((peer) =>
        peer.selection.map((id) => {
          const s = shapes[id];
          if (!s) return null;
          return (
            <g key={`${peer.clientId}:${id}`}>
              <rect
                x={s.x - PAD}
                y={s.y - PAD}
                width={s.w + PAD * 2}
                height={s.h + PAD * 2}
                fill="none"
                stroke={peer.user.color}
                strokeWidth={stroke}
                strokeDasharray={`${6 / zoom} ${4 / zoom}`}
              />
            </g>
          );
        }),
      )}
      {selection.map((id) => {
        const s = shapes[id];
        if (!s) return null;
        return (
          <rect
            key={id}
            x={s.x - PAD}
            y={s.y - PAD}
            width={s.w + PAD * 2}
            height={s.h + PAD * 2}
            fill="none"
            stroke={PALETTE.cobalt}
            strokeWidth={stroke}
          />
        );
      })}
      {single && (
        <g
          transform={`translate(${single.x + single.w / 2} ${single.y + single.h + PAD + 8 / zoom}) scale(${1 / zoom})`}
        >
          <rect x={-36} y={0} width={72} height={18} fill={PALETTE.cobalt} />
          <text
            x={0}
            y={13}
            textAnchor="middle"
            fill={PALETTE.white}
            className="font-mono"
            fontSize={10}
          >
            {`${Math.round(single.w)} × ${Math.round(single.h)}`}
          </text>
        </g>
      )}
    </g>
  );
}
