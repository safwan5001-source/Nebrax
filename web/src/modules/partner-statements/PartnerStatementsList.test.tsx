// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import type { ReconciliationRow } from './contract';
import { PartnerStatementsList } from './PartnerStatementsList';

const h = vi.hoisted(() => ({
  fetchReconciliations: vi.fn(),
  fetchReconciliation: vi.fn(),
  fetchBranches: vi.fn(),
  fetchPartners: vi.fn(),
  observe: vi.fn(),
  paginationProps: [] as Array<Record<string, unknown>>,
  perms: ['partner_statements.view', 'partner_statements.reconcile'] as string[],
  capability: { state: 'enabled' as 'enabled' | 'suspended' | 'disabled', settled: true, canView: true, canImport: true },
  translate: Object.assign(
    (key: string, values: Record<string, unknown> = {}) => (Object.keys(values).length ? `${key}:${Object.values(values).join(',')}` : key),
    { raw: () => ({}), rich: (key: string) => key },
  ),
}));

vi.mock('next-intl', () => ({ useTranslations: () => h.translate, useLocale: () => 'ar' }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
vi.mock('./client', () => ({
  fetchReconciliations: h.fetchReconciliations,
  fetchReconciliation: h.fetchReconciliation,
  fetchBranches: h.fetchBranches,
  fetchPartners: h.fetchPartners,
}));
vi.mock('@/components/nebrax', async () => {
  const actual = await vi.importActual<typeof import('@/components/nebrax')>('@/components/nebrax');
  return {
    ...actual,
    Pagination: (props: React.ComponentProps<typeof actual.Pagination>) => {
      h.paginationProps.push(props as unknown as Record<string, unknown>);
      return <actual.Pagination {...props} />;
    },
  };
});
vi.mock('./capability', () => ({ usePartnerStatementsCapability: () => ({ ...h.capability, observe: h.observe }) }));
vi.mock('@/lib/use-can', () => ({ useCan: () => ({ can: (p: string) => h.perms.includes(p) || h.perms.includes('*'), hydrated: true }) }));
vi.mock('lucide-react', () => {
  const stub = () => <span />;
  return new Proxy({ __esModule: true } as Record<string | symbol, unknown>, {
    get: (target, name) => (typeof name === 'symbol' || name === 'then' || name === '__esModule' ? Reflect.get(target, name) : stub),
    has: () => true,
  });
});

const PARTNER_ID = '11111111-1111-4111-8111-111111111111';
const row = (patch: Partial<ReconciliationRow> = {}): ReconciliationRow => ({
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'draft', role: 'customer', partner_id: PARTNER_ID, partner: { name: 'شركة النور' },
  branch_id: null, branch: null, period_from: '2026-01-01', period_to: '2026-03-31', currency: 'SAR', original_filename: 'nour-q1.csv', line_count: 12,
  total_debit_minor: 115000, total_credit_minor: 50000, created_by: 'u1', created_at: '2026-04-02T09:00:00+03:00', reviewed_at: null, closed_at: null,
  voided_at: null, superseded_by_id: null, ...patch,
});
const page = (rows: ReconciliationRow[], total = rows.length) => ({ data: rows, meta: { current_page: 1, last_page: 1, per_page: 25, total } });

beforeEach(() => {
  h.perms = ['partner_statements.view', 'partner_statements.reconcile'];
  h.capability = { state: 'enabled', settled: true, canView: true, canImport: true };
  h.fetchReconciliations.mockReset().mockResolvedValue(page([row()]));
  h.fetchReconciliation.mockReset().mockResolvedValue(row());
  h.fetchBranches.mockReset().mockResolvedValue([{ id: '22222222-2222-4222-8222-222222222222', name: 'فرع الدمام', is_active: true }]);
  h.fetchPartners.mockReset().mockResolvedValue([]);
  h.observe.mockReset();
  h.paginationProps.length = 0;
  window.history.replaceState(null, '', '/partner-statements');
});
afterEach(() => cleanup());

describe('PartnerStatementsList', () => {
  it('renders the server-provided rows and the server total, with money in SAR/Latin digits', async () => {
    h.fetchReconciliations.mockResolvedValue(page([row(), row({ id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', status: 'closed', partner: { name: 'مؤسسة الأفق' }, role: 'supplier' })], 57));
    render(<PartnerStatementsList />);

    expect((await screen.findAllByText('شركة النور')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('مؤسسة الأفق').length).toBeGreaterThan(0);
    expect(screen.getAllByText(/1,150\.00/).length).toBeGreaterThan(0);
    // العدّاد والترقيم من meta الخادم لا من عدد الصفوف المحمَّلة (صفّان فقط محمَّلان)
    expect(h.paginationProps.at(-1)).toMatchObject({ total: 57, page: 1, lastPage: 1, perPage: 25 });
    expect(document.body.textContent).not.toMatch(/[٠-٩]/);
    expect(h.fetchReconciliations).toHaveBeenCalledTimes(1);
    expect(h.fetchReconciliations.mock.calls[0][0]).toMatchObject({ page: 1, sort: '-created_at', status: [] });
  });

  it('sends status filters to the server instead of filtering the loaded page', async () => {
    const user = userEvent.setup();
    render(<PartnerStatementsList />);
    await screen.findAllByText('شركة النور');

    await user.click(screen.getByRole('button', { name: 'status.closed' }));
    await waitFor(() => expect(h.fetchReconciliations).toHaveBeenCalledTimes(2));
    expect(h.fetchReconciliations.mock.calls[1][0]).toMatchObject({ status: ['closed'], page: 1 });
    expect(screen.getByRole('button', { name: 'status.closed' }).getAttribute('aria-pressed')).toBe('true');
    expect(window.location.search).toContain('status%5B%5D=closed');
  });

  it('lets desktop users sort from the column headers (server-side), toggling direction', async () => {
    const user = userEvent.setup();
    render(<PartnerStatementsList />);
    await screen.findAllByText('شركة النور');

    await user.click(screen.getByRole('button', { name: /col\.lines/ }));
    await waitFor(() => expect(h.fetchReconciliations.mock.calls.at(-1)?.[0]).toMatchObject({ sort: 'line_count', page: 1 }));
    await user.click(screen.getByRole('button', { name: /col\.lines/ }));
    await waitFor(() => expect(h.fetchReconciliations.mock.calls.at(-1)?.[0]).toMatchObject({ sort: '-line_count' }));
  });

  it('debounces search and resets to the first page', async () => {
    const user = userEvent.setup();
    render(<PartnerStatementsList />);
    await screen.findAllByText('شركة النور');

    await user.type(screen.getByLabelText('filters.search'), 'نور');
    await waitFor(() => expect(h.fetchReconciliations.mock.calls.at(-1)?.[0]).toMatchObject({ q: 'نور', page: 1 }), { timeout: 2000 });
  });

  it('shows the empty state, and a different one when filters are active', async () => {
    h.fetchReconciliations.mockResolvedValue(page([]));
    const user = userEvent.setup();
    render(<PartnerStatementsList />);
    expect(await screen.findByText('empty')).toBeTruthy();

    await user.click(screen.getByRole('button', { name: 'status.draft' }));
    expect(await screen.findByText('empty_filtered')).toBeTruthy();
  });

  it('shows a mapped error (never the raw backend text) and retries', async () => {
    h.fetchReconciliations.mockRejectedValueOnce(new ApiError(500, 'SQLSTATE[HY000] secret', { message: 'SQLSTATE[HY000] secret' }));
    const user = userEvent.setup();
    render(<PartnerStatementsList />);

    expect((await screen.findByRole('alert')).textContent).toContain('errors.unknown');
    expect(document.body.textContent).not.toContain('SQLSTATE');
    await user.click(screen.getByRole('button', { name: 'retry' }));
    expect((await screen.findAllByText('شركة النور')).length).toBeGreaterThan(0);
  });

  it('reports a capability 403 to the capability observer', async () => {
    const forbidden = new ApiError(403, 'هذه القدرة معلّقة (قراءة فقط)', { message: 'هذه القدرة معلّقة (قراءة فقط)' });
    h.fetchReconciliations.mockRejectedValueOnce(forbidden);
    render(<PartnerStatementsList />);
    await screen.findByRole('alert');
    expect(h.observe).toHaveBeenCalledWith(forbidden);
  });

  it('is blocked when the capability is disabled: no list request at all', async () => {
    h.capability = { state: 'disabled', settled: true, canView: true, canImport: false };
    render(<PartnerStatementsList />);
    expect(await screen.findByText('state.disabled_title')).toBeTruthy();
    expect(h.fetchReconciliations).not.toHaveBeenCalled();
    expect(screen.queryByText('import_action')).toBeNull();
  });

  it('is read-only when suspended: list still loads, no import action', async () => {
    h.capability = { state: 'suspended', settled: true, canView: true, canImport: false };
    render(<PartnerStatementsList />);
    expect(await screen.findByText('state.suspended_hint')).toBeTruthy();
    expect((await screen.findAllByText('شركة النور')).length).toBeGreaterThan(0);
    expect(screen.queryByText('import_action')).toBeNull();
  });

  it('does not request anything without the view permission', async () => {
    h.perms = [];
    h.capability = { state: 'enabled', settled: true, canView: false, canImport: false };
    render(<PartnerStatementsList />);
    expect(await screen.findByText('state.forbidden_title')).toBeTruthy();
    expect(h.fetchReconciliations).not.toHaveBeenCalled();
    expect(h.fetchBranches).not.toHaveBeenCalled();
  });

  it('offers the import action only to a user who can import', async () => {
    h.perms = ['partner_statements.view'];
    h.capability = { state: 'enabled', settled: true, canView: true, canImport: false };
    render(<PartnerStatementsList />);
    await screen.findAllByText('شركة النور');
    expect(screen.queryByText('import_action')).toBeNull();

    cleanup();
    h.capability = { state: 'enabled', settled: true, canView: true, canImport: true };
    render(<PartnerStatementsList />);
    expect(await screen.findByText('import_action')).toBeTruthy();
  });

  it('does not offer a detail link (the review workspace ships in A4b)', async () => {
    render(<PartnerStatementsList />);
    await screen.findAllByText('شركة النور');
    const links = screen.queryAllByRole('link').map((link) => link.getAttribute('href'));
    expect(links.some((href) => href?.startsWith('/partner-statements/') && href !== '/partner-statements/import')).toBe(false);
  });

  it('shows the freshly imported reconciliation from the highlight parameter via the header endpoint', async () => {
    const id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    window.history.replaceState(null, '', `/partner-statements?highlight=${id}`);
    h.fetchReconciliation.mockResolvedValue(row({ id, partner: { name: 'شركة الواحة' } }));
    render(<PartnerStatementsList />);

    const banner = await screen.findByTestId('imported-banner');
    expect(within(banner).getByText('شركة الواحة')).toBeTruthy();
    expect(h.fetchReconciliation).toHaveBeenCalledWith(id);
  });

  it('ignores a malformed highlight and shows a neutral message when the header is unavailable', async () => {
    window.history.replaceState(null, '', '/partner-statements?highlight=not-a-uuid');
    render(<PartnerStatementsList />);
    await screen.findAllByText('شركة النور');
    expect(h.fetchReconciliation).not.toHaveBeenCalled();

    cleanup();
    const id = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
    window.history.replaceState(null, '', `/partner-statements?highlight=${id}`);
    h.fetchReconciliation.mockRejectedValue(new ApiError(422, 'الطرف غير متاح لك في هذا الدور.', {}));
    render(<PartnerStatementsList />);
    const banner = await screen.findByTestId('imported-banner');
    expect(banner.textContent).toContain('highlight.unavailable');
    expect(banner.textContent).not.toContain('الطرف غير متاح');
  });

  it('blocks the request for an inverted period and tells the user why', async () => {
    const user = userEvent.setup();
    render(<PartnerStatementsList />);
    await screen.findAllByText('شركة النور');
    const calls = h.fetchReconciliations.mock.calls.length;

    await user.type(screen.getByLabelText('filters.period_from'), '2026-05-01');
    await user.type(screen.getByLabelText('filters.period_to'), '2026-01-01');
    expect(await screen.findByText('filters.period_inverted')).toBeTruthy();
    const inverted = h.fetchReconciliations.mock.calls.slice(calls).filter(([f]) => f.periodFrom && f.periodTo && f.periodTo < f.periodFrom);
    expect(inverted).toHaveLength(0);
  });
});
