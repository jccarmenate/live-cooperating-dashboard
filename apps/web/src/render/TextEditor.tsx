import { diffText, FRAME_TITLE_H, panBy, transformCaret, worldToScreen } from '@relay/core';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { MEDIA } from '../ui/responsive';
import { revealPan } from './reveal';
import { isCentered, TEXT_BOX, textStyle } from './typography';
import { useShape } from './useShape';

export function TextEditor({ session }: { session: BoardSession }) {
  const { controller } = session;
  const editingId = useStore(controller.ui, (s) => s.editingId);
  const shape = useShape(session, editingId);
  const camera = useStore(controller.ui, (s) => s.camera);
  const viewport = useStore(controller.ui, (s) => s.viewport);
  const ref = useRef<HTMLTextAreaElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const mounted = shape !== undefined;
  const lastText = useRef('');
  const lastEditingId = useRef<string | null>(null);

  // Mount: load current text, focus, caret at end.
  // biome-ignore lint/correctness/useExhaustiveDependencies: run only when the edited shape changes
  useEffect(() => {
    const el = ref.current;
    if (!el || !editingId) return;
    el.value = shape?.text ?? '';
    lastText.current = el.value;
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  }, [editingId]);

  // Remote edits: apply to the textarea while preserving the caret. Skip the
  // diff/caret mapping when editingId just changed (A -> B): the text swap
  // for the new shape belongs to the mount effect above, not to a remote
  // edit of the previously edited shape's text.
  useLayoutEffect(() => {
    const next = shape?.text ?? '';
    if (lastEditingId.current !== editingId) {
      lastEditingId.current = editingId;
      lastText.current = next;
      return;
    }
    const el = ref.current;
    if (!el || el.value === next) {
      lastText.current = next;
      return;
    }
    const d = diffText(el.value, next);
    const { selectionStart, selectionEnd } = el;
    el.value = next;
    lastText.current = next;
    if (d && document.activeElement === el) {
      el.setSelectionRange(transformCaret(selectionStart, d), transformCaret(selectionEnd, d));
    }
  }, [editingId, shape?.text]);

  // Touch screens: keep the text being edited above the on-screen keyboard. The keyboard
  // shrinks the board (Android) or only the visual viewport (iOS); either way the camera pans
  // until the shape is inside what is left. With a mouse the camera never moves by itself.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when editing starts and when the board is resized
  useEffect(() => {
    if (!editingId || !mounted || !window.matchMedia(MEDIA.coarse).matches) return;
    const reveal = () => {
      const host = box.current?.parentElement;
      const ui = controller.ui.getState();
      const s = session.doc.getState().shapes[editingId];
      if (!host || !ui.viewport || !s) return;
      const at = worldToScreen(ui.camera, { x: s.x, y: s.y });
      const h = s.type === 'frame' ? FRAME_TITLE_H : s.h;
      const edited = { x: at.x, y: at.y, w: s.w * ui.camera.zoom, h: h * ui.camera.zoom };
      // What the visual viewport shows of the board, in board px.
      const r = host.getBoundingClientRect();
      const vv = window.visualViewport;
      const left = Math.max(0, (vv?.offsetLeft ?? 0) - r.left);
      const top = Math.max(0, (vv?.offsetTop ?? 0) - r.top);
      const right = Math.min(ui.viewport.w, vv ? vv.offsetLeft + vv.width - r.left : ui.viewport.w);
      const bottom = Math.min(ui.viewport.h, vv ? vv.offsetTop + vv.height - r.top : ui.viewport.h);
      const pan = revealPan(edited, { x: left, y: top, w: right - left, h: bottom - top });
      if (pan.dx !== 0 || pan.dy !== 0) controller.setCamera(panBy(ui.camera, pan.dx, pan.dy));
    };
    reveal();
    const vv = window.visualViewport;
    vv?.addEventListener('resize', reveal);
    vv?.addEventListener('scroll', reveal);
    return () => {
      vv?.removeEventListener('resize', reveal);
      vv?.removeEventListener('scroll', reveal);
    };
  }, [editingId, mounted, viewport]);

  if (!editingId || !shape) return null;
  const pos = worldToScreen(camera, { x: shape.x, y: shape.y });
  const text = textStyle(shape);

  const commitValue = (id: string, next: string) => {
    const d = diffText(lastText.current, next);
    lastText.current = next;
    if (d) controller.applyText(id, d);
  };

  return (
    <div
      ref={box}
      className="absolute left-0 top-0 origin-top-left"
      style={{
        transform: `translate(${pos.x}px, ${pos.y}px) scale(${camera.zoom})`,
        width: shape.w,
        height: shape.type === 'frame' ? FRAME_TITLE_H : shape.h,
      }}
    >
      <textarea
        ref={ref}
        data-testid="text-editor"
        aria-label="Edit text"
        className={`size-full resize-none bg-transparent outline-none ${TEXT_BOX[shape.type]} ${text.className}`}
        style={{
          fontSize: text.fontSize,
          ...(isCentered(shape.type) ? { paddingTop: Math.max(8, shape.h / 2 - 10) } : {}),
        }}
        onInput={(e) => commitValue(editingId, e.currentTarget.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
            e.currentTarget.blur();
          } else if (e.key === 'Enter' && shape.type === 'frame' && !e.nativeEvent.isComposing) {
            // Frame titles are single-line: Enter commits (blur ends the editing session).
            e.preventDefault();
            e.currentTarget.blur();
          } else if (e.key === 'Tab' && shape.type === 'code') {
            e.preventDefault();
            const el = e.currentTarget;
            el.setRangeText('  ', el.selectionStart, el.selectionEnd, 'end');
            commitValue(editingId, el.value);
          }
        }}
        onBlur={() => controller.stopEditing()}
      />
    </div>
  );
}
