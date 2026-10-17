// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { blockedStatus, incomeResult, makeStatus, messageResponse } from './fixtures';

const api = vi.hoisted(() => ({
  fetchStatus: vi.fn(),
  sendMessage: vi.fn(),
  runTool: vi.fn(),
  saveSettings: vi.fn(),
  fetchAuditEvents: vi.fn(),
}));
vi.mock('../api', () => api);

let user: { id: string; tenant_id: string } | null = { id: 'u1', tenant_id: 't1' };
vi.mock('@/lib/use-can', () => ({ useCurrentUser: () => user }));

import { IntelligenceProvider, useIntelligence } from '../store';

const wrapper = ({ children }: { children: React.ReactNode }) => <IntelligenceProvider locale="en">{children}</IntelligenceProvider>;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const toolRun = (id = 'req-run') => ({ request_id: id, status: 'ok' as const, tool_calls: [{ tool: 'finance.income_statement' as const, result: incomeResult() }] });
const args = { tool: 'finance.income_statement' as const, arguments: { from: '2026-10-01', to: '2026-10-16' } };

beforeEach(() => {
  user = { id: 'u1', tenant_id: 't1' };
  Object.values(api).forEach((fn) => fn.mockReset());
});
afterEach(cleanup);

describe('zero unauthorized requests', () => {
  it('makes no financial request before the status has been read', async () => {
    const { result } = renderHook(() => useIntelligence(), { wrapper });
    let ok = true;
    await act(async () => { ok = await result.current.runFinancial(args); });
    expect(ok).toBe(false);
    expect(api.runTool).not.toHaveBeenCalled();
    expect(api.fetchStatus).not.toHaveBeenCalled(); // no status read until the panel/canvas asks
  });

  it.each(['permission_denied', 'platform_disabled', 'tenant_disabled', 'consent_required', 'provider_unavailable', 'currency_unsupported'] as const)(
    'never calls the tool or message endpoint when the server says %s',
    async (state) => {
      api.fetchStatus.mockResolvedValue(blockedStatus(state));
      const { result } = renderHook(() => useIntelligence(), { wrapper });
      await act(async () => { await result.current.refreshStatus(); });
      await act(async () => { await result.current.runFinancial(args); });
      await act(async () => { await result.current.send('income statement'); });
      expect(api.runTool).not.toHaveBeenCalled();
      expect(api.sendMessage).not.toHaveBeenCalled();
    },
  );

  it('allows the tool run only for the capability that is ready (chat ready, financial not)', async () => {
    api.fetchStatus.mockResolvedValue(makeStatus({ financial: 'consent_required' }));
    api.sendMessage.mockResolvedValue(messageResponse([]));
    const { result } = renderHook(() => useIntelligence(), { wrapper });
    await act(async () => { await result.current.refreshStatus(); });
    await act(async () => { await result.current.runFinancial(args); });
    expect(api.runTool).not.toHaveBeenCalled();
    await act(async () => { await result.current.send('hello'); });
    expect(api.sendMessage).toHaveBeenCalledWith({ message: 'hello', locale: 'en' });
  });

  it('ignores empty and over-long messages', async () => {
    api.fetchStatus.mockResolvedValue(makeStatus());
    const { result } = renderHook(() => useIntelligence(), { wrapper });
    await act(async () => { await result.current.refreshStatus(); });
    await act(async () => { await result.current.send('   '); await result.current.send('x'.repeat(2001)); });
    expect(api.sendMessage).not.toHaveBeenCalled();
  });
});

describe('results and errors', () => {
  it('records a successful explicit run and activates it', async () => {
    api.fetchStatus.mockResolvedValue(makeStatus());
    api.runTool.mockResolvedValue(toolRun());
    const { result } = renderHook(() => useIntelligence(), { wrapper });
    await act(async () => { await result.current.refreshStatus(); });
    await act(async () => { await result.current.runFinancial(args); });
    expect(api.runTool).toHaveBeenCalledTimes(1);
    expect(result.current.runs).toHaveLength(1);
    expect(result.current.activeRun?.source).toBe('canvas');
    expect(result.current.activeRun?.authorizationScope).toBeUndefined();
  });

  it('keeps the authorization scope of an assistant run (never a data filter) and the entry→run link', async () => {
    api.fetchStatus.mockResolvedValue(makeStatus());
    api.sendMessage.mockResolvedValue(messageResponse());
    const { result } = renderHook(() => useIntelligence(), { wrapper });
    await act(async () => { await result.current.refreshStatus(); });
    await act(async () => { await result.current.send('income statement'); });
    const entry = result.current.entries.find((e) => e.role === 'assistant');
    expect(entry?.runIds).toEqual([result.current.activeRun?.id]);
    expect(result.current.activeRun?.authorizationScope?.warehouse.mode).toBe('assigned');
  });

  it('maps a budget refusal to a state, shows no result and does not refresh status', async () => {
    api.fetchStatus.mockResolvedValue(makeStatus());
    api.sendMessage.mockRejectedValue(new ApiError(429, 'x', { error: { code: 'budget_exceeded', message: 'm' }, request_id: 'r' }));
    const { result } = renderHook(() => useIntelligence(), { wrapper });
    await act(async () => { await result.current.refreshStatus(); });
    await act(async () => { await result.current.send('income statement'); });
    const notice = result.current.entries.at(-1);
    expect(notice?.role).toBe('notice');
    expect(notice?.error?.notice).toBe('budget_exceeded');
    expect(result.current.runs).toHaveLength(0);
    expect(api.fetchStatus).toHaveBeenCalledTimes(1);
  });

  it('re-reads the status when consent was withdrawn between status read and request', async () => {
    api.fetchStatus.mockResolvedValueOnce(makeStatus()).mockResolvedValueOnce(blockedStatus('consent_required'));
    api.runTool.mockRejectedValue(new ApiError(403, 'x', { error: { code: 'consent_required', message: 'm' }, request_id: 'r' }));
    const { result } = renderHook(() => useIntelligence(), { wrapper });
    await act(async () => { await result.current.refreshStatus(); });
    await act(async () => { await result.current.runFinancial(args); });
    expect(result.current.financialError?.notice).toBe('consent_required');
    expect(result.current.status?.financial).toBe('consent_required');
    // the next click is now blocked locally
    await act(async () => { await result.current.runFinancial(args); });
    expect(api.runTool).toHaveBeenCalledTimes(1);
  });

  it('reports a status read failure without inventing a state', async () => {
    api.fetchStatus.mockRejectedValue(new TypeError('Failed to fetch'));
    const { result } = renderHook(() => useIntelligence(), { wrapper });
    await act(async () => { await result.current.refreshStatus(); });
    expect(result.current.statusPhase).toBe('error');
    expect(result.current.status).toBeNull();
    expect(result.current.statusError?.notice).toBe('network_error');
  });
});

describe('races, tenant switching and persistence', () => {
  it('drops an older response that arrives after a newer request', async () => {
    api.fetchStatus.mockResolvedValue(makeStatus());
    const first = deferred<ReturnType<typeof toolRun>>();
    const second = deferred<ReturnType<typeof toolRun>>();
    api.runTool.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useIntelligence(), { wrapper });
    await act(async () => { await result.current.refreshStatus(); });
    let a!: Promise<boolean>; let b!: Promise<boolean>;
    await act(async () => { a = result.current.runFinancial(args); b = result.current.runFinancial(args); });
    await act(async () => { second.resolve(toolRun('second')); await b; });
    await act(async () => { first.resolve(toolRun('first')); await a; });
    expect(result.current.runs.map((r) => r.requestId)).toEqual(['second']);
  });

  it('never shows the previous tenant’s result after switching tenant', async () => {
    api.fetchStatus.mockResolvedValue(makeStatus());
    const slow = deferred<ReturnType<typeof toolRun>>();
    api.runTool.mockReturnValueOnce(slow.promise);
    const { result, rerender } = renderHook(() => useIntelligence(), { wrapper });
    await act(async () => { await result.current.refreshStatus(); });
    let pending!: Promise<boolean>;
    await act(async () => { pending = result.current.runFinancial(args); });

    user = { id: 'u1', tenant_id: 't2' };
    rerender();
    expect(result.current.identity).toBe('t2:u1');
    expect(result.current.status).toBeNull(); // old tenant state is gone immediately
    expect(result.current.financialPending).toBe(false);

    await act(async () => { slow.resolve(toolRun('tenant-1-result')); await pending; });
    expect(result.current.runs).toHaveLength(0);
    expect(result.current.activeRun).toBeNull();
  });

  it('wipes conversation, runs and open panel on logout and drops a late status response', async () => {
    const lateStatus = deferred<ReturnType<typeof makeStatus>>();
    api.fetchStatus.mockReturnValueOnce(lateStatus.promise);
    const { result, rerender } = renderHook(() => useIntelligence(), { wrapper });
    let reading!: Promise<unknown>;
    act(() => { reading = result.current.refreshStatus(); });
    user = null;
    rerender();
    await act(async () => { lateStatus.resolve(makeStatus()); await reading; });
    expect(result.current.status).toBeNull();
    expect(result.current.identity).toBe('');
    // and without a session no request can start
    await act(async () => { await result.current.runFinancial(args); });
    expect(api.runTool).not.toHaveBeenCalled();
  });

  it('writes nothing to browser storage', async () => {
    const set = vi.spyOn(Storage.prototype, 'setItem');
    api.fetchStatus.mockResolvedValue(makeStatus());
    api.sendMessage.mockResolvedValue(messageResponse());
    api.runTool.mockResolvedValue(toolRun());
    const { result } = renderHook(() => useIntelligence(), { wrapper });
    await act(async () => { await result.current.refreshStatus(); });
    await act(async () => { await result.current.send('income statement'); await result.current.runFinancial(args); });
    expect(set).not.toHaveBeenCalled();
    set.mockRestore();
  });

  it('reads the status afresh each time the panel opens', async () => {
    api.fetchStatus.mockResolvedValue(makeStatus());
    const { result } = renderHook(() => useIntelligence(), { wrapper });
    await act(async () => { result.current.openPanel(); });
    await act(async () => { result.current.closePanel(); result.current.openPanel(); });
    expect(api.fetchStatus).toHaveBeenCalledTimes(2);
    expect(result.current.panelOpen).toBe(true);
  });
});
