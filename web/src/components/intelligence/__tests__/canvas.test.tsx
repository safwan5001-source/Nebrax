// @vitest-environment jsdom
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { TEST_LOCALES, renderIntl, type TestLocale } from '@/test-utils/intl';
import { agingResult, blockedStatus, incomeResult, makeStatus } from '@/modules/intelligence/__tests__/fixtures';
import { api, canWith, resetSession, session } from './harness';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: session.push, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => '/intelligence',
}));
vi.mock('@/lib/use-can', () => ({
  useCurrentUser: () => session.user,
  useCan: () => ({ can: canWith(session.user?.permissions ?? []), hydrated: true }),
}));
vi.mock('@/modules/intelligence/api', () => api);

import { IntelligenceProvider } from '@/modules/intelligence/store';
import { IntelligenceCanvas } from '../intelligence-canvas';

const mount = (locale: TestLocale = 'en') =>
  renderIntl(<IntelligenceProvider locale={locale}><IntelligenceCanvas /></IntelligenceProvider>, locale);

const runButton = (locale: TestLocale) => screen.findByRole('button', { name: locale === 'ar' ? 'تشغيل التقرير' : 'Run report' });

beforeEach(() => resetSession());
afterEach(cleanup);

describe.each(TEST_LOCALES)('canvas (%s)', (locale) => {
  it('reads the status on entry but no financial figure until the user runs a report', async () => {
    api.fetchStatus.mockResolvedValue(makeStatus());
    mount(locale);
    await runButton(locale);
    expect(api.fetchStatus).toHaveBeenCalledTimes(1);
    expect(api.runTool).not.toHaveBeenCalled();
    expect(screen.getByText(locale === 'ar' ? 'اختر تقريراً وشغّله' : 'Pick a report and run it')).toBeTruthy();
  });

  it('runs the explicit tool with organization-clock default dates and shows the result with its sources', async () => {
    api.fetchStatus.mockResolvedValue(makeStatus());
    api.runTool.mockResolvedValue({ request_id: 'r', status: 'ok', tool_calls: [{ tool: 'finance.income_statement', result: incomeResult() }] });
    mount(locale);
    await userEvent.click(await runButton(locale));
    await waitFor(() => expect(api.runTool).toHaveBeenCalledWith({
      tool: 'finance.income_statement', arguments: { from: '2026-10-01', to: '2026-10-16' },
    }));
    await waitFor(() => expect(document.querySelector('[data-result="income_statement"]')).not.toBeNull());
    expect(screen.getAllByRole('link').some((a) => a.getAttribute('href') === '/reports/general/income-statement')).toBe(true);
  });

  it('runs an aging report with as_of and shows the non-historical warning', async () => {
    api.fetchStatus.mockResolvedValue(makeStatus());
    api.runTool.mockResolvedValue({ request_id: 'r', status: 'ok', tool_calls: [{ tool: 'finance.receivables_aging', result: agingResult() }] });
    mount(locale);
    await runButton(locale);
    await userEvent.click(screen.getByRole('radio', { name: locale === 'ar' ? 'أعمار الذمم المدينة' : 'Receivables aging' }));
    await userEvent.click(await runButton(locale));
    await waitFor(() => expect(api.runTool).toHaveBeenCalledWith({ tool: 'finance.receivables_aging', arguments: { as_of: '2026-10-16' } }));
    await waitFor(() => expect(screen.getByRole('note')).toBeTruthy());
  });

  it('does not send a request for an invalid or future date and says why', async () => {
    api.fetchStatus.mockResolvedValue(makeStatus());
    mount(locale);
    await runButton(locale);
    fireEvent.change(screen.getByLabelText(locale === 'ar' ? 'إلى تاريخ' : 'To'), { target: { value: '2099-01-01' } });
    await userEvent.click(await runButton(locale));
    expect((await screen.findByRole('alert')).textContent).toBe(locale === 'ar' ? 'لا يجوز تاريخ مستقبلي' : 'Future dates are not allowed');
    expect(api.runTool).not.toHaveBeenCalled();
  });

  it.each(['permission_denied', 'platform_disabled', 'tenant_disabled', 'consent_required', 'provider_unavailable', 'currency_unsupported'] as const)(
    'shows %s and offers no way to run a report',
    async (state) => {
      api.fetchStatus.mockResolvedValue(blockedStatus(state));
      mount(locale);
      await waitFor(() => expect(document.querySelector(`[data-notice="${state}"]`)).not.toBeNull());
      expect(screen.queryByRole('button', { name: locale === 'ar' ? 'تشغيل التقرير' : 'Run report' })).toBeNull();
      expect(api.runTool).not.toHaveBeenCalled();
    },
  );

  it('maps a server refusal to its state and offers retry only for retryable ones', async () => {
    api.fetchStatus.mockResolvedValue(makeStatus());
    api.runTool.mockRejectedValueOnce(new ApiError(503, 'x', { error: { code: 'internal_error', message: 'm' }, request_id: 'r' }));
    mount(locale);
    await userEvent.click(await runButton(locale));
    await waitFor(() => expect(document.querySelector('[data-notice="server_error"]')).not.toBeNull());
    expect(screen.getByRole('button', { name: locale === 'ar' ? 'إعادة المحاولة' : 'Try again' })).toBeTruthy();
    expect(document.querySelector('[data-result]')).toBeNull(); // no result is invented
  });

  it('renders the budget refusal as a state with no result', async () => {
    api.fetchStatus.mockResolvedValue(makeStatus());
    api.runTool.mockRejectedValueOnce(new ApiError(429, 'x', { error: { code: 'budget_exceeded', message: 'm' }, request_id: 'r' }));
    mount(locale);
    await userEvent.click(await runButton(locale));
    await waitFor(() => expect(document.querySelector('[data-notice="budget_exceeded"]')).not.toBeNull());
    expect(screen.queryByRole('button', { name: locale === 'ar' ? 'إعادة المحاولة' : 'Try again' })).toBeNull();
  });
});

describe('canvas history', () => {
  it('switches between runs of this session and says they are memory-only', async () => {
    api.fetchStatus.mockResolvedValue(makeStatus());
    api.runTool
      .mockResolvedValueOnce({ request_id: 'a', status: 'ok', tool_calls: [{ tool: 'finance.income_statement', result: incomeResult() }] })
      .mockResolvedValueOnce({ request_id: 'b', status: 'ok', tool_calls: [{ tool: 'finance.receivables_aging', result: agingResult() }] });
    mount('en');
    await userEvent.click(await runButton('en'));
    await waitFor(() => expect(document.querySelector('[data-result="income_statement"]')).not.toBeNull());
    await userEvent.click(screen.getByRole('radio', { name: 'Receivables aging' }));
    await userEvent.click(await runButton('en'));
    await waitFor(() => expect(document.querySelector('[data-result="receivables_aging"]')).not.toBeNull());
    const history = screen.getByRole('navigation', { name: 'Runs in this session' });
    await userEvent.click(history.querySelectorAll('button')[1] as HTMLElement);
    await waitFor(() => expect(document.querySelector('[data-result="income_statement"]')).not.toBeNull());
    expect(history.querySelector('span[title]')?.getAttribute('title')).toContain('Kept in memory only');
  });
});
