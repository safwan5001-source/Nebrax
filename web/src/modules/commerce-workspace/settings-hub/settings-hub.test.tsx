// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const locale = vi.hoisted(() => ({ current: 'en' }));
vi.mock('next-intl', () => ({ useLocale: () => locale.current }));

const user = vi.hoisted(() => ({ value: { role: 'owner', permissions: ['*'] as string[] } as { role?: string; permissions?: string[] } | null }));
vi.mock('@/lib/auth', () => ({ currentUser: () => user.value }));

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

const store = vi.hoisted(() => ({ id: null as string | null }));
vi.mock('../store-context', () => ({ useOptionalCommerceStoreContext: () => (store.id ? { selectedStoreId: store.id } : null) }));

import { SettingsHub } from './settings-hub';

const linkHrefs = () => screen.queryAllByRole('link').map((a) => a.getAttribute('href'));

describe('SettingsHub (COPS-H4-1)', () => {
  beforeEach(() => {
    locale.current = 'en';
    user.value = { role: 'owner', permissions: ['*'] };
    store.id = null;
    apiMock.mockReset();
    apiMock.mockResolvedValue({ data: {} });
  });
  afterEach(cleanup);

  it('renders one link per section for the owner and performs read-only navigation (no writes)', async () => {
    render(<SettingsHub />);
    await waitFor(() => expect(linkHrefs()).toHaveLength(9));
    expect(linkHrefs()).toEqual([
      '/commerce/appearance',
      '/commerce/domains',
      '/commerce/delivery',
      '/commerce/shipping-zones',
      '/commerce/order-policies',
      '/commerce/store-operations',
      '/commerce/customer-accounts',
      '/commerce/gifting',
      '/commerce/integrations',
    ]);
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith('/applications/nav-state');
    expect(apiMock.mock.calls.every((call) => (call[1] as { method?: string } | undefined)?.method === undefined)).toBe(true);
  });

  it('keeps the active store on every link', async () => {
    store.id = 'store-1';
    render(<SettingsHub />);
    await waitFor(() => expect(linkHrefs()).toHaveLength(9));
    expect(linkHrefs().every((href) => href?.includes('store=store-1'))).toBe(true);
  });

  it('shows no cards while nav-state is loading (no flash of a disabled capability)', async () => {
    let release!: (value: unknown) => void;
    apiMock.mockReturnValue(new Promise((resolve) => (release = resolve)));
    render(<SettingsHub />);
    expect(screen.getByRole('status')).toBeTruthy();
    expect(linkHrefs()).toHaveLength(0);
    release({ data: {} });
    await waitFor(() => expect(linkHrefs()).toHaveLength(9));
  });

  it('hides the customer-accounts card when the storefront capability is off', async () => {
    apiMock.mockResolvedValue({ data: { 'commerce.storefront': false } });
    render(<SettingsHub />);
    await waitFor(() => expect(linkHrefs()).toHaveLength(7));
    expect(linkHrefs()).not.toContain('/commerce/customer-accounts');
  });

  it('a nav-state failure hides nothing (server routes stay guarded)', async () => {
    apiMock.mockRejectedValue(new Error('network'));
    render(<SettingsHub />);
    await waitFor(() => expect(linkHrefs()).toHaveLength(9));
  });

  it('a viewer with no permissions only gets the two ungated cards', async () => {
    user.value = { role: 'viewer', permissions: [] };
    render(<SettingsHub />);
    await waitFor(() => expect(linkHrefs()).toEqual(['/commerce/appearance', '/commerce/integrations']));
  });

  it('the ungated cards remain for a viewer-less session, so the empty state is not shown', async () => {
    user.value = null;
    render(<SettingsHub />);
    await waitFor(() => expect(linkHrefs()).toHaveLength(2));
    expect(screen.queryByText('No settings sections are available for your permissions.')).toBeNull();
  });

  it('renders Arabic copy under the ar locale', async () => {
    locale.current = 'ar';
    render(<SettingsHub />);
    await waitFor(() => expect(linkHrefs()).toHaveLength(9));
    expect(screen.getByRole('heading', { name: 'إعدادات المتجر' })).toBeTruthy();
  });
});
