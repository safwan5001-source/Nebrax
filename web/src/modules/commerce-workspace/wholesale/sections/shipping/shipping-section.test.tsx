// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const locale = vi.hoisted(() => ({ current: 'en' }));
vi.mock('next-intl', () => {
  const t = (key: string) => key;
  return { useLocale: () => locale.current, useTranslations: () => t };
});
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const can = vi.hoisted(() => ({ allowed: new Set<string>() }));
vi.mock('@/lib/use-can', () => ({ useCan: () => ({ hydrated: true, can: (p: string) => can.allowed.has(p) }) }));

const channel = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('../../channel-context', () => ({ useWholesaleChannel: () => channel.value }));

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

const workspace = vi.hoisted(() => vi.fn());
vi.mock('@/modules/commerce-workspace/flowers-admin/delivery-workspace', () => ({
  DeliveryWorkspace: (props: { storeId: string }) => {
    workspace(props);
    return <div data-testid="delivery-workspace">{props.storeId}</div>;
  },
}));

import { ShippingSection } from './shipping-section';
import { SHIPPING_ZONES_PATH, mapShippingZones } from './api';

const zones = {
  data: [
    { id: 'z1', name: 'Dammam', match_type: 'city', match_value: 'Dammam', rate_amount_minor: 2500, is_active: true },
    { id: 'z2', name: 'Eastern', match_type: 'region', match_value: 'Eastern', rate_amount_minor: 4000, is_active: false },
  ],
};

describe('ShippingSection', () => {
  beforeEach(() => {
    locale.current = 'en';
    can.allowed = new Set(['commerce.manage']);
    channel.value = { readiness: 'deployment_off', channelId: 'c1', store: { id: 's1', name: 'Wholesale Store' } };
    apiMock.mockReset();
    workspace.mockReset();
    apiMock.mockResolvedValue(zones);
  });
  afterEach(cleanup);

  it('sends nothing and mounts nothing without commerce.manage', () => {
    can.allowed = new Set();
    render(<ShippingSection />);
    expect(screen.getByText('You do not have access to this section')).toBeTruthy();
    expect(apiMock).not.toHaveBeenCalled();
    expect(workspace).not.toHaveBeenCalled();
  });

  it('is a configuration section: works while the deployment switch is off, blocked only without a channel', () => {
    render(<ShippingSection />);
    expect(screen.getByTestId('delivery-workspace').textContent).toBe('s1');

    cleanup();
    channel.value = { readiness: 'no_channel', channelId: null, store: null };
    render(<ShippingSection />);
    expect(screen.queryByTestId('delivery-workspace')).toBeNull();
    expect(screen.getByText('This store has no sales channel')).toBeTruthy();
  });

  it('reuses the delivery workspace for the active store and reads shipping zones from the existing endpoint', async () => {
    render(<ShippingSection />);
    await waitFor(() => expect(screen.getAllByText('Dammam').length).toBeGreaterThan(0));
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith(SHIPPING_ZONES_PATH);
    expect(workspace).toHaveBeenCalledWith(expect.objectContaining({ storeId: 's1', locale: 'en' }));
    expect(screen.getAllByText(/25\.00/).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Inactive').length).toBeGreaterThan(0);
    expect(JSON.stringify(apiMock.mock.calls)).not.toContain('tenant');
  });

  it('lists zones read-only: no edit/delete/add controls', async () => {
    render(<ShippingSection />);
    await waitFor(() => expect(screen.getAllByText('Dammam').length).toBeGreaterThan(0));
    expect(screen.queryByRole('button', { name: /add|edit|delete|remove/i })).toBeNull();
  });

  it('states the exact blockers for wholesale-only freight and per-buyer delivery instead of faking controls', async () => {
    render(<ShippingSection />);
    await waitFor(() => expect(screen.getAllByText('Dammam').length).toBeGreaterThan(0));
    const deferred = screen.getAllByTestId('deferred-capability');
    expect(deferred).toHaveLength(2);
    expect(deferred[0].textContent).toMatch(/no model or API for freight rules/i);
    expect(deferred[1].textContent).toMatch(/D-B3/);
    for (const panel of deferred) expect(panel.querySelector('input,button,select')).toBeNull();
  });

  it('shows a retryable error when zones fail to load, without hiding the delivery workspace', async () => {
    apiMock.mockRejectedValue(Object.assign(new Error('x'), { status: 500 }));
    render(<ShippingSection />);
    await waitFor(() => expect(screen.getByText('Could not load shipping zones.')).toBeTruthy());
    expect(screen.getByTestId('delivery-workspace')).toBeTruthy();
  });

  it('renders in Arabic', async () => {
    locale.current = 'ar';
    render(<ShippingSection />);
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('الشحن والتوصيل');
    await waitFor(() => expect(screen.getAllByText('Dammam').length).toBeGreaterThan(0));
    expect(screen.getByText('مناطق الشحن')).toBeTruthy();
  });
});

describe('mapShippingZones', () => {
  it('drops malformed rows and tolerates a missing rate', () => {
    expect(mapShippingZones({ data: [{ id: 1 }, { id: 'a', name: 'A' }] })).toEqual([
      { id: 'a', name: 'A', matchType: '', matchValue: '', rateMinor: null, isActive: true },
    ]);
    expect(mapShippingZones(null)).toEqual([]);
  });
});
