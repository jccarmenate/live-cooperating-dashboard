import { diffText, transformCaret, worldToScreen } from '@relay/core';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';

const STYLE_BY_TYPE: Record<string, string> = {
  sticky: 'p-3 text-[14px] font-semibold leading-snug',
  text: 'font-display text-[28px] uppercase leading-tight',
  rect: 'p-2 pt-[38px] text-center text-[13px] font-bold uppercase',
};

export function TextEditor({ session }: { session: BoardSession }) {
  const { controller } = session;
  const editingId = useStore(controller.ui, (s) => s.editingId);
  const shape = useStore(session.doc, (s) => (editingId ? s.shapes[editingId] : undefined));
  const camera = useStore(controller.ui, (s) => s.camera);
  const ref = useRef<HTMLTextAreaElement>(null);
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

  if (!editingId || !shape) return null;
  const pos = worldToScreen(camera, { x: shape.x, y: shape.y });

  return (
    <div
      className="absolute left-0 top-0 origin-top-left"
      style={{
        transform: `translate(${pos.x}px, ${pos.y}px) scale(${camera.zoom})`,
        width: shape.w,
        height: shape.h,
      }}
    >
      <textarea
        ref={ref}
        data-testid="text-editor"
        aria-label="Edit text"
        className={`size-full resize-none bg-transparent outline-none ${STYLE_BY_TYPE[shape.type] ?? STYLE_BY_TYPE.rect}`}
        onInput={(e) => {
          const next = e.currentTarget.value;
          const d = diffText(lastText.current, next);
          lastText.current = next;
          if (d) controller.applyText(editingId, d);
        }}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') e.currentTarget.blur();
        }}
        onBlur={() => controller.stopEditing()}
      />
    </div>
  );
}
