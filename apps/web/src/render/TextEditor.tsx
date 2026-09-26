import { diffText, transformCaret, worldToScreen } from '@relay/core';
import { useEffect, useLayoutEffect, useRef } from 'react';
import { useStore } from 'zustand';
import type { BoardSession } from '../board/session';
import { isCentered, TEXT_BOX, TEXT_STYLE } from './typography';
import { useShape } from './useShape';

export function TextEditor({ session }: { session: BoardSession }) {
  const { controller } = session;
  const editingId = useStore(controller.ui, (s) => s.editingId);
  const shape = useShape(session, editingId);
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

  const commitValue = (id: string, next: string) => {
    const d = diffText(lastText.current, next);
    lastText.current = next;
    if (d) controller.applyText(id, d);
  };

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
        className={`size-full resize-none bg-transparent outline-none ${TEXT_BOX[shape.type]} ${TEXT_STYLE[shape.type]}`}
        style={isCentered(shape.type) ? { paddingTop: Math.max(8, shape.h / 2 - 10) } : undefined}
        onInput={(e) => commitValue(editingId, e.currentTarget.value)}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') {
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
