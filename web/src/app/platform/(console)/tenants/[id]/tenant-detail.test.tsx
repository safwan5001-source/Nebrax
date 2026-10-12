/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import PlatformTenantDetailPage from './page';

const { platformApi, replace, ApiError } = vi.hoisted(() => {
  class ApiError extends Error {}
  return { platformApi: vi.fn(), replace: vi.fn(), ApiError };
});
let locale: 'en' | 'ar' = 'en';
let authenticated = true;

function makeTranslator(lang: 'en' | 'ar') {
  return (key: string, values?: Record<string, string | number>) => {
    const text = ((lang === 'ar' ? ar : en) as unknown as Record<string, Record<string, unknown>>).platformTenants[key];
    if (typeof text !== 'string') return key;
    return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? ''));
  };
}
const translators = { en: makeTranslator('en'), ar: makeTranslator('ar') };
vi.mock('next-intl', () => ({ useTranslations: () => translators[locale] }));
const router = { replace, push: vi.fn() };
vi.mock('next/navigation', () => ({ useRouter: () => router, useParams: () => ({ id: 'tenant-1' }) }));
vi.mock('@/lib/platform-auth', () => ({ isPlatformAuthenticated: () => authenticated }));
vi.mock('@/lib/platform-api', () => ({ platformApi }));
vi.mock('@/lib/api', () => ({ ApiError }));
vi.mock('@/components/platform/contract-management-card', () => ({ ContractManagementCard: () => <div data-testid="contracts" /> }));
vi.mock('@/components/platform/commercial-operations-card', () => ({ CommercialOperationsCard: () => <div data-testid="commercial" /> }));
vi.mock('@/components/platform/application-override-card', () => ({ ApplicationOverrideCard: () => <div data-testid="overrides" /> }));

const tenant = (over: Record<string, unknown> = {}) => ({
  id: 'tenant-1', name: 'Reference Co', slug: 'reference-co', account_number: 1000000, support_number: 1000,
  plan: 'pro', is_active: true, trial_ends_at: '2026-12-31', subscription_ends_at: '2027-06-30', created_at: '2026-08-23',
  users_count: 9, active_users_count: 7, contact: { name: 'Owner', email: 'owner@reference.test', phone: '+966500000000' }, subscriptions: [], ...over,
});
const t = (key: string, values?: Record<string, string>) => translators.en(key, values);

beforeEach(() => {
  locale = 'en';
  authenticated = true;
  platformApi.mockReset();
  replace.mockReset();
  platformApi.mockResolvedValue({ data: tenant() });
});
afterEach(cleanup);

const patches = () => platformApi.mock.calls.filter(([, options]) => options?.method === 'PATCH');

describe('platform tenant detail UX (H1-4B)', () => {
  it('shows identity, plan, subscription and trial with LTR values, a logical back link and one h1', async () => {
    const { container } = render(<PlatformTenantDetailPage />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Reference Co' })).toBeTruthy();
    expect(container.querySelectorAll('h1')).toHaveLength(1);
    const identity = screen.getByRole('heading', { name: t('detailTitle') }).closest('[data-awj-card]') as HTMLElement;
    for (const value of ['owner@reference.test', '+966500000000', '2026-12-31', '2027-06-30', '2026-08-23', '9', '7']) {
      expect(within(identity).getByText(value)).toBeTruthy();
    }
    expect(within(identity).getByText('owner@reference.test').getAttribute('dir')).toBe('ltr');
    expect(within(identity).getByText(t('subscriptionEndsAt'))).toBeTruthy();
    const back = screen.getByRole('link', { name: t('backToTenants') });
    expect(back.getAttribute('href')).toBe('/platform/tenants');
    expect(back.className).toContain('h-11');
    expect(back.querySelector('svg')?.getAttribute('class')).toContain('rtl:rotate-180');
    expect(screen.getByTestId('contracts')).toBeTruthy();
    expect(screen.getByTestId('commercial')).toBeTruthy();
    expect(screen.getByTestId('overrides')).toBeTruthy();
  });

  it('loads with a skeleton first, then shows a failure as an alert with a 44px retry and no endless skeleton', async () => {
    platformApi.mockRejectedValueOnce(new ApiError('not allowed'));
    render(<PlatformTenantDetailPage />);
    expect(screen.getByTestId('tenant-skeleton')).toBeTruthy();
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('not allowed');
    expect(screen.queryByTestId('tenant-skeleton')).toBeNull();
    const retry = screen.getByRole('button', { name: t('retry') });
    expect(retry.className).toContain('h-11');
    platformApi.mockResolvedValueOnce({ data: tenant() });
    fireEvent.click(retry);
    expect(await screen.findByRole('heading', { level: 1, name: 'Reference Co' })).toBeTruthy();
  });

  it('keeps the signed-out redirect and requests nothing', async () => {
    authenticated = false;
    render(<PlatformTenantDetailPage />);
    await waitFor(() => expect(replace).toHaveBeenCalledWith('/platform/login'));
    expect(platformApi).not.toHaveBeenCalled();
  });

  it('saves the plan with the same PATCH payload, announces success as status, and disables Save until it differs', async () => {
    render(<PlatformTenantDetailPage />);
    await screen.findByRole('heading', { level: 1, name: 'Reference Co' });
    const save = screen.getByRole('button', { name: t('savePlan') }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    platformApi.mockResolvedValueOnce({ data: tenant({ plan: 'enterprise' }) });
    fireEvent.change(screen.getByLabelText(t('currentPlan')), { target: { value: 'enterprise' } });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect((await screen.findByRole('status')).textContent).toBe(t('planUpdated'));
    expect(patches()).toEqual([['/platform/tenants/tenant-1', { method: 'PATCH', body: { plan: 'enterprise' } }]]);
  });

  it('saves and clears the trial with the existing payloads and labelled controls', async () => {
    render(<PlatformTenantDetailPage />);
    await screen.findByRole('heading', { level: 1, name: 'Reference Co' });
    platformApi.mockResolvedValueOnce({ data: tenant({ trial_ends_at: '2027-01-15' }) });
    fireEvent.change(screen.getByLabelText(t('newTrialEndDate')), { target: { value: '2027-01-15' } });
    fireEvent.click(screen.getByRole('button', { name: t('saveTrial') }));
    await screen.findByText(t('trialUpdated'));
    platformApi.mockResolvedValueOnce({ data: tenant({ trial_ends_at: null }) });
    fireEvent.click(screen.getByRole('button', { name: t('clearTrial') }));
    await waitFor(() => expect(patches()).toHaveLength(2));
    expect(patches().map(([, o]) => o.body)).toEqual([{ trial_ends_at: '2027-01-15' }, { trial_ends_at: null }]);
  });

  it('a failed save is an alert, not a status', async () => {
    render(<PlatformTenantDetailPage />);
    await screen.findByRole('heading', { level: 1, name: 'Reference Co' });
    platformApi.mockRejectedValueOnce(new ApiError('plan blocked'));
    fireEvent.change(screen.getByLabelText(t('currentPlan')), { target: { value: 'free' } });
    fireEvent.click(screen.getByRole('button', { name: t('savePlan') }));
    expect((await screen.findByRole('alert')).textContent).toBe('plan blocked');
    expect(screen.queryByRole('status')).toBeNull();
  });

  describe('deactivate and activate (formerly window.confirm)', () => {
    it('opens a dialog without sending anything and never calls window.confirm', async () => {
      const confirmSpy = vi.spyOn(window, 'confirm');
      render(<PlatformTenantDetailPage />);
      await screen.findByRole('heading', { level: 1, name: 'Reference Co' });
      const opener = screen.getByRole('button', { name: t('deactivate') });
      opener.focus();
      fireEvent.click(opener);
      const dialog = screen.getByRole('dialog', { name: 'Deactivate Reference Co?' });
      expect(within(dialog).getByText(t('confirmDeactivate'))).toBeTruthy();
      expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: t('goBack') }));
      expect(patches()).toHaveLength(0);
      expect(confirmSpy).not.toHaveBeenCalled();
      confirmSpy.mockRestore();
    });

    it('Escape and Go back cancel: no request, focus returns to the Deactivate button', async () => {
      render(<PlatformTenantDetailPage />);
      await screen.findByRole('heading', { level: 1, name: 'Reference Co' });
      const opener = screen.getByRole('button', { name: t('deactivate') });
      opener.focus();
      fireEvent.click(opener);
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(opener);
      fireEvent.click(opener);
      fireEvent.click(screen.getByRole('button', { name: t('goBack') }));
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(opener);
      expect(patches()).toHaveLength(0);
    });

    it('confirming sends exactly { is_active: false } once, closes the dialog and announces success', async () => {
      render(<PlatformTenantDetailPage />);
      await screen.findByRole('heading', { level: 1, name: 'Reference Co' });
      fireEvent.click(screen.getByRole('button', { name: t('deactivate') }));
      platformApi.mockResolvedValueOnce({ data: tenant({ is_active: false }) });
      const dialog = screen.getByRole('dialog');
      const confirm = within(dialog).getByRole('button', { name: t('deactivate') });
      expect(confirm.className).toContain('bg-negative');
      fireEvent.click(confirm);
      expect((await screen.findByRole('status')).textContent).toBe(t('statusUpdated'));
      expect(patches()).toEqual([['/platform/tenants/tenant-1', { method: 'PATCH', body: { is_active: false } }]]);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(screen.getByRole('button', { name: t('activate') })).toBeTruthy();
    });

    it('activating a deactivated tenant uses a primary confirm and { is_active: true }', async () => {
      platformApi.mockResolvedValue({ data: tenant({ is_active: false }) });
      render(<PlatformTenantDetailPage />);
      await screen.findByRole('heading', { level: 1, name: 'Reference Co' });
      fireEvent.click(screen.getByRole('button', { name: t('activate') }));
      const dialog = screen.getByRole('dialog', { name: 'Activate Reference Co?' });
      platformApi.mockResolvedValueOnce({ data: tenant({ is_active: true }) });
      const confirm = within(dialog).getByRole('button', { name: t('activate') });
      expect(confirm.className).toContain('bg-primary');
      fireEvent.click(confirm);
      await waitFor(() => expect(patches()).toHaveLength(1));
      expect(patches()[0][1].body).toEqual({ is_active: true });
    });

    it('a failed confirmation shows an alert and closes the dialog', async () => {
      render(<PlatformTenantDetailPage />);
      await screen.findByRole('heading', { level: 1, name: 'Reference Co' });
      fireEvent.click(screen.getByRole('button', { name: t('deactivate') }));
      platformApi.mockRejectedValueOnce(new ApiError('forbidden'));
      fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: t('deactivate') }));
      expect((await screen.findByRole('alert')).textContent).toBe('forbidden');
      expect(screen.queryByRole('dialog')).toBeNull();
    });

    it('marks the sensitive section with text, an icon and a danger button, not colour alone', async () => {
      render(<PlatformTenantDetailPage />);
      await screen.findByRole('heading', { level: 1, name: 'Reference Co' });
      const card = screen.getByRole('heading', { name: new RegExp(t('accessManagement')) }).closest('[data-awj-card]') as HTMLElement;
      expect(within(card).getByText(t('sensitiveAction'))).toBeTruthy();
      const button = within(card).getByRole('button', { name: t('deactivate') });
      expect(button.className).toContain('bg-negative');
      expect(button.querySelector('svg[aria-hidden="true"]')).toBeTruthy();
      expect(button.className).toContain('h-11');
    });
  });

  it('copies a reference number with a 44px named button', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(<PlatformTenantDetailPage />);
    await screen.findByRole('heading', { level: 1, name: 'Reference Co' });
    const copy = screen.getAllByRole('button', { name: t('copyReference') })[0] as HTMLElement;
    expect(copy.className).toContain('h-11');
    fireEvent.click(copy);
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('1000000'));
    expect((await screen.findByRole('status')).textContent).toBe(t('referenceCopied'));
  });

  it('renders in Arabic and has every new key in both locales', async () => {
    locale = 'ar';
    render(<PlatformTenantDetailPage />);
    expect(await screen.findByRole('heading', { level: 1, name: 'Reference Co' })).toBeTruthy();
    expect(screen.getByText(ar.platformTenants.sensitiveAction)).toBeTruthy();
    for (const lang of [ar, en]) for (const key of ['backToTenants', 'subscriptionEndsAt', 'sensitiveAction', 'goBack', 'deactivateDialogTitle', 'activateDialogTitle']) {
      expect(typeof (lang.platformTenants as Record<string, unknown>)[key]).toBe('string');
    }
  });
});
