// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const locale = vi.hoisted(() => ({ current: 'en' }));
vi.mock('next-intl', () => {
  const t = Object.assign((key: string) => key, { rich: (key: string) => key });
  return { useLocale: () => locale.current, useTranslations: () => t };
});
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

const can = vi.hoisted(() => ({ allowed: new Set<string>() }));
vi.mock('@/lib/use-can', () => ({ useCan: () => ({ hydrated: true, can: (p: string) => can.allowed.has(p) }) }));
vi.mock('../../channel-context', () => ({
  useWholesaleChannel: () => ({ readiness: 'deployment_off', store: { id: 's1', name: 'Wholesale Store', salesChannelId: 'c1' }, channelId: 'c1' }),
}));

const toast = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => toast }));
const confirmMock = vi.hoisted(() => vi.fn());
vi.mock('@/components/ui/confirm-dialog', () => ({ useConfirm: () => confirmMock }));

const apiFns = vi.hoisted(() => ({
  loadOffers: vi.fn(),
  updateWorkspaceOffer: vi.fn(),
  deleteWorkspaceOffer: vi.fn(),
  createWorkspaceOffer: vi.fn(),
  searchEligibleProducts: vi.fn(),
}));
vi.mock('./api', async () => ({ ...(await vi.importActual<object>('./api')), ...apiFns }));

import { OffersSection } from './offers-section';

const offer = (over = {}) => ({
  id: 'o1', productId: 'p1', position: 0, product: { name: 'Rice 10kg', nameEn: null, thumbnailUrl: null },
  isActive: true, startsAt: null, endsAt: null, isLive: false, reason: 'not_discounted',
  referencePrice: null, offerPrice: null, discountPercent: null, ...over,
});
const live = offer({
  id: 'o2', productId: 'p2', product: { name: 'Oil', nameEn: null, thumbnailUrl: null }, isLive: true, reason: null,
  referencePrice: { amountMinor: 10000, currency: 'SAR' }, offerPrice: { amountMinor: 8500, currency: 'SAR' }, discountPercent: 15,
});

beforeEach(() => {
  locale.current = 'en';
  can.allowed = new Set(['commerce.manage']);
  Object.values(apiFns).forEach((fn) => fn.mockReset());
  apiFns.loadOffers.mockResolvedValue({ offers: [offer(), live], maxOffers: 12 });
  apiFns.updateWorkspaceOffer.mockResolvedValue({ ok: true, data: offer() });
  apiFns.deleteWorkspaceOffer.mockResolvedValue({ ok: true });
  confirmMock.mockReset().mockResolvedValue(true);
  toast.success.mockReset();
  toast.error.mockReset();
});
afterEach(cleanup);

describe('OffersSection', () => {
  it('shows server-evaluated state and prices without recomputing them', async () => {
    render(<OffersSection />);
    await waitFor(() => expect(screen.getAllByText('Rice 10kg').length).toBeGreaterThan(0));
    expect(apiFns.loadOffers).toHaveBeenCalledWith('s1');
    expect(screen.getAllByText('Channel price is not below the base price').length).toBeGreaterThan(0);
    expect(screen.getAllByText('15% off').length).toBeGreaterThan(0); // the server's number, shown verbatim
    expect(screen.getAllByText(/85/).length).toBeGreaterThan(0);
  });

  it('works while the deployment switch is off (configuration section) and names the discount blocker', async () => {
    render(<OffersSection />);
    await waitFor(() => screen.getAllByText('Oil'));
    const panel = screen.getByTestId('deferred-capability');
    expect(panel.textContent).toMatch(/D-B1/);
    expect(panel.querySelector('a')?.getAttribute('href')).toContain('/commerce/wholesale/price-lists');
  });

  it('toggles an offer through PATCH with only is_active', async () => {
    render(<OffersSection />);
    await waitFor(() => screen.getAllByText('Rice 10kg'));
    fireEvent.click(screen.getAllByRole('switch', { name: 'Disable offer: Rice 10kg' })[0]);
    await waitFor(() => expect(apiFns.updateWorkspaceOffer).toHaveBeenCalledWith('s1', 'o1', { isActive: false }));
  });

  it('deletes only after confirmation', async () => {
    confirmMock.mockResolvedValueOnce(false);
    render(<OffersSection />);
    await waitFor(() => screen.getAllByText('Rice 10kg'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    await waitFor(() => expect(confirmMock).toHaveBeenCalled());
    expect(apiFns.deleteWorkspaceOffer).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole('button', { name: 'Delete' })[0]);
    await waitFor(() => expect(apiFns.deleteWorkspaceOffer).toHaveBeenCalledWith('s1', 'o1'));
  });

  it('reports a failed toggle without claiming success', async () => {
    apiFns.updateWorkspaceOffer.mockResolvedValue({ ok: false, reason: 'failed', message: 'x', fieldErrors: {} });
    render(<OffersSection />);
    await waitFor(() => screen.getAllByText('Rice 10kg'));
    fireEvent.click(screen.getAllByRole('switch', { name: 'Disable offer: Rice 10kg' })[0]);
    await waitFor(() => expect(toast.error).toHaveBeenCalled());
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('creates an offer from an eligible product and shows the server conflict', async () => {
    apiFns.searchEligibleProducts.mockResolvedValue([{ id: 'p9', name: 'Sugar', nameEn: null, thumbnailUrl: null, isVariantManaged: false }, { id: 'p1', name: 'Rice 10kg' }]);
    apiFns.createWorkspaceOffer.mockResolvedValueOnce({ ok: false, reason: 'conflict', message: 'dup', fieldErrors: {} });
    render(<OffersSection />);
    await waitFor(() => screen.getAllByText('Rice 10kg'));
    fireEvent.click(screen.getByRole('button', { name: 'Add offer' }));
    fireEvent.change(await screen.findByLabelText('Search for an eligible product'), { target: { value: 'su' } });
    const option = await screen.findByRole('button', { name: 'Sugar' }, { timeout: 2000 });
    expect(screen.queryByRole('button', { name: 'Rice 10kg' })).toBeNull(); // already configured → not offered
    fireEvent.click(option);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => screen.getByText('This product is already configured as an offer.'));
    expect(apiFns.createWorkspaceOffer).toHaveBeenCalledWith('s1', expect.objectContaining({ productId: 'p9', isActive: true, startsAt: null, endsAt: null }));
  });

  it('rejects an end before its start without a request', async () => {
    render(<OffersSection />);
    await waitFor(() => screen.getAllByText('Rice 10kg'));
    fireEvent.click(screen.getAllByRole('button', { name: 'Edit' })[0]);
    fireEvent.change(await screen.findByLabelText('Starts'), { target: { value: '2026-12-02T10:00' } });
    fireEvent.change(screen.getByLabelText('Ends'), { target: { value: '2026-12-01T10:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => screen.getByText('The end of the window must be after its start.'));
    expect(apiFns.updateWorkspaceOffer).not.toHaveBeenCalled();
  });

  it('disables adding at the server-announced limit', async () => {
    apiFns.loadOffers.mockResolvedValue({ offers: [offer()], maxOffers: 1 });
    render(<OffersSection />);
    await waitFor(() => screen.getAllByText('Rice 10kg'));
    expect((screen.getByRole('button', { name: 'Add offer' }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('This store has reached its maximum number of offers.')).toBeTruthy();
  });

  it('is denied without commerce.manage and sends no request', () => {
    can.allowed = new Set();
    render(<OffersSection />);
    expect(screen.getByText('You do not have access to this section')).toBeTruthy();
    expect(apiFns.loadOffers).not.toHaveBeenCalled();
  });

  it('shows the permission state when the server answers 403', async () => {
    apiFns.loadOffers.mockRejectedValue(Object.assign(new Error('no'), { status: 403 }));
    render(<OffersSection />);
    await waitFor(() => screen.getByText('You do not have access to this section'));
  });

  it('shows an error with retry, and the empty state', async () => {
    apiFns.loadOffers.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 500 })).mockResolvedValue({ offers: [], maxOffers: 8 });
    render(<OffersSection />);
    await waitFor(() => screen.getByRole('alert'));
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    await waitFor(() => screen.getByText('No offers configured'));
  });

  it('renders Arabic', async () => {
    locale.current = 'ar';
    render(<OffersSection />);
    await waitFor(() => screen.getAllByText('Oil'));
    expect(screen.getByText('عروض المتجر')).toBeTruthy();
  });
});
