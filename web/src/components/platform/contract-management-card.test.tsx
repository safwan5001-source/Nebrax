/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '@/messages/en.json';
import { ContractManagementCard, type ContractSubscription } from './contract-management-card';

const { platformApi, ApiError } = vi.hoisted(() => {
  class ApiError extends Error {}
  return { platformApi: vi.fn(), ApiError };
});
const text = (key: string) => (en as unknown as Record<string, Record<string, string>>).platformTenants[key] as string;
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => text(key) ?? key }));
vi.mock('@/lib/platform-api', () => ({ platformApi }));
vi.mock('@/lib/api', () => ({ ApiError }));

const subs: ContractSubscription[] = [
  { id: 'sub-1', plan: 'pro', status: 'active', monthly_amount: '1500.50', currency: 'SAR', starts_on: '2026-01-01', ends_on: null },
  { id: 'sub-2', plan: 'basic', status: 'cancelled', monthly_amount: '300.00', currency: 'SAR', starts_on: '2025-01-01', ends_on: '2025-12-31' },
];

beforeEach(() => {
  platformApi.mockReset();
  platformApi.mockResolvedValue({});
});
afterEach(cleanup);

const posts = () => platformApi.mock.calls.filter(([, o]) => o?.method === 'POST');

function renderCard(onChanged = vi.fn().mockResolvedValue(undefined)) {
  render(<ContractManagementCard tenantId="tenant-1" subscriptions={subs} onChanged={onChanged} />);
  return onChanged;
}
// the card renders a table (lg) and cards (below lg) from the same rows; use the first match
const first = (name: string) => screen.getAllByRole('button', { name })[0] as HTMLElement;

describe('contract cancel and expire confirmations (H1-4B)', () => {
  it('cancel opens a confirm dialog, sends nothing, and never uses window.confirm', () => {
    const confirmSpy = vi.spyOn(window, 'confirm');
    renderCard();
    const opener = first(text('cancelContract'));
    opener.focus();
    fireEvent.click(opener);
    const dialog = screen.getByRole('dialog', { name: text('cancelContract') });
    expect(within(dialog).getByText(text('confirmCancelContract'))).toBeTruthy();
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: text('goBack') }));
    expect(posts()).toHaveLength(0);
    expect(confirmSpy).not.toHaveBeenCalled();
    confirmSpy.mockRestore();
  });

  it('Escape and Go back cancel without a request and return focus to the opener', () => {
    renderCard();
    const opener = first(text('cancelContract'));
    opener.focus();
    fireEvent.click(opener);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('button', { name: text('goBack') }));
    expect(document.activeElement).toBe(opener);
    expect(posts()).toHaveLength(0);
  });

  it('confirming cancel posts the same endpoint and body once, then refreshes and announces', async () => {
    const onChanged = renderCard();
    fireEvent.click(first(text('cancelContract')));
    const dialog = screen.getByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(text('effectiveOn')), { target: { value: '2026-11-01' } });
    fireEvent.change(within(dialog).getByLabelText(text('reason')), { target: { value: 'customer request' } });
    const confirm = within(dialog).getByRole('button', { name: text('cancelContract') });
    expect(confirm.className).toContain('bg-negative');
    fireEvent.click(confirm);
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]).toEqual(['/platform/subscriptions/sub-1/cancel', { method: 'POST', body: { effective_on: '2026-11-01', reason: 'customer request' } }]);
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect((await screen.findByRole('status')).textContent).toBe(text('contractCancelled'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('expire uses the same flow with the expire endpoint', async () => {
    renderCard();
    fireEvent.click(first(text('expireContract')));
    const dialog = screen.getByRole('dialog', { name: text('expireContract') });
    expect(within(dialog).getByText(text('confirmExpireContract'))).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(text('effectiveOn')), { target: { value: '2026-12-01' } });
    fireEvent.click(within(dialog).getByRole('button', { name: text('expireContract') }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]).toEqual(['/platform/subscriptions/sub-1/expire', { method: 'POST', body: { effective_on: '2026-12-01', reason: null } }]);
  });

  it('a failed confirmation keeps the dialog open and shows an alert; confirm needs an effective date', async () => {
    renderCard();
    fireEvent.click(first(text('cancelContract')));
    const dialog = screen.getByRole('dialog');
    platformApi.mockRejectedValueOnce(new ApiError('conflict'));
    fireEvent.click(within(dialog).getByRole('button', { name: text('cancelContract') }));
    expect((await screen.findByRole('alert')).textContent).toBe('conflict');
    expect(screen.getByRole('dialog')).toBeTruthy();
    fireEvent.change(within(screen.getByRole('dialog')).getByLabelText(text('effectiveOn')), { target: { value: '' } });
    expect((within(screen.getByRole('dialog')).getByRole('button', { name: text('cancelContract') }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('change contract (transition) keeps its form dialog and payload, with no confirm step added', async () => {
    renderCard();
    fireEvent.click(first(text('changeContract')));
    const dialog = screen.getByRole('dialog', { name: text('changeContract') });
    fireEvent.change(within(dialog).getByLabelText(text('plan')), { target: { value: 'enterprise' } });
    fireEvent.change(within(dialog).getByLabelText(text('effectiveOn')), { target: { value: '2026-11-15' } });
    fireEvent.click(within(dialog).getByRole('button', { name: text('transitionContract') }));
    await waitFor(() => expect(posts()).toHaveLength(1));
    expect(posts()[0]).toEqual(['/platform/subscriptions/sub-1/transition', { method: 'POST', body: { plan: 'enterprise', currency: 'SAR', effective_on: '2026-11-15', external_reference: null, reason: null } }]);
  });

  it('keeps the contracted amount formatting', () => {
    renderCard();
    expect(screen.getAllByText(/1,500\.50/).length).toBeGreaterThan(0);
  });
});
