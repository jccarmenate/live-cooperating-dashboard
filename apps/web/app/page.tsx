import Link from 'next/link';
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
        <div className="mt-8 flex flex-wrap items-start gap-3">
          <Link
            href="/r/demo"
            className="border-[3px] border-ink bg-sun px-5 py-3 font-display text-sm uppercase shadow-hard transition-transform active:translate-x-0.5 active:translate-y-0.5 active:shadow-hard-sm"
          >
            Open live demo
          </Link>
          <NewBoardButton />
        </div>
      </div>
    </main>
  );
}
