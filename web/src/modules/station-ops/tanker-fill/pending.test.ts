import { describe, expect, it } from 'vitest';
import type { FillBody } from './logic';
import { createPendingStore } from './pending';

const body: FillBody = { fuel_station_id: 's1', fuel_nozzle_id: 'n1', fuel_tanker_owner_id: 'o1', fuel_shift_id: 'sh1', voucher_number: '04052', quantity_milliliters: 2_000_000, idempotency_key: 'awj-ops-key12345' };

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return { getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k), clear: () => data.clear(), key: () => null, get length() { return data.size; } } as Storage;
}

describe('pending (unresolved) attempt store', () => {
  it('survives a "reload" (new store over the same storage) with the same body and key', () => {
    const storage = memoryStorage();
    createPendingStore('T|U|S', { storage }).save(body);
    expect(createPendingStore('T|U|S', { storage }).load()?.body).toEqual(body);
  });

  it('is scoped by tenant|user|station: another employee or station sees nothing', () => {
    const storage = memoryStorage();
    createPendingStore('T|U1|S1', { storage }).save(body);
    expect(createPendingStore('T|U2|S1', { storage }).load()).toBeNull();
    expect(createPendingStore('T|U1|S2', { storage }).load()).toBeNull();
  });

  it('clear removes it; elapsed time NEVER drops an unresolved attempt (only explicit settle does)', () => {
    const storage = memoryStorage();
    let now = 1_000;
    const store = createPendingStore('s', { storage, now: () => now });
    store.save(body);
    expect(store.load()).not.toBeNull();
    now += 30 * 24 * 60 * 60_000; // شهر لاحقاً (تبويب متروك مفتوحاً)
    expect(createPendingStore('s', { storage, now: () => now }).load()?.body).toEqual(body);
    store.clear();
    expect(createPendingStore('s', { storage }).load()).toBeNull();
  });

  it('re-saving the SAME attempt keeps its original start time; a different key restarts it', () => {
    const storage = memoryStorage();
    let now = 1_000;
    const store = createPendingStore('s', { storage, now: () => now });
    store.save(body);
    now = 90_000;
    store.save(body);
    expect(store.load()?.at).toBe(1_000);
    store.save({ ...body, idempotency_key: 'awj-ops-other999' });
    expect(store.load()?.at).toBe(90_000);
  });

  it('tolerates blocked/corrupt storage (falls back to memory, never throws)', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); }, removeItem: () => { throw new Error('blocked'); } } as unknown as Storage;
    const store = createPendingStore('s', { storage: broken });
    expect(() => store.save(body)).not.toThrow();
    expect(store.load()?.body.idempotency_key).toBe(body.idempotency_key);
    const corrupt = memoryStorage();
    corrupt.setItem('awj:fuel-ops:tanker-fill:pending:s', '{not json');
    expect(createPendingStore('s', { storage: corrupt }).load()).toBeNull();
  });

  it('stores only identifiers, quantity and voucher — never a token or personal data', () => {
    const storage = memoryStorage();
    createPendingStore('s', { storage }).save(body);
    const raw = storage.getItem('awj:fuel-ops:tanker-fill:pending:s')!;
    expect(raw).not.toMatch(/token|password|pin|phone|email|name/i);
  });
});
