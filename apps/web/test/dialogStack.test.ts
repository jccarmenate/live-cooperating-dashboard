import { describe, expect, it } from 'vitest';
import { pushDialog } from '../src/ui/dialogStack';

describe('dialog stack', () => {
  it('lets only the topmost open dialog answer Escape', () => {
    const editor = pushDialog();
    expect(editor.isTop()).toBe(true);
    const question = pushDialog();
    expect(question.isTop()).toBe(true);
    expect(editor.isTop()).toBe(false);
    question.remove();
    expect(editor.isTop()).toBe(true);
    // Closing a lower dialog first leaves the top one on top.
    const again = pushDialog();
    editor.remove();
    expect(again.isTop()).toBe(true);
    again.remove();
    again.remove();
    expect(again.isTop()).toBe(false);
  });
});
