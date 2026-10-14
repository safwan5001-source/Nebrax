// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { persistUser, type AuthUser } from './auth';
import { PERMISSION_REFRESH_MIN_INTERVAL_MS, useCan, usePermissionRefresh } from './use-can';

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
