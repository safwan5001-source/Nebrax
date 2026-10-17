// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { DOC_ID, blockedStatus, docReadyStatus, documentProjection, makeStatus } from './fixtures';

const api = vi.hoisted(() => ({
  fetchStatus: vi.fn(),
  sendMessage: vi.fn(),
  runTool: vi.fn(),
  readDocument: vi.fn(),
  saveSettings: vi.fn(),
  fetchAuditEvents: vi.fn(),
}));
vi.mock('../api', () => api);

let user: { id: string; tenant_id: string } | null = { id: 'u1', tenant_id: 't1' };
vi.mock('@/lib/use-can', () => ({ useCurrentUser: () => user }));

import { IntelligenceProvider, useIntelligence } from '../store';

const wrapper = ({ children }: { children: React.ReactNode }) => <IntelligenceProvider locale="en">{children}</IntelligenceProvider>;
const run = (id = 'req-doc') => ({ request_id: id, status: 'ok' as const, tool_calls: [{ tool: 'documents.projected_read' as const, result: documentProjection() }] });
const code = (status: number, reason: string) => new ApiError(status, 'x', { error: { code: reason, message: 'm' }, request_id: 'r' });

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

beforeEach(() => {
  user = { id: 'u1', tenant_id: 't1' };
  Object.values(api).forEach((fn) => fn.mockReset());
});
afterEach(cleanup);

describe('document reads (AI-04) — zero unauthorized requests', () => {
  it('makes no request before the status is known', async () => {
    const { result } = renderHook(() => useIntelligence(), { wrapper });
    let ok = true;
    await act(async () => { ok = await result.current.readDocument(DOC_ID); });
    expect(ok).toBe(false);
    expect(api.readDocument).not.toHaveBeenCalled();
  });

  it.each(['permission_denied', 'platform_disabled', 'tenant_disabled', 'consent_required', 'category_unavailable', 'document_center_unavailable'] as const)(
    'never reads a document when the server says %s',
    async (state) => {
      api.fetchStatus.mockResolvedValue(blockedStatus(state, { document: state }));
      const { result } = renderHook(() => useIntelligence(), { wrapper });
      await act(async () => { await result.current.refreshStatus(); });
      await act(async () => { await result.current.readDocument(DOC_ID); });
      expect(api.readDocument).not.toHaveBeenCalled();
    },
  );

  it('never reads when only the other capabilities are ready', async () => {
    api.fetchStatus.mockResolvedValue(makeStatus({ chat: 'ready', financial: 'ready', document: 'consent_required' }));
    const { result } = renderHook(() => useIntelligence(), { wrapper });
    await act(async () => { await result.current.refreshStatus(); });
    await act(async () => { await result.current.readDocument(DOC_ID); });
    expect(api.readDocument).not.toHaveBeenCalled();
  });

  it('refuses anything that is not a UUID before any request (no paths, urls or text)', async () => {
    api.fetchStatus.mockResolvedValue(docReadyStatus());
    const { result } = renderHook(() => useIntelligence(), { wrapper });
    await act(async () => { await result.current.refreshStatus(); });
    for (const bad of ['../../etc/passwd', 'https://evil.example/x', "x' OR 1=1", '', 'PI-2026-0042']) {
      await act(async () => { await result.current.readDocument(bad); });
    }
    expect(api.readDocument).not.toHaveBeenCalled();
  });
});

describe('document reads — results, errors and isolation', () => {
  it('stores the projection in memory and lowercases the id sent to the server', async () => {
    api.fetchStatus.mockResolvedValue(docReadyStatus());
    api.readDocument.mockResolvedValue(run());
    const { result } = renderHook(() => useIntelligence(), { wrapper });
    await act(async () => { await result.current.refreshStatus(); });
    await act(async () => { await result.current.readDocument(DOC_ID.toUpperCase()); });
    expect(api.readDocument).toHaveBeenCalledWith(DOC_ID);
    expect(result.current.documentRun?.documentId).toBe(DOC_ID);
    expect(result.current.documentRun?.projection.document.status).toBe('ready_for_draft');
  });

  it.each(['document_on_hold', 'document_not_reviewed', 'document_review_stale', 'document_quarantined', 'document_retention_ended', 'document_scan_incomplete', 'document_projection_unavailable'] as const)(
    'turns the server refusal %s into a state with no data left on screen',
    async (reason) => {
      api.fetchStatus.mockResolvedValue(docReadyStatus());
      api.readDocument.mockResolvedValueOnce(run()).mockRejectedValueOnce(code(409, reason));
      const { result } = renderHook(() => useIntelligence(), { wrapper });
      await act(async () => { await result.current.refreshStatus(); });
      await act(async () => { await result.current.readDocument(DOC_ID); });
      expect(result.current.documentRun).not.toBeNull();
      await act(async () => { await result.current.readDocument(DOC_ID); });
      expect(result.current.documentError?.notice).toBe(reason);
      expect(result.current.documentRun).toBeNull(); // a refused refresh never leaves stale content behind
    },
  );

  it('an inaccessible document looks the same as a missing one and does not re-read the status', async () => {
    api.fetchStatus.mockResolvedValue(docReadyStatus());
    api.readDocument.mockRejectedValue(code(404, 'document_unavailable'));
    const { result } = renderHook(() => useIntelligence(), { wrapper });
    await act(async () => { await result.current.refreshStatus(); });
    await act(async () => { await result.current.readDocument(DOC_ID); });
    expect(result.current.documentError?.notice).toBe('document_unavailable');
    expect(api.fetchStatus).toHaveBeenCalledTimes(1);
  });

  it('re-reads the status when consent was withdrawn between status read and request, then blocks locally', async () => {
    api.fetchStatus.mockResolvedValueOnce(docReadyStatus()).mockResolvedValueOnce(blockedStatus('consent_required', { document: 'consent_required' }));
    api.readDocument.mockRejectedValue(code(403, 'consent_required'));
    const { result } = renderHook(() => useIntelligence(), { wrapper });
    await act(async () => { await result.current.refreshStatus(); });
    await act(async () => { await result.current.readDocument(DOC_ID); });
    expect(result.current.documentError?.notice).toBe('consent_required');
    expect(result.current.status?.document).toBe('consent_required');
    await act(async () => { await result.current.readDocument(DOC_ID); });
    expect(api.readDocument).toHaveBeenCalledTimes(1);
  });

  it('never shows the previous tenant’s document after switching tenant', async () => {
    api.fetchStatus.mockResolvedValue(docReadyStatus());
    const slow = deferred<ReturnType<typeof run>>();
    api.readDocument.mockReturnValueOnce(slow.promise);
    const { result, rerender } = renderHook(() => useIntelligence(), { wrapper });
    await act(async () => { await result.current.refreshStatus(); });
    let pending!: Promise<boolean>;
    await act(async () => { pending = result.current.readDocument(DOC_ID); });

    user = { id: 'u1', tenant_id: 't2' };
    rerender();
    expect(result.current.documentPending).toBe(false);
    expect(result.current.documentRun).toBeNull();
    await act(async () => { slow.resolve(run('tenant-1')); await pending; });
    expect(result.current.documentRun).toBeNull();
  });

  it('drops an older response that arrives after a newer one', async () => {
    api.fetchStatus.mockResolvedValue(docReadyStatus());
    const first = deferred<ReturnType<typeof run>>();
    const second = deferred<ReturnType<typeof run>>();
    api.readDocument.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    const { result } = renderHook(() => useIntelligence(), { wrapper });
    await act(async () => { await result.current.refreshStatus(); });
    let a!: Promise<boolean>; let b!: Promise<boolean>;
    await act(async () => { a = result.current.readDocument(DOC_ID); b = result.current.readDocument(DOC_ID); });
    await act(async () => { second.resolve(run('second')); await b; });
    await act(async () => { first.resolve(run('first')); await a; });
    expect(result.current.documentRun?.requestId).toBe('second');
  });

  it('clearDocument empties the memory and invalidates anything in flight', async () => {
    api.fetchStatus.mockResolvedValue(docReadyStatus());
    const slow = deferred<ReturnType<typeof run>>();
    api.readDocument.mockReturnValueOnce(slow.promise);
    const { result } = renderHook(() => useIntelligence(), { wrapper });
    await act(async () => { await result.current.refreshStatus(); });
    let pending!: Promise<boolean>;
    await act(async () => { pending = result.current.readDocument(DOC_ID); });
    act(() => result.current.clearDocument());
    await act(async () => { slow.resolve(run()); await pending; });
    expect(result.current.documentRun).toBeNull();
    expect(result.current.documentPending).toBe(false);
  });

  it('writes nothing to browser storage', async () => {
    const set = vi.spyOn(Storage.prototype, 'setItem');
    api.fetchStatus.mockResolvedValue(docReadyStatus());
    api.readDocument.mockResolvedValue(run());
    const { result } = renderHook(() => useIntelligence(), { wrapper });
    await act(async () => { await result.current.refreshStatus(); });
    await act(async () => { await result.current.readDocument(DOC_ID); });
    expect(set).not.toHaveBeenCalled();
    set.mockRestore();
  });
});
