import { describe, expect, it, vi } from 'vitest';
import { defaultDeps, runCreate, type FlowDeps, type FlowInput } from './create-flow';
import { EMPTY_FORM, evaluate, type FormValues } from './logic';
import type { Delivery, TankReading } from './schemas';

const form: FormValues = { ...EMPTY_FORM, supplierId: 's1', tankId: 't1', deliveryNote: 'DN-1', dispatched: '100', received: '99', before: '10', after: '109' };
const base = (over: Partial<FlowInput> = {}): FlowInput => ({ form, evaluation: evaluate(form, { hasWarehouse: true }), stationId: 'st', tankId: 't1', fuelProductId: 'fp', warehouseId: 'wh', intentKey: 'awj-ops-k', ...over });
const delivery = { id: 'd1', status: 'draft' } as unknown as Delivery;
const reading = (id: string, ml: number, key: string): TankReading => ({ id, fuel_tank_id: 't1', reading_type: 'physical', quantity_milliliters: ml, evidence_key: key });

function deps(over: Partial<FlowDeps> = {}): FlowDeps & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    recordReading: vi.fn(async (body) => { calls.push(`reading:${body.evidence_key}`); return { kind: 'ok', reading: reading(`r-${body.evidence_key.split(':').slice(-2)[0]}`, Math.round(Number(body.quantity_liters) * 1000), body.evidence_key) } as never; }),
    createDelivery: vi.fn(async (body) => { calls.push(`delivery:${body.idempotency_key}`); return { kind: 'ok', delivery } as never; }),
    findReadingByKey: vi.fn(async () => null),
    ...over,
  };
}

describe('create flow', () => {
  it('records before, after, then the draft — once each, in order, with deterministic keys and the linked ids', async () => {
    const d = deps();
    const result = await runCreate(base(), d);
    expect(result).toMatchObject({ kind: 'ok', delivery });
    expect(d.calls).toEqual(['reading:awj-ops:rcv:awj-ops-k:before:physical', 'reading:awj-ops:rcv:awj-ops-k:after:physical', 'delivery:awj-ops-k']);
    const body = vi.mocked(d.createDelivery).mock.calls[0][0];
    expect(body).toMatchObject({ before_physical_reading_id: 'r-before', after_physical_reading_id: 'r-after', received_liters: '99' });
    expect(body).not.toHaveProperty('received_total_cost_minor');
  });

  it('without readings it only creates the draft', async () => {
    const f = { ...form, before: '', after: '' };
    const d = deps();
    await runCreate(base({ form: f, evaluation: evaluate(f, { hasWarehouse: true }) }), d);
    expect(d.calls).toEqual(['delivery:awj-ops-k']);
  });

  it('skips readings already recorded by an earlier attempt of the same intent', async () => {
    const d = deps();
    await runCreate(base({ readingIds: { before: 'r-old' } }), d);
    expect(d.calls).toEqual(['reading:awj-ops:rcv:awj-ops-k:after:physical', 'delivery:awj-ops-k']);
    expect(vi.mocked(d.createDelivery).mock.calls[0][0]).toMatchObject({ before_physical_reading_id: 'r-old' });
  });

  it('a reading that already exists (retry) is looked up and reused only if its value matches', async () => {
    const exists = { kind: 'rejected', status: 422, code: 'evidence_exists', serverMessage: null } as never;
    const same = deps({ recordReading: vi.fn(async () => exists), findReadingByKey: vi.fn(async (_t, key) => reading('r-found', key.includes('before') ? 10_000 : 109_000, key)) });
    expect(await runCreate(base(), same)).toMatchObject({ kind: 'ok', readingIds: { before: 'r-found', after: 'r-found' } });

    const differs = deps({ recordReading: vi.fn(async () => exists), findReadingByKey: vi.fn(async (_t, key) => reading('r-x', 1, key)) });
    const stopped = await runCreate(base(), differs);
    expect(stopped).toMatchObject({ kind: 'stopped', stage: 'reading_before', failure: { kind: 'reading_conflict' } });
    expect(differs.createDelivery).not.toHaveBeenCalled();
  });

  it('stops at the first rejected reading and never creates the draft', async () => {
    const d = deps({ recordReading: vi.fn(async () => ({ kind: 'rejected', status: 403, code: 'forbidden', serverMessage: null }) as never) });
    const result = await runCreate(base(), d);
    expect(result).toMatchObject({ kind: 'stopped', stage: 'reading_before', failure: { kind: 'rejected', code: 'forbidden' } });
    expect(d.createDelivery).not.toHaveBeenCalled();
  });

  it('a lost reply on the draft is returned as unknown and NOT retried automatically', async () => {
    const d = deps({ createDelivery: vi.fn(async () => ({ kind: 'unknown', reason: 'network' }) as never) });
    const result = await runCreate(base(), d);
    expect(result).toMatchObject({ kind: 'stopped', stage: 'delivery', failure: { kind: 'unknown' }, readingIds: { before: 'r-before', after: 'r-after' } });
    expect(d.createDelivery).toHaveBeenCalledTimes(1);
  });

  it('an uncertain reading is verified by reading the server, not by re-sending blindly', async () => {
    const d = deps({
      recordReading: vi.fn(async () => ({ kind: 'unknown', reason: 'timeout' }) as never),
      findReadingByKey: vi.fn(async (_t, key) => reading('r-saved', key.includes('before') ? 10_000 : 109_000, key)),
    });
    const result = await runCreate(base(), d);
    expect(result).toMatchObject({ kind: 'ok', readingIds: { before: 'r-saved', after: 'r-saved' } });
    expect(d.recordReading).toHaveBeenCalledTimes(2);
  });

  it('exposes the real default dependencies', () => {
    expect(Object.keys(defaultDeps).sort()).toEqual(['createDelivery', 'findReadingByKey', 'recordReading']);
  });
});
