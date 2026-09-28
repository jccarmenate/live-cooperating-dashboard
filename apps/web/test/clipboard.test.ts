import { afterEach, describe, expect, it, vi } from 'vitest';
import { readClip } from '../src/ui/clipboard';

const stubRead = (readText: () => Promise<string>) =>
  vi.stubGlobal('navigator', { clipboard: { readText } });

describe('readClip', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns the system clipboard text', async () => {
    stubRead(async () => 'hello');
    expect(await readClip('in-app')).toBe('hello');
  });

  it('falls back when the browser refuses or the clipboard is empty', async () => {
    stubRead(async () => {
      throw new Error('denied');
    });
    expect(await readClip('in-app')).toBe('in-app');
    stubRead(async () => '');
    expect(await readClip('in-app')).toBe('in-app');
    expect(await readClip(null)).toBeNull();
  });
});
