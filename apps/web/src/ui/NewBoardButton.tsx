'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { SYNC_HTTP } from '@/config';

export function NewBoardButton() {
  const router = useRouter();
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle');

  async function create() {
    setState('busy');
    try {
      const res = await fetch(`${SYNC_HTTP}/api/rooms`, { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { roomId, editKey } = (await res.json()) as { roomId: string; editKey: string };
      router.push(`/r/${roomId}#k=${encodeURIComponent(editKey)}`);
    } catch {
      setState('error');
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={create}
        disabled={state === 'busy'}
        className="border-[3px] border-ink bg-white px-5 py-3 font-display text-sm uppercase shadow-hard transition-transform active:translate-x-0.5 active:translate-y-0.5 active:shadow-hard-sm disabled:opacity-60"
      >
        {state === 'busy' ? 'Creating…' : 'New board'}
      </button>
      {state === 'error' && (
        <p role="alert" className="font-mono text-xs text-flame">
          Sync server unreachable. Is it running on {SYNC_HTTP}?
        </p>
      )}
    </div>
  );
}
