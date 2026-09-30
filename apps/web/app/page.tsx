import { NewBoardButton } from '@/ui/NewBoardButton';

export default function Home() {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-xl border-[3px] border-ink bg-white p-8 shadow-hard">
        <div className="flex items-center gap-3">
          <span className="grid size-10 place-items-center bg-ink font-display text-paper">R</span>
          <h1 className="font-display text-3xl tracking-wide">RELAY</h1>
        </div>
        <p className="mt-4 font-mono text-sm leading-relaxed">
          A shared canvas where cursors, shapes and edits sync instantly between users.
        </p>
        <ul className="mt-5 grid gap-2 font-mono text-xs leading-relaxed">
          <li>▸ Stickies, shapes, connectors and frames — edited together, live.</li>
          <li>▸ Board, spreadsheet and calendar pages per room; graphs with live algorithms.</li>
          <li>▸ Pinned comments, timed dot voting, right-click menus, ? for board shortcuts.</li>
          <li>▸ No accounts: share an edit link or a read-only view link.</li>
        </ul>
        <div className="mt-8 flex flex-wrap items-start gap-3">
          <NewBoardButton />
        </div>
      </div>
    </main>
  );
}
