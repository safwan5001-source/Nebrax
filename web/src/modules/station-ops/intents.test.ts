import { describe, expect, it } from 'vitest';
import { draftKey, loadDraft, saveDraft, clearDraft, DRAFT_TTL_MS } from './drafts';
import { INTENT_TTL_MS, createIntentStore, evidenceKey } from './intents';

function fakeStorage(): Storage {
  const data = new Map<string, string>();
  return {
    get length() { return data.size; },
    clear: () => data.clear(),
    getItem: (k) => data.get(k) ?? null,
    key: (i) => [...data.keys()][i] ?? null,
    removeItem: (k) => { data.delete(k); },
    setItem: (k, v) => { data.set(k, v); },
  };
}

describe('intent store', () => {
  it('keeps ONE key per intent while the payload is unchanged (retry after a timeout reuses it)', () => {
    let n = 0;
    const store = createIntentStore('t|u|s', { storage: fakeStorage(), generate: () => `g${++n}` });
    const a = store.keyFor('open', { float: 100 });
    expect(store.keyFor('open', { float: 100 })).toBe(a);
    expect(n).toBe(1);
  });
  it('a different payload is a different intent ⇒ a NEW key (the server returns the FIRST effect of any known key)', () => {
    let n = 0;
    const store = createIntentStore('s', { storage: fakeStorage(), generate: () => `g${++n}` });
    const a = store.keyFor('cash', { amount: 100, reason: 'x' });
    const b = store.keyFor('cash', { amount: 101, reason: 'x' });
    expect(b).not.toBe(a);
  });
  it('survives a page reload (sessionStorage) and is cleared once the outcome is settled', () => {
    const storage = fakeStorage();
    const first = createIntentStore('scope', { storage, generate: () => 'AAA' }).keyFor('open', { f: 1 });
    const second = createIntentStore('scope', { storage, generate: () => 'BBB' });
    expect(second.keyFor('open', { f: 1 })).toBe(first);
    second.clear('open');
    expect(createIntentStore('scope', { storage, generate: () => 'CCC' }).keyFor('open', { f: 1 })).toBe('awj-ops-CCC');
  });
  it('is isolated per scope (tenant|user|station) and expires', () => {
    const storage = fakeStorage();
    let t = 0;
    const a = createIntentStore('A', { storage, now: () => t, generate: () => 'x1' }).keyFor('open', 1);
    const b = createIntentStore('B', { storage, now: () => t, generate: () => 'x2' }).keyFor('open', 1);
    expect(a).not.toBe(b);
    t = INTENT_TTL_MS + 1;
    expect(createIntentStore('A', { storage, now: () => t, generate: () => 'x3' }).keyFor('open', 1)).toBe('awj-ops-x3');
  });
  it('an UNCERTAIN intent keeps its key past the TTL and across a reload (elapsed time is not evidence the write never happened)', () => {
    const storage = fakeStorage();
    let t = 0;
    const first = createIntentStore('S', { storage, now: () => t, generate: () => 'u1' });
    const key = first.keyFor('cash', { a: 1 });
    first.markUncertain('cash');
    t = INTENT_TTL_MS * 10;
    const reloaded = createIntentStore('S', { storage, now: () => t, generate: () => 'u2' });
    expect(reloaded.isUncertain('cash')).toBe(true);
    expect(reloaded.keyFor('cash', { a: 1 })).toBe(key);
    expect(reloaded.keyFor('cash', { a: 2 })).not.toBe(key); // حمولة مختلفة = نية جديدة صريحة
    reloaded.clear('cash');
    expect(reloaded.isUncertain('cash')).toBe(false);
  });
  it('works with blocked storage (falls back to memory)', () => {
    const store = createIntentStore('s', { storage: null, generate: () => 'm' });
    expect(store.keyFor('open', 1)).toBe(store.keyFor('open', 1));
  });
});

describe('evidenceKey', () => {
  it('is deterministic per (kind, shift, asset, stage) and within the 128-char server limit', () => {
    const uuid = '9f1c2d3e-0000-4000-8000-000000000001';
    const key = evidenceKey('meter', uuid, uuid, 'opening');
    expect(key).toBe(evidenceKey('meter', uuid, uuid, 'opening'));
    expect(key.length).toBeLessThanOrEqual(128);
    expect(new Set([key, evidenceKey('meter', uuid, uuid, 'closing'), evidenceKey('tank', uuid, uuid, 'opening')]).size).toBe(3);
  });
  it('refuses to build a key the server would reject', () => {
    expect(() => evidenceKey('meter', 'x'.repeat(70), 'y'.repeat(70), 'opening')).toThrow();
  });
});

describe('drafts', () => {
  it('round-trips raw text, drops blanks, expires and clears', () => {
    // sessionStorage الحقيقي في jsdom غير متاح في بيئة node؛ نختبر المنطق عبر تعريف window مؤقت.
    const storage = fakeStorage();
    (globalThis as unknown as { window: unknown }).window = { sessionStorage: storage };
    try {
      const key = draftKey('t|u|s', 'shift1', 'opening');
      saveDraft(key, { n1: '125430.5', n2: '  ' }, 1_000);
      expect(loadDraft(key, 2_000)).toEqual({ n1: '125430.5' });
      expect(loadDraft(key, 1_000 + DRAFT_TTL_MS + 1)).toEqual({});
      expect(loadDraft(draftKey('t|u|OTHER', 'shift1', 'opening'), 2_000)).toEqual({});
      clearDraft(key);
      expect(loadDraft(key, 2_000)).toEqual({});
      saveDraft(key, { n1: '1' }, 1);
      saveDraft(key, { n1: '' }, 2);
      expect(storage.getItem(key)).toBeNull();
    } finally {
      delete (globalThis as unknown as { window?: unknown }).window;
    }
  });
});
