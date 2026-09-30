import { worldToScreen } from '@relay/core';
import { Lock, LockOpen } from 'lucide-react';
import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { FONT_CLASS } from '../render/typography';
import { barMaxWidth, barPosition, selectionInfo } from './selectionInfo';
import {
  FILL_SWATCHES,
  STROKE_SWATCHES,
  type Swatch,
  sameColor,
  swatchBackground,
} from './swatches';

function Toggle({
  testId,
  label,
  pressed,
  disabled,
  onClick,
  className = '',
  children,
}: {
  testId: string;
  label: string;
  pressed: boolean;
  disabled?: boolean;
  onClick(): void;
  className?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={`grid h-7 min-w-7 place-items-center border-2 px-1 font-mono text-[11px] font-bold ${pressed ? 'border-ink bg-sun' : 'border-transparent hover:border-ink'} disabled:cursor-not-allowed disabled:opacity-40 ${className}`}
    >
      {children}
    </button>
  );
}

function Swatches({
  kind,
  swatches,
  current,
  disabled,
  onPick,
}: {
  kind: 'fill' | 'stroke';
  swatches: readonly Swatch[];
  current: string | null;
  disabled: boolean;
  onPick(color: string): void;
}) {
  return (
    <fieldset aria-label={kind === 'fill' ? 'Fill' : 'Stroke'} className="flex items-center gap-1">
      <span className="font-mono text-[9px] uppercase text-ink/50">{kind}</span>
      {swatches.map((s) => (
        <button
          key={s.name}
          type="button"
          data-testid={`props-${kind}-${s.name}`}
          aria-label={`${kind === 'fill' ? 'Fill' : 'Stroke'} ${s.label.toLowerCase()}`}
          title={s.label}
          aria-pressed={sameColor(current, s.color)}
          disabled={disabled}
          onClick={() => onPick(s.color)}
          className={`size-5 border-2 ${sameColor(current, s.color) ? 'border-cobalt outline-2 outline-cobalt' : 'border-ink'} disabled:cursor-not-allowed disabled:opacity-40`}
          style={{ background: swatchBackground(s.color) }}
        />
      ))}
    </fieldset>
  );
}

const Divider = () => <span className="h-5 w-px bg-ink/20" aria-hidden />;

/** Floating controls for the selection: fill, stroke, font, size, lock; routing and arrow for connectors. */
export function PropertiesBar({ session }: { session: BoardSession }) {
  const { controller } = session;
  const selection = useStore(controller.ui, (s) => s.tool.selection);
  const idle = useStore(controller.ui, (s) => s.tool.mode === 'idle');
  const camera = useStore(controller.ui, (s) => s.camera);
  const viewport = useStore(controller.ui, (s) => s.viewport);
  const shapes = useStore(session.doc, (d) => d.shapes);
  const connectors = useStore(session.doc, (d) => d.connectors);
  const canEdit = useStore(session.conn.clock, (c) => c.role === 'edit');
  const ref = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  // The toolbar's right edge (container px): the bar stays right of it, so the tools stay
  // reachable on a phone, where the bar would otherwise cover them.
  const [inset, setInset] = useState(0);

  // Measure after every render: the content (and so the width) depends on the selection, and
  // the toolbar grows a column on short screens.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    const tools = el.parentElement?.querySelector('[data-toolbar]');
    const box = el.parentElement?.getBoundingClientRect();
    const right = tools && box ? Math.round(tools.getBoundingClientRect().right - box.left) : 0;
    setInset(right);
  });

  const info = selectionInfo(selection, shapes, connectors);
  if (!canEdit || !idle || !info.bounds || !viewport) return null;
  const tl = worldToScreen(camera, { x: info.bounds.x, y: info.bounds.y });
  const target = {
    x: tl.x,
    y: tl.y,
    w: info.bounds.w * camera.zoom,
    h: info.bounds.h * camera.zoom,
  };
  const pos = barPosition(target, size, viewport, inset);
  const locked = info.allLocked;

  return (
    <div
      ref={ref}
      role="toolbar"
      aria-label="Selection properties"
      data-testid="props-bar"
      // Never wider than the room right of the toolbar; on a phone the swatches and toggles
      // scroll sideways instead of running off-screen.
      className="absolute z-20 flex items-center gap-2 overflow-x-auto border-[3px] border-ink bg-white px-2 py-1 shadow-hard"
      style={{ left: pos.left, top: pos.top, maxWidth: barMaxWidth(viewport.w, inset) }}
    >
      {info.shapes.length > 0 && (
        <>
          <Swatches
            kind="fill"
            swatches={FILL_SWATCHES}
            current={info.fill}
            disabled={locked}
            onPick={(fill) => controller.setStyle({ fill })}
          />
          <Divider />
          <Swatches
            kind="stroke"
            swatches={STROKE_SWATCHES}
            current={info.stroke}
            disabled={locked}
            onPick={(stroke) => controller.setStyle({ stroke })}
          />
          {info.textual && (
            <>
              <Divider />
              {(['sans', 'mono', 'display'] as const).map((font) => (
                <Toggle
                  key={font}
                  testId={`props-font-${font}`}
                  label={`Font ${font}`}
                  pressed={info.font === font}
                  disabled={locked}
                  onClick={() => controller.setStyle({ font })}
                  className={FONT_CLASS[font]}
                >
                  Aa
                </Toggle>
              ))}
              <Divider />
              {(['s', 'm', 'l'] as const).map((s) => (
                <Toggle
                  key={s}
                  testId={`props-size-${s}`}
                  label={`Text size ${s.toUpperCase()}`}
                  pressed={info.size === s}
                  disabled={locked}
                  onClick={() => controller.setStyle({ size: s })}
                >
                  {s.toUpperCase()}
                </Toggle>
              ))}
            </>
          )}
          <Divider />
          <Toggle
            testId="props-lock"
            label={locked ? 'Unlock' : 'Lock'}
            pressed={locked}
            onClick={() => controller.toggleLock()}
          >
            {locked ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}
          </Toggle>
        </>
      )}
      {info.connectors.length > 0 && (
        <>
          {info.shapes.length > 0 && <Divider />}
          <Toggle
            testId="props-routing"
            label="Elbow routing"
            pressed={info.routing === 'elbow'}
            onClick={() => controller.setRouting(info.routing === 'elbow' ? 'straight' : 'elbow')}
          >
            Elbow
          </Toggle>
          <Toggle
            testId="props-head"
            label="Arrow head"
            pressed={info.head === 'arrow'}
            onClick={() => controller.setHead(info.head === 'arrow' ? 'none' : 'arrow')}
          >
            Arrow
          </Toggle>
        </>
      )}
    </div>
  );
}
