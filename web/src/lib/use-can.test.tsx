// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { persistUser, type AuthUser } from './auth';
import { PERMISSION_REFRESH_MIN_INTERVAL_MS, useActorScope, useCan, usePermissionRefresh, type ActorScope } from './use-can';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('./api', async (importOriginal) => ({ ...(await importOriginal<typeof import('./api')>()), api: apiMock }));

const user = (over: Partial<AuthUser> = {}): AuthUser => ({
  id: 'u1', name: 'Safwan', email: 's@x.test', role: 'staff', tenant_id: 't1', permissions: ['invoices.view'], ...over,
});

function Probe() {
  const { can, hydrated } = useCan();
  return <p data-testid="p">{hydrated ? 'ready' : 'wait'}:{can('invoices.view') ? 'inv' : '-'}:{can('payments.view') ? 'pay' : '-'}</p>;
}

function Refresher({ enabled = true }: { enabled?: boolean }) {
  usePermissionRefresh(enabled);
  return <Probe />;
}

beforeEach(() => {
  localStorage.clear();
  apiMock.mockReset();
});
afterEach(cleanup);

describe('useCan', () => {
  it('denies without a stored user, then follows persistUser reactively', async () => {
    render(<Probe />);
    expect(screen.getByTestId('p').textContent).toBe('ready:-:-');
    act(() => persistUser(user(), { applyDisplayPreferences: false }));
    expect(screen.getByTestId('p').textContent).toBe('ready:inv:-');
    act(() => persistUser(user({ permissions: ['payments.view'] }), { applyDisplayPreferences: false }));
    expect(screen.getByTestId('p').textContent).toBe('ready:-:pay');
  });
});

describe('usePermissionRefresh', () => {
  it('re-reads /me on mount and adopts changed permissions without touching the rest', async () => {
    persistUser(user({ preferences: { locale: 'ar', theme: 'dark' } }), { applyDisplayPreferences: false });
    apiMock.mockResolvedValue({ user: user({ permissions: ['payments.view'], preferences: { locale: 'en', theme: 'light' } }) });
    render(<Refresher />);
    expect(screen.getByTestId('p').textContent).toBe('ready:inv:-');
    await waitFor(() => expect(screen.getByTestId('p').textContent).toBe('ready:-:pay'));
    expect(apiMock).toHaveBeenCalledWith('/me');
    expect(JSON.parse(localStorage.getItem('user')!).preferences).toEqual({ locale: 'ar', theme: 'dark' });
  });

  it('does nothing when disabled and swallows failures', async () => {
    persistUser(user(), { applyDisplayPreferences: false });
    const { rerender } = render(<Refresher enabled={false} />);
    expect(apiMock).not.toHaveBeenCalled();
    apiMock.mockRejectedValue(new Error('offline'));
    rerender(<Refresher enabled />);
    await waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
    expect(screen.getByTestId('p').textContent).toBe('ready:inv:-');
  });

  it('refreshes on focus only after the throttle window', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      persistUser(user(), { applyDisplayPreferences: false });
      apiMock.mockResolvedValue({ user: user() });
      render(<Refresher />);
      await vi.waitFor(() => expect(apiMock).toHaveBeenCalledTimes(1));
      await act(async () => {}); // يستقرّ الطلب الأول (يُفرَّغ inFlight)
      act(() => { window.dispatchEvent(new Event('focus')); });
      expect(apiMock).toHaveBeenCalledTimes(1);
      vi.setSystemTime(Date.now() + PERMISSION_REFRESH_MIN_INTERVAL_MS + 1);
      act(() => { window.dispatchEvent(new Event('focus')); });
      await vi.waitFor(() => expect(apiMock).toHaveBeenCalledTimes(2));
    } finally {
      vi.useRealTimers();
    }
  });
});

function ScopeProbe({ enabled = true, onScope }: { enabled?: boolean; onScope?: (scope: ActorScope | null | undefined) => void }) {
  const scope = useActorScope({ enabled });
  onScope?.(scope);
  return <p data-testid="s">{scope === undefined ? 'loading' : scope === null ? 'unknown' : `b=${scope.branches.join(',')}|w=${scope.warehouses.join(',')}`}</p>;
}

describe('useActorScope (AC-UX-11)', () => {
  it('reads the stored scope with no request; empty arrays are "unrestricted", never "unknown"', () => {
    persistUser(user({ branch_ids: [], warehouse_ids: [] }), { applyDisplayPreferences: false });
    render(<ScopeProbe />);
    expect(screen.getByTestId('s').textContent).toBe('b=|w=');
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('a stored restricted scope is returned as is', () => {
    persistUser(user({ branch_ids: ['b1'], warehouse_ids: ['w1', 'w2'] }), { applyDisplayPreferences: false });
    render(<ScopeProbe />);
    expect(screen.getByTestId('s').textContent).toBe('b=b1|w=w1,w2');
  });

  it('without a stored scope: loading, then one /me read adopts it and persists it', async () => {
    persistUser(user(), { applyDisplayPreferences: false });
    apiMock.mockResolvedValue({ user: user({ branch_ids: ['b1'], warehouse_ids: [] }) });
    render(<ScopeProbe />);
    expect(screen.getByTestId('s').textContent).toBe('loading');
    await waitFor(() => expect(screen.getByTestId('s').textContent).toBe('b=b1|w=')); 
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith('/me');
    expect(JSON.parse(localStorage.getItem('user')!).branch_ids).toEqual(['b1']);
  });

  it('does not need users.view: the scope comes from /me for a viewer without it', async () => {
    persistUser(user({ permissions: ['hr.manage', 'users.manage'] }), { applyDisplayPreferences: false });
    apiMock.mockResolvedValue({ user: user({ permissions: ['hr.manage', 'users.manage'], branch_ids: ['b1'], warehouse_ids: ['w1'] }) });
    render(<ScopeProbe />);
    await waitFor(() => expect(screen.getByTestId('s').textContent).toBe('b=b1|w=w1'));
    expect(apiMock.mock.calls.map((c) => c[0])).toEqual(['/me']);
  });

  it('settles to "unknown" (never "unrestricted") when /me fails or does not carry a scope', async () => {
    persistUser(user(), { applyDisplayPreferences: false });
    apiMock.mockRejectedValue(new Error('offline'));
    render(<ScopeProbe />);
    await waitFor(() => expect(screen.getByTestId('s').textContent).toBe('unknown'));
    cleanup();

    localStorage.clear();
    persistUser(user(), { applyDisplayPreferences: false });
    apiMock.mockReset();
    apiMock.mockResolvedValue({ user: user() }); // خادم أقدم: لا حقول نطاق
    render(<ScopeProbe />);
    await waitFor(() => expect(screen.getByTestId('s').textContent).toBe('unknown'));
  });

  it('enabled:false makes no request for a viewer who does not need the scope', async () => {
    persistUser(user(), { applyDisplayPreferences: false });
    render(<ScopeProbe enabled={false} />);
    await act(async () => {});
    expect(apiMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('s').textContent).toBe('loading');
  });

  it('keeps a stable reference across unrelated stored-user changes (permissions) and follows a real scope change', () => {
    persistUser(user({ branch_ids: ['b1'], warehouse_ids: [] }), { applyDisplayPreferences: false });
    const seen: (ActorScope | null | undefined)[] = [];
    render(<ScopeProbe onScope={(scope) => seen.push(scope)} />);
    const first = seen[seen.length - 1];
    act(() => persistUser(user({ permissions: ['payments.view'], branch_ids: ['b1'], warehouse_ids: [] }), { applyDisplayPreferences: false }));
    expect(seen[seen.length - 1]).toBe(first);
    act(() => persistUser(user({ branch_ids: ['b1', 'b2'], warehouse_ids: [] }), { applyDisplayPreferences: false }));
    expect(screen.getByTestId('s').textContent).toBe('b=b1,b2|w=');
  });

  it('shares one in-flight /me read between concurrent consumers', async () => {
    persistUser(user(), { applyDisplayPreferences: false });
    apiMock.mockResolvedValue({ user: user({ branch_ids: [], warehouse_ids: [] }) });
    render(<><ScopeProbe /><ScopeProbe /></>);
    await waitFor(() => expect(screen.getAllByTestId('s')[0].textContent).toBe('b=|w='));
    expect(apiMock).toHaveBeenCalledTimes(1);
  });

  it('preview (demo) mode is an unrestricted owner and makes no request', () => {
    localStorage.setItem('demo', 'true');
    persistUser(user(), { applyDisplayPreferences: false });
    render(<ScopeProbe />);
    expect(screen.getByTestId('s').textContent).toBe('b=|w=');
    expect(apiMock).not.toHaveBeenCalled();
  });
});
