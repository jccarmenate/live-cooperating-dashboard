import { worldToScreen } from '@relay/core';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';

export function RemoteCursors({ session }: { session: BoardSession }) {
  const peers = useStore(session.presence, (s) => s.peers);
  const camera = useStore(session.controller.ui, (s) => s.camera);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {peers.map((peer) => {
        if (!peer.cursor) return null;
        const p = worldToScreen(camera, peer.cursor);
        return (
          <div
            key={peer.clientId}
            data-testid="remote-cursor"
            className="absolute left-0 top-0 transition-transform duration-75 ease-linear"
            style={{ transform: `translate(${p.x}px, ${p.y}px)` }}
          >
            <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
              <path
                d="M1 1 L1 15 L5 11 L9 17 L11 16 L7 10 L13 10 Z"
                fill={peer.user.color}
                stroke="#111"
                strokeWidth="1.5"
              />
            </svg>
            <span
              className="ml-3 inline-block border-2 border-ink px-1.5 font-mono text-[10px] font-bold text-white"
              style={{ background: peer.user.color }}
            >
              {peer.user.name}
            </span>
          </div>
        );
      })}
    </div>
  );
}
