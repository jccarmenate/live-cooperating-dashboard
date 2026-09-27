import { describe, expect, it } from 'vitest';
import { onPage } from '../src/render/pageFilter';

describe('onPage', () => {
  it('matches the peer page, treating a missing page as main', () => {
    expect(onPage({ page: 'p2' }, 'p2')).toBe(true);
    expect(onPage({ page: 'p2' }, 'main')).toBe(false);
    expect(onPage({ page: null }, 'main')).toBe(true);
    expect(onPage({ page: null }, 'p2')).toBe(false);
  });
});
