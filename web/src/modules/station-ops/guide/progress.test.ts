// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { autoStartAllowed, currentRecord, progressKey, readProgress, withRecord, writeProgress } from './progress';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => void data.set(key, value), data };
}

describe('Smart Guide progress store', () => {
  it('keys progress per company and per user, so a shared device never leaks tours between employees', () => {
    expect(progressKey('t1', 'u1')).not.toBe(progressKey('t1', 'u2'));
    expect(progressKey('t1', 'u1')).not.toBe(progressKey('t2', 'u1'));
  });

  it('round-trips a record and keeps only well-formed entries', () => {
    const storage = memoryStorage();
    const key = progressKey('t', 'u');
    const record = { version: 1, status: 'completed' as const, step: 3, at: '2026-11-07T10:00:00.000Z' };
    writeProgress(key, withRecord({}, 'welcome', record), storage);
    expect(readProgress(key, storage)).toEqual({ welcome: record });

    storage.data.set(key, JSON.stringify({ welcome: record, shifts: { version: 'x' }, sales: { version: 1, status: 'weird', step: 0, at: '' }, stock: { ...record, step: -1 } }));
    expect(Object.keys(readProgress(key, storage))).toEqual(['welcome']);
  });

  it('survives unreadable, corrupt, or unavailable storage without throwing', () => {
    const key = progressKey('t', 'u');
    expect(readProgress(key, null)).toEqual({});
    expect(readProgress(key, memoryStorage({ [key]: '{not json' }))).toEqual({});
    expect(readProgress(key, memoryStorage({ [key]: '[1,2]' }))).toEqual({});
    expect(() => writeProgress(key, {}, { setItem: () => { throw new Error('quota'); } })).not.toThrow();
    expect(readProgress(key, { getItem: () => { throw new Error('blocked'); } })).toEqual({});
  });

  it('treats a record from an older tour version as not started, so a revised tour is offered again', () => {
    const map = withRecord({}, 'welcome', { version: 1, status: 'completed', step: 7, at: 'x' });
    expect(currentRecord(map, 'welcome', 1)?.status).toBe('completed');
    expect(currentRecord(map, 'welcome', 2)).toBeUndefined();
    expect(currentRecord(map, 'shifts', 1)).toBeUndefined();
  });

  it('never auto-starts under automated tests unless explicitly forced', () => {
    window.localStorage.removeItem('awj.station-guide.force');
    expect(autoStartAllowed()).toBe(false); // NODE_ENV === 'test'
    window.localStorage.setItem('awj.station-guide.force', '1');
    expect(autoStartAllowed()).toBe(true);
    window.localStorage.removeItem('awj.station-guide.force');
  });
});
