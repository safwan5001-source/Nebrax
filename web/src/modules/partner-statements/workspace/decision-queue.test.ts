import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { DecisionQueue } from './decision-queue';
import type { DecisionRequest, DecisionResponse } from './types';

const req = (line: string, extra: Partial<DecisionRequest> = {}): DecisionRequest => ({ run_id: 'run', line_id: line, action: 'confirm', ...extra });
const ok: DecisionResponse = { data: null, replayed: false, warnings: [] };

function harness(options: { send: (r: DecisionRequest) => Promise<DecisionResponse>; maxPerWindow?: number; windowMs?: number; backoffMs?: number[] }) {
  let clock = 0;
  const sleeps: number[] = [];
  const queue = new DecisionQueue({
    ...options,
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
    },
  });
  return { queue, sleeps, tick: (ms: number) => (clock += ms) };
}

describe('DecisionQueue', () => {
  it('sends strictly one at a time, in order', async () => {
    const order: string[] = [];
    let inFlight = 0;
    let maxInFlight = 0;
    const { queue } = harness({
      send: async (r) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        order.push(r.line_id);
        inFlight -= 1;
        return ok;
      },
    });
    const jobs = await Promise.all([queue.enqueue(req('a')), queue.enqueue(req('b')), queue.enqueue(req('c'))]);
    expect(order).toEqual(['a', 'b', 'c']);
    expect(maxInFlight).toBe(1);
    expect(jobs.map((job) => job.status)).toEqual(['done', 'done', 'done']);
  });

  it('never posts the same decision twice while one is pending (idempotent UI)', async () => {
    const send = vi.fn(async () => ok);
    const { queue } = harness({ send });
    const first = queue.enqueue(req('a'));
    const second = queue.enqueue(req('a'));
    const [one, two] = await Promise.all([first, second]);
    expect(send).toHaveBeenCalledTimes(1);
    expect(one.key).toBe(two.key);
  });

  it('allows an explicit re-submit of a finished decision (manual retry) as a new job', async () => {
    const send = vi.fn().mockRejectedValueOnce(new ApiError(422, 'x', { reason: 'reason_required' })).mockResolvedValueOnce(ok);
    const { queue } = harness({ send });
    const failed = await queue.enqueue(req('a'));
    expect(failed.status).toBe('failed');
    const retried = await queue.enqueue(req('a'));
    expect(retried.status).toBe('done');
    expect(send).toHaveBeenCalledTimes(2);
  });

  it('retries 429 with bounded backoff, then succeeds', async () => {
    const send = vi.fn().mockRejectedValueOnce(new ApiError(429, 'x', {})).mockRejectedValueOnce(new ApiError(429, 'x', {})).mockResolvedValueOnce(ok);
    const { queue, sleeps } = harness({ send, backoffMs: [1000, 2000, 4000] });
    const job = await queue.enqueue(req('a'));
    expect(job.status).toBe('done');
    expect(job.attempts).toBe(3);
    expect(sleeps).toEqual([1000, 2000]);
  });

  it('gives up after the backoff budget and reports failure (no infinite loop)', async () => {
    const send = vi.fn().mockRejectedValue(new ApiError(429, 'x', {}));
    const { queue } = harness({ send, backoffMs: [10, 20] });
    const job = await queue.enqueue(req('a'));
    expect(job.status).toBe('failed');
    expect(send).toHaveBeenCalledTimes(3);
    expect((job.error as ApiError).status).toBe(429);
  });

  it.each([[409], [422], [403], [500]])('does NOT auto-retry a %s — a financial decision is never silently re-sent', async (status) => {
    const send = vi.fn().mockRejectedValue(new ApiError(status, 'x', { reason: 'run_stale' }));
    const { queue, sleeps } = harness({ send });
    const job = await queue.enqueue(req('a'));
    expect(job.status).toBe('failed');
    expect(send).toHaveBeenCalledTimes(1);
    expect(sleeps).toEqual([]);
  });

  it('does NOT auto-retry a network failure (outcome unknown)', async () => {
    const send = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const { queue } = harness({ send });
    const job = await queue.enqueue(req('a'));
    expect(job.status).toBe('failed');
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('stays under the server window with a sliding window, waiting instead of sending the 51st', async () => {
    const times: number[] = [];
    let clockRef = () => 0;
    const h = harness({ send: async () => (times.push(clockRef()), ok), maxPerWindow: 3, windowMs: 60_000 });
    clockRef = () => h.sleeps.reduce((a, b) => a + b, 0);
    for (const line of ['a', 'b', 'c', 'd']) void h.queue.enqueue(req(line));
    await vi.waitFor(() => expect(times).toHaveLength(4));
    expect(h.sleeps.length).toBeGreaterThan(0);
    expect(times[3] - times[0]).toBeGreaterThanOrEqual(60_000);
  });

  it('keeps the lead job in `backoff` state visible with a countdown, and exposes the line job', async () => {
    const states: string[] = [];
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    const send = vi.fn().mockRejectedValueOnce(new ApiError(429, 'x', {})).mockResolvedValueOnce(ok);
    let clock = 0;
    const queue = new DecisionQueue({
      send,
      backoffMs: [8000],
      now: () => clock,
      sleep: async () => {
        await gate;
      },
      onChange: (jobs) => states.push(jobs.map((job) => `${job.status}:${job.retryInSeconds ?? '-'}`).join(',')),
    });
    const promise = queue.enqueue(req('a'));
    await vi.waitFor(() => expect(queue.jobFor('a')?.status).toBe('backoff'));
    expect(queue.jobFor('a')?.retryInSeconds).toBe(8);
    expect(queue.active).toBe(true);
    release();
    expect((await promise).status).toBe('done');
    expect(states).toContain('backoff:8');
    clock += 1;
    queue.clearFinished('a');
    expect(queue.jobFor('a')).toBeNull();
  });
});
