import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { deliveryChannelFixture } from '@/lib/__tests__/delivery-channel-report.fixture';
import { formatRiyal } from '@/lib/money';
import { DeliveryChannelReportWorkspace } from './delivery-channel-report-workspace';

const apiMock = vi.hoisted(() => vi.fn());
const downloadMock = vi.hoisted(() => vi.fn());
const userBox = vi.hoisted(() => ({
  current: null as null | {
    id: string;
    name: string;
    email: string;
    role: string;
    permissions?: string[];
    tenant_id: string;
  },
}));

vi.mock('next-intl', () => ({
  useLocale: () => 'en',
  useTranslations: () => (key: string) => key,
}));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: apiMock };
});
vi.mock('@/lib/export', async () => {
  const actual = await vi.importActual<typeof import('@/lib/export')>('@/lib/export');
  return { ...actual, downloadCsv: downloadMock };
});
vi.mock('@/lib/auth', () => ({
  AUTH_SESSION_CHANGED_EVENT: 'nibras:auth-session-changed',
  currentUser: () => userBox.current,
}));
vi.mock('@/components/reports/report-filters', () => ({
  ReportFilters: ({ onChange }: { onChange: (value: { from: string; to: string; branchIds: string[] }) => void }) => (
    <button type="button" onClick={() => onChange({ from: '2026-03-01', to: '2026-03-31', branchIds: ['branch-a', 'branch-b'] })}>change scope</button>
  ),
}));

function signIn(permissions: string[], tenant = 'tenant-a') {
  userBox.current = {
    id: 'user-1',
    name: 'Accountant',
    email: 'accountant@example.com',
    role: 'accountant',
    permissions,
    tenant_id: tenant,
  };
}

const viewer = ['reports.view', 'invoices.view', 'returns.view'];

afterEach(() => {
  cleanup();
  apiMock.mockReset();
  downloadMock.mockReset();
  userBox.current = null;
});

describe('DeliveryChannelReportWorkspace', () => {
  it('shows API metrics, keeps credit notes separate, and does not recompute VAT', async () => {
    signIn(viewer);
    apiMock.mockResolvedValue(deliveryChannelFixture());
    render(<DeliveryChannelReportWorkspace />);

    await waitFor(() => expect(screen.getByTestId('delivery-channel-metrics')).toBeTruthy());
    const metrics = screen.getByTestId('delivery-channel-metrics').textContent ?? '';
    expect(metrics).toContain(`metrics.gross_sales${formatRiyal('100.00')}`);
    expect(metrics).toContain(`metrics.discounts${formatRiyal('12.00')}`);
    expect(metrics).toContain(`metrics.net_sales${formatRiyal('92.75')}`);
    expect(metrics).toContain(`metrics.vat${formatRiyal('13.50')}`);
    expect(metrics).toContain(`metrics.total${formatRiyal('106.25')}`);
    expect(metrics).toContain('metrics.invoice_count1');
    expect(metrics).toContain(`metrics.net_after_pos_returns${formatRiyal('94.75')}`);
    expect(metrics).not.toContain(formatRiyal('74.75'));
    expect(metrics).not.toContain(formatRiyal('88.00'));
    const credits = screen.getByTestId('delivery-channel-credit-notes').textContent ?? '';
    expect(credits).toContain(formatRiyal('20.00'));
    expect(credits).toContain('creditNotesHint');
    expect(screen.getByTestId('delivery-channel-report').textContent).toContain('=1+1');
    const comparison = screen.getByTestId('delivery-channel-comparison').querySelector('.hidden.md\\:block');
    expect(comparison?.textContent?.match(/jahez/g)).toHaveLength(2);
  });

  it('refreshes from backend filters and keeps the stable profile id', async () => {
    signIn(viewer);
    apiMock.mockResolvedValue(deliveryChannelFixture());
    render(<DeliveryChannelReportWorkspace />);
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/reports/delivery-channel'));

    fireEvent.click(screen.getByRole('button', { name: 'change scope' }));
    await waitFor(() => expect(String(apiMock.mock.calls.at(-1)?.[0])).toContain('branch_id%5B%5D=branch-a'));
    expect(String(apiMock.mock.calls.at(-1)?.[0])).toContain('from=2026-03-01');
    expect(String(apiMock.mock.calls.at(-1)?.[0])).not.toContain('delivery_platform_profile_id');

    fireEvent.change(screen.getByTestId('delivery-platform-filter'), { target: { value: 'profile-1' } });
    await waitFor(() => expect(String(apiMock.mock.calls.at(-1)?.[0])).toContain('delivery_platform_profile_id=profile-1'));
    expect(screen.getByTestId('delivery-platform-filter').querySelector('option[value="profile-2"]')).toBeTruthy();
  });

  it('covers loading, empty, error, incomplete, and missing permission', async () => {
    signIn(viewer);
    let resolveLoading: (value: unknown) => void = () => {};
    apiMock.mockImplementationOnce(() => new Promise((resolve) => { resolveLoading = resolve; }));
    const view = render(<DeliveryChannelReportWorkspace />);
    expect(screen.getByTestId('delivery-channel-loading')).toBeTruthy();
    resolveLoading(deliveryChannelFixture());
    await waitFor(() => expect(screen.getByTestId('delivery-channel-metrics')).toBeTruthy());
    view.unmount();

    const empty = deliveryChannelFixture();
    empty.summary = {
      ...empty.summary,
      gross_sales: '0.00',
      discounts: '0.00',
      shipping: '0.00',
      adjustment: '0.00',
      net_sales: '0.00',
      vat: '0.00',
      total: '0.00',
      invoice_count: 0,
      returns_count: 0,
      returns_subtotal: '0.00',
      returns_vat: '0.00',
      returns_total: '0.00',
      net_after_pos_returns: '0.00',
    };
    empty.credit_notes = { count: 0, total: '0.00', by_platform: [], rows: [] };
    empty.platforms = [];
    empty.invoices = [];
    empty.returns = [];
    apiMock.mockResolvedValueOnce(empty);
    render(<DeliveryChannelReportWorkspace />);
    await waitFor(() => expect(screen.getByTestId('delivery-channel-empty')).toBeTruthy());
    cleanup();

    apiMock.mockRejectedValueOnce(new Error('offline'));
    render(<DeliveryChannelReportWorkspace />);
    await waitFor(() => expect(screen.getByTestId('delivery-channel-error')).toBeTruthy());
    apiMock.mockResolvedValueOnce(deliveryChannelFixture());
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    await waitFor(() => expect(screen.getByTestId('delivery-channel-metrics')).toBeTruthy());
    cleanup();

    apiMock.mockResolvedValueOnce({ summary: {} });
    render(<DeliveryChannelReportWorkspace />);
    await waitFor(() => expect(screen.getByTestId('delivery-channel-incomplete')).toBeTruthy());
    expect(screen.queryByTestId('delivery-channel-metrics')).toBeNull();
    cleanup();

    signIn([]);
    apiMock.mockClear();
    apiMock.mockResolvedValue(deliveryChannelFixture());
    render(<DeliveryChannelReportWorkspace />);
    await waitFor(() => expect(screen.getByTestId('delivery-channel-forbidden')).toBeTruthy());
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('treats an API 403 as missing permission', async () => {
    signIn(viewer);
    apiMock.mockRejectedValue(new ApiError(403, 'denied', {}));
    render(<DeliveryChannelReportWorkspace />);
    await waitFor(() => expect(screen.getByTestId('delivery-channel-forbidden')).toBeTruthy());
  });

  it('links a document only when the existing route permission is present', async () => {
    signIn(['reports.view']);
    apiMock.mockResolvedValue(deliveryChannelFixture());
    const restricted = render(<DeliveryChannelReportWorkspace />);
    await waitFor(() => expect(screen.getByTestId('delivery-channel-metrics')).toBeTruthy());
    const blocked = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(blocked).not.toContain('/invoices/invoice-1');
    expect(blocked).not.toContain('/returns/return-1');
    expect(blocked).not.toContain('/credit-notes/note-1');
    expect(screen.getByTestId('delivery-channel-report').textContent).toContain('INV-1');
    restricted.unmount();

    signIn(viewer);
    apiMock.mockResolvedValue(deliveryChannelFixture());
    render(<DeliveryChannelReportWorkspace />);
    await waitFor(() => expect(screen.getByTestId('delivery-channel-metrics')).toBeTruthy());
    const hrefs = screen.getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(hrefs).toContain('/invoices/invoice-1');
    expect(hrefs).toContain('/returns/return-1');
    expect(hrefs).toContain('/credit-notes/note-1');
  });

  it('exports formula-neutral CSV from the scoped payload and keeps negative amounts numeric', async () => {
    signIn(viewer);
    apiMock.mockResolvedValue({ ...deliveryChannelFixture(), hub_orders: [{ total: '999.00' }] });
    render(<DeliveryChannelReportWorkspace />);
    await waitFor(() => expect(screen.getByTestId('delivery-channel-metrics')).toBeTruthy());
    expect(screen.queryByText(/999\.00/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'exportCsv' }));
    const csv = String(downloadMock.mock.calls[0]?.[1] ?? '');
    expect(downloadMock.mock.calls[0]?.[0]).toBe('delivery-channel-sales');
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'=هنقر");
    expect(csv).toContain("'@Hunger");
    expect(csv).toContain('-0.25');
    expect(csv).not.toContain(",=1+1");
    expect(csv).not.toContain("'-0.25");
  });

  it('drops a stale tenant response and ignores an older filter response', async () => {
    signIn(viewer, 'tenant-a');
    let resolveFirst: (value: unknown) => void = () => {};
    let resolveSecond: (value: unknown) => void = () => {};
    apiMock
      .mockImplementationOnce(() => new Promise((resolve) => { resolveFirst = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveSecond = resolve; }));
    render(<DeliveryChannelReportWorkspace />);
    fireEvent.click(screen.getByRole('button', { name: 'change scope' }));
    const latest = deliveryChannelFixture();
    latest.summary = { ...latest.summary, vat: '1.00' };
    resolveSecond(latest);
    await waitFor(() => expect(screen.getByTestId('delivery-channel-metrics').textContent).toContain(formatRiyal('1.00')));
    resolveFirst(deliveryChannelFixture());
    await Promise.resolve();
    expect(screen.getByTestId('delivery-channel-metrics').textContent).toContain(formatRiyal('1.00'));
    expect(screen.getByTestId('delivery-channel-metrics').textContent).not.toContain(formatRiyal('13.50'));

    let resolveOldTenant: (value: unknown) => void = () => {};
    let resolveNewTenant: (value: unknown) => void = () => {};
    apiMock
      .mockImplementationOnce(() => new Promise((resolve) => { resolveOldTenant = resolve; }))
      .mockImplementationOnce(() => new Promise((resolve) => { resolveNewTenant = resolve; }));
    fireEvent.click(screen.getByRole('button', { name: 'change scope' }));
    userBox.current = { ...userBox.current!, tenant_id: 'tenant-b' };
    await act(async () => {
      window.dispatchEvent(new Event('nibras:auth-session-changed'));
    });
    const next = deliveryChannelFixture();
    next.summary = { ...next.summary, vat: '2.00' };
    resolveNewTenant(next);
    await waitFor(() => expect(screen.getByTestId('delivery-channel-metrics').textContent).toContain(formatRiyal('2.00')));
    resolveOldTenant(deliveryChannelFixture());
    await Promise.resolve();
    expect(screen.getByTestId('delivery-channel-metrics').textContent).toContain(formatRiyal('2.00'));
    expect(screen.getByTestId('delivery-channel-metrics').textContent).not.toContain(formatRiyal('13.50'));
  });

  it('renders in RTL and LTR with the shared responsive table and theme tokens', async () => {
    signIn(viewer);
    apiMock.mockResolvedValue(deliveryChannelFixture());
    const rtl = render(<div dir="rtl"><DeliveryChannelReportWorkspace /></div>);
    await waitFor(() => expect(screen.getByTestId('delivery-channel-metrics')).toBeTruthy());
    expect(rtl.container.querySelector('[dir="rtl"] [data-testid="delivery-channel-report"]')).toBeTruthy();
    expect(rtl.container.querySelector('[dir="ltr"]')).toBeNull();
    expect(rtl.container.querySelector('.overflow-auto')).toBeTruthy();
    expect(rtl.container.querySelector('.md\\:hidden')).toBeTruthy();
    expect(rtl.container.querySelector('.bg-surface')).toBeTruthy();
    expect(rtl.container.querySelector('.bg-white')).toBeNull();
    rtl.unmount();

    const ltr = render(<div dir="ltr"><DeliveryChannelReportWorkspace /></div>);
    await waitFor(() => expect(screen.getByTestId('delivery-channel-metrics')).toBeTruthy());
    expect(ltr.container.querySelector('[dir="ltr"] [data-testid="delivery-channel-report"]')).toBeTruthy();
  });
});
