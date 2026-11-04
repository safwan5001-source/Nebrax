// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const locale = vi.hoisted(() => ({ current: 'en' }));
vi.mock('next-intl', () => ({ useLocale: () => locale.current, useTranslations: () => (key: string) => key }));

const can = vi.hoisted(() => ({ allowed: new Set<string>(), hydrated: true }));
vi.mock('@/lib/use-can', () => ({ useCan: () => ({ hydrated: can.hydrated, can: (p: string) => can.allowed.has(p) }) }));

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

import { ToastProvider } from '@/components/ui/toast';
import { OrderPoliciesScreen, saveErrorKey } from './order-policies-screen';

const sales = (over: Record<string, unknown> = {}) => ({
  data: { commerce_payment_hold_minutes: 60, commerce_invoice_trigger: 'none', commerce_price_tax_mode: null, commerce_partner_policy: 'link_verified_else_create', ...over },
});
const apiError = (status: number) => Object.assign(new Error('x'), { status });
const mount = () => render(<ToastProvider><OrderPoliciesScreen /></ToastProvider>);
const puts = () => apiMock.mock.calls.filter((c) => (c[1] as { method?: string } | undefined)?.method === 'PUT');
const input = () => screen.getByLabelText('Duration (minutes)') as HTMLInputElement;

describe('OrderPoliciesScreen (COPS-H4-5)', () => {
  beforeEach(() => {
    locale.current = 'en';
    can.allowed = new Set(['invoices.view', 'company.manage']);
    can.hydrated = true;
    apiMock.mockReset();
    apiMock.mockResolvedValue(sales());
  });
  afterEach(cleanup);

  it('without invoices.view nothing is requested and a forbidden state is shown', () => {
    can.allowed = new Set(['company.manage']);
    mount();
    expect(screen.getByText('You do not have access to this screen')).toBeTruthy();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('shows the hold time and the accounting policies as read-only values with readable labels', async () => {
    apiMock.mockResolvedValue(sales({ commerce_price_tax_mode: 'inclusive', commerce_invoice_trigger: 'on_payment_confirmed', commerce_partner_policy: 'manual_link' }));
    mount();
    await waitFor(() => expect(input().value).toBe('60'));
    expect(screen.getByTestId('readonly-invoiceTrigger').textContent).toBe('When payment is confirmed');
    expect(screen.getByTestId('readonly-priceTaxMode').textContent).toBe('Tax-inclusive prices');
    expect(screen.getByTestId('readonly-partnerPolicy').textContent).toBe('Manual link (no automatic party)');
    expect(apiMock).toHaveBeenCalledWith('/sales-settings');
  });

  it('an unset price mode reads "Not set (closed)" and an unknown server value is shown verbatim, never invented', async () => {
    apiMock.mockResolvedValue(sales({ commerce_partner_policy: 'something_new' }));
    mount();
    await waitFor(() => expect(screen.getByTestId('readonly-priceTaxMode').textContent).toBe('Not set (closed)'));
    expect(screen.getByTestId('readonly-partnerPolicy').textContent).toBe('something_new');
  });

  it('a viewer without company.manage sees the value but cannot edit or save', async () => {
    can.allowed = new Set(['invoices.view']);
    mount();
    await waitFor(() => expect(input().value).toBe('60'));
    expect(input().disabled).toBe(true);
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
  });

  it('saving sends one PUT with only the hold key and adopts the server answer', async () => {
    mount();
    await waitFor(() => expect(input().value).toBe('60'));
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(input(), { target: { value: '٩٠' } });
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
    apiMock.mockResolvedValueOnce(sales({ commerce_payment_hold_minutes: 90 }));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(puts()).toHaveLength(1));
    expect(puts()[0]).toEqual(['/sales-settings', { method: 'PUT', body: { commerce_payment_hold_minutes: 90 } }]);
    await waitFor(() => expect(screen.queryByText('Unsaved changes')).toBeNull());
    expect(input().value).toBe('90');
  });

  it('blocks invalid values in the browser (no request) with a message', async () => {
    mount();
    await waitFor(() => expect(input().value).toBe('60'));
    for (const [value, message] of [['5', 'The duration must be between 15 and 1440 minutes.'], ['abc', 'Enter a whole number of minutes.'], ['', 'Enter a duration in minutes.']] as const) {
      fireEvent.change(input(), { target: { value } });
      fireEvent.submit(input().closest('form')!);
      expect(await screen.findByText(message)).toBeTruthy();
    }
    expect(puts()).toHaveLength(0);
  });

  it('discard restores the saved value; a failed save keeps the draft and explains', async () => {
    mount();
    await waitFor(() => expect(input().value).toBe('60'));
    fireEvent.change(input(), { target: { value: '120' } });
    fireEvent.click(screen.getByRole('button', { name: 'Discard' }));
    expect(input().value).toBe('60');

    fireEvent.change(input(), { target: { value: '120' } });
    apiMock.mockRejectedValueOnce(apiError(403));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(await screen.findByText('You do not have permission to change this setting.')).toBeTruthy();
    expect(input().value).toBe('120');
  });

  it('locks a double submit while the request is in flight', async () => {
    mount();
    await waitFor(() => expect(input().value).toBe('60'));
    fireEvent.change(input(), { target: { value: '120' } });
    let release!: (v: unknown) => void;
    apiMock.mockReturnValueOnce(new Promise((resolve) => (release = resolve)));
    const form = input().closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    expect(puts()).toHaveLength(1);
    release(sales({ commerce_payment_hold_minutes: 120 }));
    await waitFor(() => expect(input().value).toBe('120'));
  });

  it('shows a retryable load error and renders Arabic copy under ar', async () => {
    apiMock.mockRejectedValueOnce(apiError(500));
    mount();
    await screen.findByText('Could not load the policies.');
    cleanup();
    locale.current = 'ar';
    mount();
    await waitFor(() => expect(screen.getByLabelText('المدة (بالدقائق)')).toBeTruthy());
  });

  it('maps server rejections', () => {
    expect(saveErrorKey(apiError(403))).toBe('error.forbidden');
    expect(saveErrorKey(apiError(422))).toBe('error.validation');
    expect(saveErrorKey(apiError(500))).toBe('error.generic');
    expect(saveErrorKey(new Error('offline'))).toBe('error.generic');
  });
});
