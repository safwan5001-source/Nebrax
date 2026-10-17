/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import { AiBudgetsCard } from './ai-budgets-card';

const { platformApi, ApiError } = vi.hoisted(() => {
  class ApiError extends Error {
    status: number;
    constructor(message: string, status = 500) {
      super(message);
      this.status = status;
    }
  }
  return { platformApi: vi.fn(), ApiError };
});

function translator(lang: 'en' | 'ar') {
  return (key: string, values?: Record<string, string | number>) => {
    const text = ((lang === 'ar' ? ar : en) as unknown as Record<string, Record<string, unknown>>).platformIntegrations[key];
    if (typeof text !== 'string') return key;
    return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values?.[name] ?? ''));
  };
}
const t = translator('en');
vi.mock('next-intl', () => ({ useTranslations: () => t }));
vi.mock('@/lib/platform-api', () => ({ platformApi }));
vi.mock('@/lib/api', () => ({ ApiError }));

const row = (cap = 1000, used = 100) => ({
  cap_tokens: cap, used_tokens: used, reserved_tokens: 0, cap_cost_micro_usd: 5_000_000, used_cost_micro_usd: 250_000, reserved_cost_micro_usd: 0,
  cap_cost_usd: '5.000000', used_cost_usd: '0.250000', remaining_tokens: cap - used, remaining_cost_micro_usd: 4_750_000,
});
const overview = (overrides: Record<string, unknown> = {}) => ({
  period: '2026-10', current_period: '2026-10', global: row(), over_allocated: false,
  tenants: [{ ...row(500, 50), tenant_id: '11111111-1111-4111-8111-111111111111', tenant_name: 'Alpha Co' }],
  by_feature: [{ feature: 'assistant', requests: 3, failed: 1, tokens: 900, cost_micro_usd: 4000, cost_usd: '0.004000' }],
  policy: { meter_document_extraction: false, failure_charge: 'reserved', assistant_provider: 'anthropic', assistant_external_network_enabled: true },
  limits: { max_tokens: 1_000_000_000_000, max_cost_micro_usd: 100_000_000_000 },
  ...overrides,
});
const writes = () => platformApi.mock.calls.filter(([, o]) => o?.method === 'PUT');

beforeEach(() => {
  platformApi.mockReset();
  platformApi.mockImplementation(async (path: string, init?: { method?: string }) => {
    if (path.startsWith('/platform/ai-budgets') && (init?.method ?? 'GET') === 'GET') return { data: overview() };
    if (path.startsWith('/platform/tenants')) return { data: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Beta Co' }] };
    throw new Error(`unexpected ${init?.method} ${path}`);
  });
});
afterEach(() => cleanup());

describe('AI budgets card', () => {
  it('shows caps, usage by feature and the policy badges without any price or key', async () => {
    render(<AiBudgetsCard />);
    await screen.findByRole('region', { name: t('aiBudgetGlobal') });
    expect(screen.getByText('Alpha Co')).toBeTruthy();
    expect(screen.getByText(t('aiBudgetMeterOff'))).toBeTruthy();
    expect(screen.getByText(t('aiBudgetNetworkOn'))).toBeTruthy();
    expect(screen.getByText('assistant')).toBeTruthy();
    expect(screen.getAllByRole('progressbar').length).toBe(2);
    expect(document.body.textContent).not.toMatch(/sk-ant|api_key|per_1k/);
  });

  it('warns loudly when there is no platform cap and when caps are over-allocated', async () => {
    platformApi.mockImplementation(async () => ({ data: overview({ global: null, over_allocated: true }) }));
    render(<AiBudgetsCard />);
    expect(await screen.findByText(t('aiBudgetNoGlobal'))).toBeTruthy();
    expect(screen.getByText(t('aiBudgetOverAllocated'))).toBeTruthy();
  });

  it('sends integer caps with the password, then clears the password and shows the refreshed overview', async () => {
    render(<AiBudgetsCard />);
    await screen.findByRole('region', { name: t('aiBudgetGlobal') });
    fireEvent.change(screen.getByLabelText(t('aiBudgetTokens')), { target: { value: '5000000' } });
    fireEvent.change(screen.getByLabelText(t('aiBudgetUsd')), { target: { value: '12.5' } });
    fireEvent.change(screen.getByLabelText(t('currentPassword')), { target: { value: 'pw-123456' } });
    platformApi.mockImplementationOnce(async () => ({ data: overview({ global: { ...row(5_000_000, 0), cap_cost_micro_usd: 12_500_000 } }) }));
    fireEvent.click(screen.getByRole('button', { name: t('aiBudgetSave') }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toEqual(['/platform/ai-budgets', { method: 'PUT', body: { scope: 'global', period: '2026-10', cap_tokens: 5_000_000, cap_cost_micro_usd: 12_500_000, current_password: 'pw-123456' } }]);
    expect((await screen.findByRole('status', { name: '' })).textContent).toBeTruthy();
    expect((screen.getByLabelText(t('currentPassword')) as HTMLInputElement).value).toBe('');
  });

  it('blocks an invalid form before any request and says why', async () => {
    render(<AiBudgetsCard />);
    await screen.findByRole('region', { name: t('aiBudgetGlobal') });
    fireEvent.change(screen.getByLabelText(t('aiBudgetTokens')), { target: { value: '1.5' } });
    fireEvent.change(screen.getByLabelText(t('aiBudgetUsd')), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText(t('currentPassword')), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: t('aiBudgetSave') }));
    expect((await screen.findByRole('alert')).textContent).toBe(t('aiBudgetError_tokens'));
    expect(writes()).toHaveLength(0);
  });

  it('needs a chosen organization for a tenant cap and sends its id', async () => {
    render(<AiBudgetsCard />);
    await screen.findByRole('region', { name: t('aiBudgetGlobal') });
    fireEvent.change(screen.getByLabelText(t('aiBudgetScope')), { target: { value: 'tenant' } });
    fireEvent.change(screen.getByLabelText(t('aiBudgetTokens')), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(t('aiBudgetUsd')), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(t('currentPassword')), { target: { value: 'pw' } });
    fireEvent.click(screen.getByRole('button', { name: t('aiBudgetSave') }));
    expect((await screen.findByRole('alert')).textContent).toBe(t('aiBudgetError_tenant'));

    fireEvent.change(screen.getByLabelText(t('aiBudgetTenantSearch')), { target: { value: 'Be' } });
    const option = await screen.findByRole('option', { name: 'Beta Co' });
    fireEvent.change(screen.getByLabelText(t('aiBudgetTenantOne'), { selector: 'select#ai-budget-tenant' }), { target: { value: (option as HTMLOptionElement).value } });
    platformApi.mockImplementationOnce(async () => ({ data: overview() }));
    fireEvent.click(screen.getByRole('button', { name: t('aiBudgetSave') }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0][1].body).toMatchObject({ scope: 'tenant', tenant_id: '22222222-2222-4222-8222-222222222222', cap_tokens: 100, cap_cost_micro_usd: 1_000_000 });
  });

  it('turns a server rejection into a clear failure and still clears the password', async () => {
    render(<AiBudgetsCard />);
    await screen.findByRole('region', { name: t('aiBudgetGlobal') });
    fireEvent.change(screen.getByLabelText(t('aiBudgetTokens')), { target: { value: '100' } });
    fireEvent.change(screen.getByLabelText(t('aiBudgetUsd')), { target: { value: '1' } });
    fireEvent.change(screen.getByLabelText(t('currentPassword')), { target: { value: 'wrong' } });
    platformApi.mockImplementationOnce(async () => { throw new ApiError('bad', 422); });
    fireEvent.click(screen.getByRole('button', { name: t('aiBudgetSave') }));
    expect((await screen.findByRole('alert')).textContent).toBe(t('aiBudgetRejected'));
    expect((screen.getByLabelText(t('currentPassword')) as HTMLInputElement).value).toBe('');
  });

  it('offers retry when the overview cannot be loaded or has an unexpected shape', async () => {
    platformApi.mockImplementationOnce(async () => ({ data: { unexpected: true } }));
    render(<AiBudgetsCard />);
    expect((await screen.findByRole('alert')).textContent).toBe(t('aiBudgetLoadFailed'));
    fireEvent.click(screen.getByRole('button', { name: t('retry') }));
    expect(await screen.findByRole('region', { name: t('aiBudgetGlobal') })).toBeTruthy();
  });

  it('prefills the form when editing an existing cap', async () => {
    render(<AiBudgetsCard />);
    const tenantSection = (await screen.findByRole('region', { name: t('aiBudgetTenants') }));
    fireEvent.click(within(tenantSection).getByRole('button', { name: t('aiBudgetEdit') }));
    expect((screen.getByLabelText(t('aiBudgetTokens')) as HTMLInputElement).value).toBe('500');
    expect((screen.getByLabelText(t('aiBudgetUsd')) as HTMLInputElement).value).toBe('5');
    expect((screen.getByLabelText(t('aiBudgetScope')) as HTMLSelectElement).value).toBe('tenant');
  });
});
