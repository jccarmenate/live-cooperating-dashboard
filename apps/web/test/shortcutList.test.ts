import { describe, expect, it } from 'vitest';
import { SHORTCUT_GROUPS } from '../src/ui/shortcutList';
import { TOOL_KEYS } from '../src/ui/shortcuts';

describe('SHORTCUT_GROUPS', () => {
  it('lists every tool key', () => {
    const tools = SHORTCUT_GROUPS.find((g) => g.title === 'Tools')?.items.map(([k]) => k) ?? [];
    for (const key of Object.keys(TOOL_KEYS)) expect(tools).toContain(key.toUpperCase());
  });

  it('lists the canvas UX shortcuts', () => {
    const all = SHORTCUT_GROUPS.flatMap((g) => g.items.map(([, what]) => what)).join(' | ');
    for (const what of ['Duplicate', 'Select all', 'Zoom to fit', 'Bring to front']) {
      expect(all).toContain(what);
    }
  });

  it('lists Backspace and Ctrl Y next to their twins', () => {
    const keys = SHORTCUT_GROUPS.flatMap((g) => g.items.map(([k]) => k));
    expect(keys).toContain('Del / Backspace');
    expect(keys).toContain('Ctrl Shift Z / Ctrl Y');
  });
});
