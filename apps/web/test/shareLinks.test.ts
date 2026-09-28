import { describe, expect, it } from 'vitest';
import { shareLinks } from '../src/ui/shareLinks';

const base = { origin: 'https://relay.test', roomId: 'room1', page: 'main' };

describe('shareLinks', () => {
  it('offers no link before the role is known', () => {
    expect(shareLinks({ ...base, key: 'EDITKEY', role: null, viewKey: null })).toEqual({
      edit: null,
      view: null,
    });
  });

  it('gives an editor without a view key no view link yet', () => {
    const links = shareLinks({ ...base, key: 'EDITKEY', role: 'edit', viewKey: null });
    expect(links.edit).toBe('https://relay.test/r/room1#k=EDITKEY&p=main');
    expect(links.view).toBeNull();
  });

  it("never puts the editor's own key in the view link", () => {
    const links = shareLinks({ ...base, key: 'EDITKEY', role: 'edit', viewKey: 'VIEWKEY' });
    expect(links.edit).toBe('https://relay.test/r/room1#k=EDITKEY&p=main');
    expect(links.view).toBe('https://relay.test/r/room1#k=VIEWKEY&p=main');
    expect(links.view).not.toContain('EDITKEY');
  });

  it('gives a viewer no edit link and a view link with its own key', () => {
    expect(shareLinks({ ...base, key: 'VIEWKEY', role: 'view', viewKey: null })).toEqual({
      edit: null,
      view: 'https://relay.test/r/room1#k=VIEWKEY&p=main',
    });
  });

  it('encodes the page in the hash', () => {
    const links = shareLinks({
      ...base,
      page: 'p 1&x',
      key: 'EDITKEY',
      role: 'edit',
      viewKey: 'VIEWKEY',
    });
    expect(links.edit).toBe('https://relay.test/r/room1#k=EDITKEY&p=p%201%26x');
    expect(links.view).toBe('https://relay.test/r/room1#k=VIEWKEY&p=p%201%26x');
  });
});
