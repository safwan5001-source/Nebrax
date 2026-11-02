// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import InvoiceDetailPage from './page';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => 'en',
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: 'inv-1' }),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));
vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('@/lib/api', () => ({
  api, downloadFile: vi.fn(), hasApiStatus: () => false, ApiError: class ApiError extends Error {},
}));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/components/invoices/invoice-document', () => ({ InvoiceDocument: () => <div data-testid="invoice-document" /> }));
vi.mock('@/modules/documents/components/document-scaler', () => ({
  DocumentScaler: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/components/returns/create-return-dialog', () => ({ CreateReturnDialog: () => null }));
vi.mock('@/modules/invoice-payment-requests/InvoiceOnlinePayments', () => ({ InvoiceOnlinePayments: () => null }));
vi.mock('@/components/documents/revision-log', () => ({ RevisionLog: () => null }));
vi.mock('lucide-react', () => {
  const Icon = () => <span />;
  return new Proxy({ __esModule: true } as Record<string | symbol, unknown>, {
    get: (target, name) => typeof name === 'symbol' || name === 'then' || name === '__esModule' ? Reflect.get(target, name) : Icon,
    has: () => true,
  });
});

const line = (overrides: Record<string, unknown>) => ({
  id: 'line-1', product_name: 'A4 paper carton', product_code: 'SKU-003', barcode: null,
  description: 'A4 paper carton — bundled with delivery', quantity: 3,
  unit_price: '95.00', unit_price_before_tax: '95.00', tax_rate: 15,
  line_subtotal: '285.00', line_tax: '42.75', line_total: '327.75', ...overrides,
});
const invoice = (lines: unknown[]) => ({
  id: 'inv-1', branch_id: null, number: 'INV-2026-0001', partner_id: 'c1', payment_type: 'credit',
  status: 'posted', payment_status: 'unpaid', invoice_date: '2026-08-17', due_date: null,
  subtotal: '285.00', discount: '0', shipping: '0', adjustment: '0', tax_amount: '42.75', total: '327.75',
  paid_amount: '0', remaining: '327.75', notes: null, zatca_document_type: 'standard', lines,
});

async function open(lines: unknown[]) {
  api.mockImplementation((path: string) => {
    if (path === '/invoices/inv-1') return Promise.resolve({ data: invoice(lines) });
    if (path === '/me') return Promise.resolve({ company: { name: 'Nebrax' } });
    if (path.startsWith('/partners/')) return Promise.resolve({ data: { id: 'c1', name: 'Gulf Trading Est.' } });
    return Promise.resolve({ data: [] });
  });
  render(<InvoiceDetailPage />);
  return screen.findByRole('table', { name: 'ws_lines_label' });
}

describe('InvoiceDetailPage — line description', () => {
  beforeEach(() => { document.documentElement.setAttribute('data-awj-ui', '3'); api.mockReset(); });
  afterEach(() => { cleanup(); document.documentElement.removeAttribute('data-awj-ui'); });

  it('shows the customized description beside the product name on the table and the mobile summary', async () => {
    const table = await open([line({})]);
    expect(within(table).getByText('A4 paper carton')).toBeTruthy();
    expect(within(table).getByText(/A4 paper carton — bundled with delivery/)).toBeTruthy();
    const mobile = screen.getByRole('list', { name: 'ws_lines_label' });
    expect(within(mobile).getByText('A4 paper carton')).toBeTruthy();
    expect(within(mobile).getByTestId('invoice-line-description').textContent).toBe('A4 paper carton — bundled with delivery');
  });
  it('does not repeat the description when it equals the product name (an untouched default)', async () => {
    await open([line({ description: 'A4 paper carton' })]);
    const mobile = screen.getByRole('list', { name: 'ws_lines_label' });
    expect(within(mobile).queryByTestId('invoice-line-description')).toBeNull();
  });
  it('shows a manual line by its description alone', async () => {
    const table = await open([line({ product_name: null, product_code: null, description: 'Consulting hours' })]);
    await waitFor(() => expect(within(table).getByText('Consulting hours')).toBeTruthy());
  });
});
