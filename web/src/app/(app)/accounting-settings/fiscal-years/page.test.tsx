// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import FiscalYearsPage from './page';

/**
 * FISCAL-2: أربع صلاحيات مستقلة تحكم الشاشة — العرض والتعريف والإقفال والفتح.
 * ولوحة الجاهزية تفصل الموانع عن التنبيهات عن المعلومات، والإقفال ممنوع ما دام
 * هناك مانع مهما كانت صلاحية المستخدم.
 */
const { api, currentUser, toastSuccess, toastError, t, tc } = vi.hoisted(() => {
  const strings: Record<string, string> = {
    forbidden: 'Forbidden',
    fyForbiddenHint: 'Forbidden hint',
    fiscalYearsTitle: 'Fiscal Years',
    fiscalYearsSubtitle: 'Subtitle',
    fiscalYearsNotice: 'Notice',
    backToAccountingSettings: 'Back',
    loadFailed: 'Load failed',
    fyEmpty: 'No fiscal years',
    fyEmptyHint: 'Empty hint',
    fyName: 'Year',
    fyRange: 'Range',
    fyGeneration: 'Close',
    fyResult: 'Result',
    fyNoJournal: 'Closed with no journal',
    fyStatus_open: 'Open',
    fyStatus_closed: 'Closed',
    fyStatus_closing: 'Closing',
    fyStatus_reopening: 'Reopening',
    fyCreateAction: 'New fiscal year',
    fyCreateHint: 'Create hint',
    fyCloseAction: 'Close year',
    fyCloseConfirm: 'Close confirm',
    fyReopenAction: 'Reopen year',
    fyReopenConfirm: 'Reopen confirm',
    fyReopenReason: 'Reopen reason',
    fyBlockers: 'Blockers',
    fyNoBlockers: 'No blockers.',
    fyWarnings: 'Warnings',
    fyInfo: 'Information',
    fyAcknowledgeWarnings: 'I reviewed the warnings',
    lockStatusColumn: 'Status',
    lockActionsColumn: 'Actions',
    lockHistoryAction: 'Audit trail',
    lockHistoryEmpty: 'No events',
    lockStartDate: 'From',
    lockEndDate: 'To',
  };
  const commonStrings: Record<string, string> = { cancel: 'Cancel', save: 'Save' };
  return {
    api: vi.fn(),
    currentUser: vi.fn(),
    toastSuccess: vi.fn(),
    toastError: vi.fn(),
    t: (key: string) => strings[key] ?? key,
    tc: (key: string) => commonStrings[key] ?? key,
  };
});

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) => (namespace === 'common' ? tc : t),
  useLocale: () => 'en',
}));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/lib/auth', () => ({ currentUser }));
vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: toastSuccess, error: toastError }) }));
vi.mock('lucide-react', () => {
  const iconStub = () => <span />;
  return new Proxy({ __esModule: true } as Record<string | symbol, unknown>, {
    get: (target, name) =>
      typeof name === 'symbol' || name === 'then' || name === '__esModule'
        ? Reflect.get(target, name)
        : iconStub,
    has: () => true,
  });
});

const OPEN_YEAR = {
  id: 'fy-1',
  name: '2026',
  start_date: '2026-01-01',
  end_date: '2026-12-31',
  status: 'open' as const,
  created_by: 'Owner',
  created_at: '2026-01-01T08:00:00Z',
  active_generation: null,
  closed_without_journal: false,
  generations: [],
};

const CLOSED_YEAR = {
  ...OPEN_YEAR,
  id: 'fy-2',
  name: '2025',
  start_date: '2025-01-01',
  end_date: '2025-12-31',
  status: 'closed' as const,
  active_generation: 1,
  generations: [{
    id: 'g-1', generation: 1, status: 'active' as const,
    journal_entry_id: 'je-1', reversal_entry_id: null,
    total_revenue: 100000, total_expense: 40000, net_income: 60000,
    closed_by: 'Owner', closed_at: '2026-12-31T10:00:00Z',
    reopened_by: null, reopened_at: null, reopen_reason: null,
  }],
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('FiscalYearsPage', () => {
  it('shows a forbidden state without fiscal_years.view', async () => {
    currentUser.mockReturnValue({ role: 'staff', permissions: ['invoices.view'] });

    render(<FiscalYearsPage />);

    await waitFor(() => screen.getByText('Forbidden'));
    expect(api).not.toHaveBeenCalled();
  });

  it('shows neither close nor reopen for a viewer holding only fiscal_years.view', async () => {
    currentUser.mockReturnValue({ role: 'custom', permissions: ['fiscal_years.view'] });
    api.mockResolvedValueOnce({ data: { fiscal_years: [OPEN_YEAR, CLOSED_YEAR] } });

    render(<FiscalYearsPage />);

    await waitFor(() => screen.getByText('2025'));
    expect(screen.queryByLabelText('Close year')).toBeNull();
    expect(screen.queryByLabelText('Reopen year')).toBeNull();
    expect(screen.queryByText('New fiscal year')).toBeNull();
    // والعرض والسجل يبقيان متاحين.
    expect(screen.getAllByLabelText('Audit trail').length).toBeGreaterThan(0);
  });

  it('offers close only on an open year and reopen only on a closed one', async () => {
    currentUser.mockReturnValue({
      role: 'custom',
      permissions: ['fiscal_years.view', 'fiscal_years.close', 'fiscal_years.reopen'],
    });
    api.mockResolvedValueOnce({ data: { fiscal_years: [OPEN_YEAR, CLOSED_YEAR] } });

    render(<FiscalYearsPage />);

    await waitFor(() => screen.getByText('2025'));
    expect(screen.getAllByLabelText('Close year')).toHaveLength(1);
    expect(screen.getAllByLabelText('Reopen year')).toHaveLength(1);
  });

  it('keeps the close button disabled while a blocker stands', async () => {
    currentUser.mockReturnValue({ role: 'owner', permissions: undefined });
    api.mockResolvedValueOnce({ data: { fiscal_years: [OPEN_YEAR] } });
    api.mockResolvedValueOnce({
      data: {
        readiness: {
          blockers: [{ severity: 'blocker', code: 'period_lock', message: 'An active period lock covers the close date.', details: {} }],
          warnings: [],
          info: [{ severity: 'info', code: 'result', message: 'Revenue 1,000.00', details: {} }],
          can_close: false,
        },
      },
    });

    render(<FiscalYearsPage />);
    await waitFor(() => screen.getByText('2026'));
    screen.getByLabelText('Close year').click();

    await waitFor(() => screen.getByText('An active period lock covers the close date.'));
    const confirm = screen.getAllByRole('button').find((b) => b.textContent === 'Close year' && !b.hasAttribute('aria-label'));
    expect(confirm).toBeDefined();
    expect((confirm as HTMLButtonElement).disabled).toBe(true);
  });

  it('requires acknowledging warnings before a close with no blockers', async () => {
    currentUser.mockReturnValue({ role: 'owner', permissions: undefined });
    api.mockResolvedValueOnce({ data: { fiscal_years: [OPEN_YEAR] } });
    api.mockResolvedValueOnce({
      data: {
        readiness: {
          blockers: [],
          warnings: [{ severity: 'warning', code: 'drafts.invoices', message: '3 draft invoices remain.', details: {} }],
          info: [],
          can_close: true,
        },
      },
    });

    render(<FiscalYearsPage />);
    await waitFor(() => screen.getByText('2026'));
    screen.getByLabelText('Close year').click();

    await waitFor(() => screen.getByText('3 draft invoices remain.'));
    const confirm = screen.getAllByRole('button').find((b) => b.textContent === 'Close year' && !b.hasAttribute('aria-label')) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);

    screen.getByRole('checkbox').click();
    await waitFor(() => expect(confirm.disabled).toBe(false));
  });

  it('requires a reason before reopening', async () => {
    currentUser.mockReturnValue({ role: 'owner', permissions: undefined });
    api.mockResolvedValueOnce({ data: { fiscal_years: [CLOSED_YEAR] } });

    render(<FiscalYearsPage />);
    await waitFor(() => screen.getByText('2025'));
    screen.getByLabelText('Reopen year').click();

    await waitFor(() => screen.getByText('Reopen confirm'));
    const confirm = screen.getAllByRole('button').find((b) => b.textContent === 'Reopen year' && !b.hasAttribute('aria-label')) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
  });

  it('marks a zero-activity close distinctly from a year that was never closed', async () => {
    currentUser.mockReturnValue({ role: 'owner', permissions: undefined });
    api.mockResolvedValueOnce({
      data: {
        fiscal_years: [{
          ...CLOSED_YEAR,
          closed_without_journal: true,
          generations: [{ ...CLOSED_YEAR.generations[0], journal_entry_id: null, net_income: 0 }],
        }],
      },
    });

    render(<FiscalYearsPage />);

    await waitFor(() => screen.getByText('Closed with no journal'));
    expect(screen.getByText('Closed')).not.toBeNull();
  });
});
