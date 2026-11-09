import { describe, expect, it } from 'vitest';
import { mergeById } from './truncation-notice';

describe('mergeById (FS-31)', () => {
  it('appends only unseen rows and keeps order', () => {
    expect(mergeById([{ id: 'a' }, { id: 'b' }], [{ id: 'b' }, { id: 'c' }])).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }]);
  });
});
