// @vitest-environment jsdom
import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useIngressPermissions } from './use-ingress-permissions';

const { api, currentUser } = vi.hoisted(() => ({ api: vi.fn(), currentUser: vi.fn() }));
vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('@/lib/auth', () => ({ currentUser }));

beforeEach(() => { api.mockReset(); currentUser.mockReset(); });
afterEach(() => vi.restoreAllMocks());

describe('useIngressPermissions (permission skeleton only)', () => {
  it('derives availability from the server permission list and the point status', () => {
    currentUser.mockReturnValue({ id: 'u', role: 'custom', permissions: ['delivery_connector.manage'] });
    const { result, rerender } = renderHook(({ status }) => useIngressPermissions({ status }), { initialProps: { status: 'configured' as 'configured' | 'disabled' } });
    expect(result.current).toEqual({ create: true, rotate: true, disable: true, reassign: false });
    rerender({ status: 'disabled' });
    expect(result.current).toEqual({ create: true, rotate: false, disable: false, reassign: false });
  });

  it('gives nothing to roles without the permissions and never touches the network', () => {
    currentUser.mockReturnValue({ id: 'u', role: 'accountant', permissions: ['invoices.view', 'reports.view', 'branches.view'] });
    const { result } = renderHook(() => useIngressPermissions({ status: 'configured' }));
    expect(result.current).toEqual({ create: false, rotate: false, disable: false, reassign: false });
    expect(api).not.toHaveBeenCalled();
  });

  it('with no point only "create" can be available', () => {
    currentUser.mockReturnValue({ id: 'u', role: 'owner', permissions: ['*'] });
    const { result } = renderHook(() => useIngressPermissions(null));
    expect(result.current).toEqual({ create: true, rotate: false, disable: false, reassign: false });
  });

  it('a signed-out user (no stored user) gets nothing', () => {
    currentUser.mockReturnValue(null);
    const { result } = renderHook(() => useIngressPermissions({ status: 'configured' }));
    expect(result.current).toEqual({ create: false, rotate: false, disable: false, reassign: false });
  });
});
