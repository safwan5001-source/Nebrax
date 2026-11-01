// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FuelSalesPage from './page';

const { api, currentUser, ApiErrorMock, translate } = vi.hoisted(() => ({
  api: vi.fn(), currentUser: vi.fn(), ApiErrorMock: class ApiError extends Error {},
  // مرجع ثابت: تبعيات useCallback في الصفحة تتضمن t فلا يجوز أن تتغير كل رسم.
  translate: (key: string, values?: Record<string, string>) => (values ? `${key}:${Object.values(values).join(',')}` : key),
}));

vi.mock('next-intl', () => ({ useTranslations: () => translate }));
vi.mock('@/lib/api', () => ({ api, ApiError: ApiErrorMock }));
vi.mock('@/lib/auth', () => ({ currentUser }));
vi.mock('lucide-react', () => ({
  Banknote: () => <span />, CheckCircle2: () => <span />, Droplets: () => <span />, FileText: () => <span />, Plus: () => <span />, ReceiptText: () => <span />,
}));
vi.mock('@/components/data-table', () => ({
  DataTable: ({ columns, data }: { columns: Array<{ id?: string; cell?: (ctx: { row: { original: unknown } }) => React.ReactNode }>; data: unknown[] }) => (
    <div>{data.map((row, index) => <div key={index}>{columns.map((column, c) => (typeof column.cell === 'function' ? <span key={c}>{column.cell({ row: { original: row } })}</span> : null))}</div>)}</div>
  ),
}));
vi.mock('@/components/ui/badge', () => ({ Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
vi.mock('@/components/ui/button', () => ({ Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button> }));
vi.mock('@/components/ui/dialog', () => ({ Dialog: ({ open, title, children }: { open: boolean; title?: string; children: React.ReactNode }) => (open ? <div role="dialog" aria-label={title}>{children}</div> : null) }));
vi.mock('@/components/ui/input', () => ({ Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} /> }));
vi.mock('@/components/ui/label', () => ({ Label: ({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) => <label htmlFor={htmlFor}>{children}</label> }));
vi.mock('@/components/ui/skeleton', () => ({ Skeleton: () => <span /> }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: vi.fn() }) }));

const draftSale = {
  id: 'sale-1', number: 'FS-0001', status: 'draft', fuel_station_id: 's1', fuel_nozzle_id: 'n1', fuel_shift_id: null,
  payment_status: 'unpaid', paid_minor: 0, paid: '0.00', finalized_at: null, invoice_number: null, invoice_remaining_minor: 0,
};
const lists: Record<string, unknown[]> = {
  '/fuel-stations/sales': [draftSale],
  '/fuel-stations/stations': [{ id: 's1', name: 'محطة', code: 'C1', status: 'active' }],
  '/fuel-stations/nozzles': [{ id: 'n1', nozzle_number: '1', fuel_station_id: 's1', status: 'active' }],
};

const finalizePosts = () => api.mock.calls.filter(([path, options]) => String(path).endsWith('/finalize') && options?.method === 'POST');

describe('FuelSalesPage finalize confirmation (UX-12) and dialog errors (FS-29)', () => {
  beforeEach(() => {
    vi.stubGlobal('React', React);
    currentUser.mockReturnValue({ permissions: ['*'] });
    api.mockReset();
    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (options?.method === 'POST') return Promise.resolve({});
      return Promise.resolve({ data: lists[path] ?? [] });
    });
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it('clicking finalize only opens a confirmation; nothing is posted until confirmed', async () => {
    render(<FuelSalesPage />);
    fireEvent.click(await screen.findByText('finalize'));
    expect(finalizePosts()).toHaveLength(0);
    const dialog = await screen.findByRole('dialog', { name: 'finalizeConfirmTitle' });
    expect(dialog.textContent).toContain('finalizeConfirmHint:FS-0001');

    fireEvent.click(screen.getByText('finalizeConfirm'));
    await waitFor(() => expect(finalizePosts()).toHaveLength(1));
  });

  it('cancelling the confirmation never posts', async () => {
    render(<FuelSalesPage />);
    fireEvent.click(await screen.findByText('finalize'));
    await screen.findByRole('dialog', { name: 'finalizeConfirmTitle' });
    fireEvent.click(screen.getByText('cancel'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(finalizePosts()).toHaveLength(0);
  });

  it('a failed finalize shows exactly one alert, inside the confirmation dialog', async () => {
    render(<FuelSalesPage />);
    fireEvent.click(await screen.findByText('finalize'));
    const dialog = await screen.findByRole('dialog', { name: 'finalizeConfirmTitle' });
    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (options?.method === 'POST') return Promise.reject(new ApiErrorMock('لا يوجد سعر معتمد'));
      return Promise.resolve({ data: lists[path] ?? [] });
    });
    fireEvent.click(screen.getByText('finalizeConfirm'));
    await screen.findByText('لا يوجد سعر معتمد');
    const alerts = screen.getAllByRole('alert');
    expect(alerts).toHaveLength(1);
    expect(dialog.contains(alerts[0])).toBe(true);
  });

  it('with no dialog open the page-level banner still shows load errors', async () => {
    api.mockImplementation(() => Promise.reject(new ApiErrorMock('تعذر التحميل')));
    render(<FuelSalesPage />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('تعذر التحميل');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
