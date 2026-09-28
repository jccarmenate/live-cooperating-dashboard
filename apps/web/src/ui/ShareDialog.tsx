import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { Dialog } from './Dialog';
import { shareLinks } from './shareLinks';
import { toast } from './toasts';

function LinkRow({ label, link, testId }: { label: string; link: string | null; testId: string }) {
  return (
    <label className="mt-3 block">
      <span className="font-mono text-[10px] uppercase text-ink/60">{label}</span>
      <div className="mt-1 flex gap-2">
        <input
          readOnly
          data-testid={`share-${testId}-link`}
          value={link ?? 'Connecting…'}
          className="flex-1 border-2 border-ink/30 px-2 py-1 font-mono text-xs"
          onFocus={(e) => e.currentTarget.select()}
        />
        <button
          type="button"
          data-testid={`share-copy-${testId}`}
          disabled={!link}
          className="border-2 border-ink px-3 font-mono text-xs font-bold uppercase hover:bg-sun disabled:opacity-40"
          onClick={async () => {
            if (!link) return;
            try {
              await navigator.clipboard.writeText(link);
              toast('Link copied');
            } catch {
              toast('Copy failed — select the link and copy it');
            }
          }}
        >
          Copy
        </button>
      </div>
    </label>
  );
}

export function ShareDialog({ session, onClose }: { session: BoardSession; onClose(): void }) {
  const page = useStore(session.doc, (d) => d.activePage);
  const role = useStore(session.conn.clock, (c) => c.role);
  const viewKey = useStore(session.conn.clock, (c) => c.viewKey);
  const links = shareLinks({
    origin: window.location.origin,
    roomId: session.roomId,
    key: session.key,
    role,
    viewKey,
    page,
  });
  return (
    <Dialog title="Share board" onClose={onClose}>
      <p className="font-mono text-xs text-ink/70">
        Anyone with a link can open this board. No accounts.
      </p>
      {role === 'edit' && <LinkRow label="Can edit" link={links.edit} testId="edit" />}
      <LinkRow label="Can view" link={links.view} testId="view" />
    </Dialog>
  );
}
