import { Fragment, useCallback } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { Dialog } from './Dialog';
import { MEDIA, useMediaQuery } from './responsive';
import { SHORTCUT_GROUPS, TOUCH_GROUP } from './shortcutList';

export function HelpDialog({ session }: { session: BoardSession }) {
  const { controller } = session;
  const open = useStore(controller.ui, (s) => s.help);
  const close = useCallback(() => controller.setHelp(false), [controller]);
  const touch = useMediaQuery(MEDIA.coarse);
  if (!open) return null;
  // Touch screens lead with the gestures; the keys still apply to an attached keyboard.
  const groups = touch ? [TOUCH_GROUP, ...SHORTCUT_GROUPS] : SHORTCUT_GROUPS;
  return (
    <Dialog title={touch ? 'Gestures and shortcuts' : 'Keyboard shortcuts'} onClose={close} wide>
      <div
        data-testid="help-dialog"
        data-scroll-region
        className="grid max-h-[60vh] gap-5 overflow-y-auto sm:grid-cols-2"
      >
        {groups.map((group) => (
          <section key={group.title}>
            <h3 className="font-mono text-2xs font-bold uppercase tracking-wider text-ink/60">
              {group.title}
            </h3>
            <dl className="mt-1.5 grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-1">
              {group.items.map(([keys, what]) => (
                <Fragment key={keys}>
                  <dt>
                    <kbd className="border border-ink/40 bg-paper px-1.5 py-px font-mono text-2xs">
                      {keys}
                    </kbd>
                  </dt>
                  <dd className="font-mono text-xs">{what}</dd>
                </Fragment>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </Dialog>
  );
}
