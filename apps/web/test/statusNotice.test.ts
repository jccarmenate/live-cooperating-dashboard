import { describe, expect, it } from 'vitest';
import { statusNotice } from '../src/ui/statusNotice';

describe('statusNotice', () => {
  it('says nothing while the connection is working or simply offline', () => {
    for (const status of ['connecting', 'online', 'offline'] as const) {
      expect(statusNotice(status, false)).toBeNull();
    }
  });

  it('explains each stop and offers the way out', () => {
    expect(statusNotice('unauthorized', false)).toEqual({
      title: 'This link is invalid',
      body: 'Ask the board owner for a new share link.',
      action: 'home',
    });
    expect(statusNotice('crowded', false)).toEqual({
      title: 'This board has too many people right now',
      body: 'Try again in a moment.',
      action: 'retry',
    });
    expect(statusNotice('throttled', false)?.action).toBe('retry');
    expect(statusNotice('too-large', false)).toEqual({
      title: "Some changes couldn't be saved",
      body: 'A change was too large to sync.',
      action: 'reload',
    });
  });

  it('a refused change asks for a reload even while online', () => {
    expect(statusNotice('online', true)).toEqual({
      title: "Some changes couldn't be saved",
      body: 'The board was full when you made them.',
      action: 'reload',
    });
  });

  it('a stop wins over the unsaved notice', () => {
    expect(statusNotice('unauthorized', true)?.action).toBe('home');
  });
});
