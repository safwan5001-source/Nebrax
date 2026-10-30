// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const locale = vi.hoisted(() => ({ current: 'en' }));
vi.mock('next-intl', () => {
  const t = Object.assign((key: string) => key, { rich: (key: string) => key });
  return { useLocale: () => locale.current, useTranslations: () => t };
});
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const can = vi.hoisted(() => ({ allowed: new Set<string>() }));
vi.mock('@/lib/use-can', () => ({ useCan: () => ({ hydrated: true, can: (p: string) => can.allowed.has(p) }) }));

const channel = vi.hoisted(() => ({
  applySettings: vi.fn(),
  reloadSettings: vi.fn(),
  store: { id: 's1', name: 'Wholesale Store', salesChannelId: 'c1' },
  settings: { status: 'ready', data: { default_price_list: { id: 'pl1', name: 'Wholesale A', is_active: true } } } as Record<string, unknown>,
}));
vi.mock('../../channel-context', () => ({
  useWholesaleChannel: () => ({
    readiness: 'active',
    store: channel.store,
    channelId: 'c1',
    settings: channel.settings,
    applySettings: channel.applySettings,
    reloadSettings: channel.reloadSettings,
  }),
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => toast }));
const confirmMock = vi.hoisted(() => vi.fn());
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => confirmMock }));

const apiFns = vi.hoisted(() => ({
  fetchPriceLists: vi.fn(),
  fetchPriceList: vi.fn(),
  fetchCustomerDefaults: vi.fn(),
  assignChannelPriceList: vi.fn(),
  deletePriceList: vi.fn(),
  collectPublishedProducts: vi.fn(),
  addPriceListItem: vi.fn(),
  removePriceListItem: vi.fn(),
  searchProducts: vi.fn(),
  createPriceList: vi.fn(),
  updatePriceList: vi.fn(),
}));
vi.mock('./api', async () => ({ ...(await vi.importActual<object>('./api')), ...apiFns }));

import { PriceListsSection } from './price-lists-section';

const lists = [
  { id: 'pl1', name: 'Wholesale A', description: null, is_active: true, items_count: 2 },
  { id: 'pl2', name: 'Old B', description: 'legacy', is_active: false, items_count: 0 },
  { id: 'pl3', name: 'Wholesale C', description: null, is_active: true, items_count: 1 },
];
const detail = {
  ...lists[0],
  items: [
    { id: 'i1', price_list_id: 'pl1', product_id: 'p1', product_name: 'Rice', product_sku: 'R1', unit_name: null, price: '12.50' },
    { id: 'i2', price_list_id: 'pl1', product_id: 'p2', product_name: 'Oil', product_sku: 'O1', unit_name: 'Carton', price: '90.00' },
  ],
};

beforeEach(() => {
  locale.current = 'en';
  can.allowed = new Set(['invoices.view', 'company.manage', 'partners.view', 'commerce.channel_settings.manage']);
  channel.settings = { status: 'ready', data: { default_price_list: { id: 'pl1', name: 'Wholesale A', is_active: true } } };
  channel.applySettings.mockReset();
  channel.reloadSettings.mockReset();
  channel.store = { id: 's1', name: 'Wholesale Store', salesChannelId: 'c1' };
  Object.values(apiFns).forEach((fn) => fn.mockReset());
  apiFns.fetchPriceLists.mockResolvedValue(lists);
  apiFns.fetchPriceList.mockResolvedValue(detail);
  apiFns.fetchCustomerDefaults.mockResolvedValue([
    { id: 'c1', name: 'Al Noor Trading', default_price_list_id: 'pl1' },
    { id: 'c2', name: 'Other', default_price_list_id: null },
  ]);
  apiFns.assignChannelPriceList.mockResolvedValue({ id: 'c1', default_price_list: { id: 'pl3', name: 'Wholesale C', is_active: true } });
  apiFns.collectPublishedProducts.mockResolvedValue({ products: [{ id: 'p1', name: 'Rice', sku: 'R1' }, { id: 'p9', name: 'Sugar', sku: 'S1' }], partial: false, serverTotal: 2 });
  confirmMock.mockReset().mockResolvedValue(true);
  toast.success.mockReset();
  toast.error.mockReset();
});
afterEach(cleanup);

describe('PriceListsSection', () => {
  it('lists price lists with status, item counts and the channel default marker', async () => {
    render(<PriceListsSection />);
    await waitFor(() => expect(screen.getAllByText('Old B').length).toBeGreaterThan(0));
    expect(screen.getAllByText('Channel list').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Inactive').length).toBeGreaterThan(0);
    // customers-per-list comes from real partner data
    await waitFor(() => expect(apiFns.fetchCustomerDefaults).toHaveBeenCalledOnce());
  });

  it('assigns the chosen active list to the channel and updates the context', async () => {
    render(<PriceListsSection />);
    await waitFor(() => screen.getByLabelText('Choose an active list'));
    const select = screen.getByLabelText('Choose an active list') as HTMLSelectElement;
    expect(within(select).queryByText('Old B')).toBeNull(); // inactive lists are not offered
    fireEvent.change(select, { target: { value: 'pl3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign to channel' }));
    await waitFor(() => expect(apiFns.assignChannelPriceList).toHaveBeenCalledWith('c1', 'pl3'));
    expect(channel.applySettings).toHaveBeenCalled();
    expect(toast.success).toHaveBeenCalledWith('List assigned to the channel');
  });

  it('clears the assignment with null', async () => {
    render(<PriceListsSection />);
    await waitFor(() => screen.getByRole('button', { name: 'Clear assignment' }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear assignment' }));
    await waitFor(() => expect(apiFns.assignChannelPriceList).toHaveBeenCalledWith('c1', null));
  });

  it('maps server reasons to friendly text and keeps the context untouched', async () => {
    apiFns.assignChannelPriceList.mockRejectedValue(Object.assign(new Error('x'), { status: 422, body: { reason: 'price_list_inactive' } }));
    render(<PriceListsSection />);
    await waitFor(() => screen.getByLabelText('Choose an active list'));
    fireEvent.change(screen.getByLabelText('Choose an active list'), { target: { value: 'pl3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Assign to channel' }));
    await waitFor(() => screen.getByText('The list is inactive; activate it first.'));
    expect(channel.applySettings).not.toHaveBeenCalled();
  });

  it('warns when the assigned list is inactive (silent fallback to base price)', async () => {
    channel.settings = { status: 'ready', data: { default_price_list: { id: 'pl2', name: 'Old B', is_active: false } } };
    render(<PriceListsSection />);
    await waitFor(() => screen.getByText(/silently falls back/));
  });

  it('hides assignment and edit controls without permission and sends no partner request', async () => {
    can.allowed = new Set(['invoices.view']);
    render(<PriceListsSection />);
    await waitFor(() => screen.getAllByText('Old B'));
    expect(screen.queryByRole('button', { name: 'Assign to channel' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'New list' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Delete list' })).toBeNull();
    expect(screen.getByText(/requires the “Manage channel settings” permission/)).toBeTruthy();
    expect(apiFns.fetchCustomerDefaults).not.toHaveBeenCalled();
  });

  it('deletes only after confirmation', async () => {
    apiFns.deletePriceList.mockResolvedValue(undefined);
    confirmMock.mockResolvedValueOnce(false);
    render(<PriceListsSection />);
    await waitFor(() => screen.getAllByText('Old B'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete list' })[0]);
    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(apiFns.deletePriceList).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete list' })[0]);
    await waitFor(() => expect(apiFns.deletePriceList).toHaveBeenCalled());
    // The shared channel snapshot is refreshed too, so Settings/Overview never keep describing a deleted list.
    await waitFor(() => expect(channel.reloadSettings).toHaveBeenCalledTimes(1));
  });

  it('refreshes the channel settings after editing a list (an assigned list may have been deactivated)', async () => {
    apiFns.updatePriceList.mockResolvedValue({ ...lists[0], is_active: false });
    render(<PriceListsSection />);
    await waitFor(() => screen.getAllByText('Wholesale A'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[0]);
    await waitFor(() => screen.getByText('Rice'));
    fireEvent.click(screen.getByRole('button', { name: 'Edit list' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Save' }));
    await waitFor(() => expect(apiFns.updatePriceList).toHaveBeenCalled());
    await waitFor(() => expect(channel.reloadSettings).toHaveBeenCalledTimes(1));
    // The drawer returns after the form closes.
    await waitFor(() => expect(screen.getByText('Rice')).toBeTruthy());
  });

  it('drops coverage results when the active store changes', async () => {
    const view = render(<PriceListsSection />);
    await waitFor(() => screen.getAllByText('Wholesale A'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[0]);
    await waitFor(() => screen.getByText('Rice'));
    fireEvent.click(screen.getByRole('button', { name: 'Run diagnostics' }));
    await waitFor(() => screen.getByText('50%'));

    channel.store = { id: 's2', name: 'Other Store', salesChannelId: 'c2' };
    view.rerender(<PriceListsSection />);
    await waitFor(() => expect(screen.queryByText('50%')).toBeNull());
    expect(screen.getByRole('button', { name: 'Run diagnostics' })).toBeTruthy();
  });

  it('shows an error state with retry', async () => {
    apiFns.fetchPriceLists.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 500 }));
    render(<PriceListsSection />);
    await waitFor(() => screen.getByRole('alert'));
    apiFns.fetchPriceLists.mockResolvedValue(lists);
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => screen.getAllByText('Old B'));
  });

  it('shows the empty state', async () => {
    apiFns.fetchPriceLists.mockResolvedValue([]);
    render(<PriceListsSection />);
    await waitFor(() => screen.getByText('No price lists'));
  });

  it('opens a list: items, customers using it, and runs coverage on real data', async () => {
    render(<PriceListsSection />);
    await waitFor(() => screen.getAllByText('Wholesale A'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[0]);
    await waitFor(() => expect(apiFns.fetchPriceList).toHaveBeenCalledWith('pl1'));
    await waitFor(() => screen.getByText('Rice'));
    expect(screen.getByText('Al Noor Trading')).toBeTruthy();
    expect(screen.queryByText('Other')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Run diagnostics' }));
    await waitFor(() => expect(apiFns.collectPublishedProducts).toHaveBeenCalledWith('s1'));
    await waitFor(() => screen.getByText('Products without a price in the list'));
    expect(screen.getByText('Sugar')).toBeTruthy(); // p9 has no item in the list
    expect(screen.getByText('50%')).toBeTruthy(); // 1 of 2
    expect(screen.queryByText(/Partial scan/)).toBeNull();
  });

  it('never presents a capped scan as a total', async () => {
    apiFns.collectPublishedProducts.mockResolvedValue({ products: [{ id: 'p1', name: 'Rice', sku: null }], partial: true, serverTotal: 4200 });
    render(<PriceListsSection />);
    await waitFor(() => screen.getAllByText('Wholesale A'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[0]);
    await waitFor(() => screen.getByText('Rice'));
    fireEvent.click(screen.getByRole('button', { name: 'Run diagnostics' }));
    await waitFor(() => screen.getByText(/Partial scan: the first 1 products of 4200/));
  });

  it('adds an item priced in minor units from a riyal input', async () => {
    apiFns.searchProducts.mockResolvedValue([{ id: 'p5', name: 'Flour', sku: 'F1', is_active: true, units: [{ name: 'Piece', factor: 1 }] }]);
    apiFns.addPriceListItem.mockResolvedValue({});
    render(<PriceListsSection />);
    await waitFor(() => screen.getAllByText('Wholesale A'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[0]);
    await waitFor(() => screen.getByLabelText('Search for a product'));
    fireEvent.change(screen.getByLabelText('Search for a product'), { target: { value: 'flo' } });
    const option = await screen.findByRole('button', { name: /Flour/ }, { timeout: 2000 });
    fireEvent.click(option);
    fireEvent.change(screen.getByLabelText('Price (SAR)'), { target: { value: '7.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(apiFns.addPriceListItem).toHaveBeenCalledWith('pl1', { product_id: 'p5', unit_name: null, price: 750 }));
  });

  it('rejects a malformed price client-side without a request', async () => {
    apiFns.searchProducts.mockResolvedValue([{ id: 'p5', name: 'Flour', sku: null, is_active: true, units: [] }]);
    render(<PriceListsSection />);
    await waitFor(() => screen.getAllByText('Wholesale A'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Open' })[0]);
    await waitFor(() => screen.getByLabelText('Search for a product'));
    fireEvent.change(screen.getByLabelText('Search for a product'), { target: { value: 'flo' } });
    fireEvent.click(await screen.findByRole('button', { name: /Flour/ }, { timeout: 2000 }));
    fireEvent.change(screen.getByLabelText('Price (SAR)'), { target: { value: '1.234' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => screen.getByText('Enter a valid price with at most two decimals.'));
    expect(apiFns.addPriceListItem).not.toHaveBeenCalled();
  });

  it('keeps buyer-specific pricing as an honest deferred panel', async () => {
    render(<PriceListsSection />);
    await waitFor(() => screen.getAllByText('Wholesale A'));
    expect(screen.getByTestId('deferred-capability').textContent).toMatch(/D-B1/);
  });

  it('renders Arabic', async () => {
    locale.current = 'ar';
    render(<PriceListsSection />);
    await waitFor(() => screen.getAllByText('Wholesale A'));
    expect(screen.getByText('تسعير قناة الجملة')).toBeTruthy();
  });
});
