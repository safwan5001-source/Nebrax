// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FuelSalesPage from './page';

const { api, currentUser, translate } = vi.hoisted(() => ({
  api: vi.fn(), currentUser: vi.fn(), translate: (key: string) => key,
}));

vi.mock('next-intl', () => ({ useTranslations: () => translate }));
vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('@/lib/auth', () => ({ currentUser }));
vi.mock('lucide-react', () => ({
  Banknote: () => <span />, CheckCircle2: () => <span />, Droplets: () => <span />, FileText: () => <span />, Plus: () => <span />, ReceiptText: () => <span />,
}));
vi.mock('@/components/data-table', () => ({ DataTable: () => <table /> }));
vi.mock('@/components/ui/badge', () => ({ Badge: ({ children }: { children: React.ReactNode }) => <span>{children}</span> }));
vi.mock('@/components/ui/button', () => ({ Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}>{children}</button> }));
vi.mock('@/components/ui/dialog', () => ({ Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) => (open ? <div role="dialog">{children}</div> : null) }));
vi.mock('@/components/ui/input', () => ({ Input: (props: React.InputHTMLAttributes<HTMLInputElement>) => <input {...props} /> }));
vi.mock('@/components/ui/label', () => ({ Label: ({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) => <label htmlFor={htmlFor}>{children}</label> }));
vi.mock('@/components/ui/skeleton', () => ({ Skeleton: () => <span /> }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: vi.fn() }) }));

const lists: Record<string, unknown[]> = {
  '/fuel-stations/sales': [],
  '/fuel-stations/stations': [{ id: 's1', name: 'محطة', code: 'C1', status: 'active' }],
  '/fuel-stations/nozzles': [{ id: 'n1', nozzle_number: '1', fuel_station_id: 's1', status: 'active' }],
  '/fuel-stations/shifts?status=open': [],
  '/partners?type=customer': [{ id: 'p1', name: 'عميل', type: 'customer' }],
  '/fuel-stations/avi-rfid/authorizations': [],
};

function postedBodies() {
  return api.mock.calls.filter(([, options]) => options?.method === 'POST' && (options.body as { idempotency_key?: string })?.idempotency_key).map(([, options]) => options.body as Record<string, unknown>);
}

async function openAndFill(liters: string) {
  fireEvent.click(await screen.findByText('newSale'));
  fireEvent.change(await screen.findByLabelText('station'), { target: { value: 's1' } });
  fireEvent.change(screen.getByLabelText('nozzle'), { target: { value: 'n1' } });
  fireEvent.change(screen.getByLabelText('customer'), { target: { value: 'p1' } });
  fireEvent.change(screen.getByLabelText('quantity'), { target: { value: liters } });
}

describe('FuelSalesPage idempotency (FS-08)', () => {
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

  it('retrying the same draft after a failed request reuses the same idempotency key', async () => {
    render(<FuelSalesPage />);
    await openAndFill('10.000');
    api.mockImplementationOnce(() => Promise.resolve({ data: [] })); // keeps the shape of any interleaved GET
    api.mockReset();
    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (options?.method === 'POST') return api.mock.calls.filter(([, o]) => o?.method === 'POST').length === 1 ? Promise.reject(new Error('timeout')) : Promise.resolve({});
      return Promise.resolve({ data: lists[path] ?? [] });
    });

    fireEvent.click(screen.getByText('createDraft'));
    await waitFor(() => expect(postedBodies()).toHaveLength(1));
    await screen.findByText('saveFailed');
    fireEvent.click(screen.getByText('createDraft'));
    await waitFor(() => expect(postedBodies()).toHaveLength(2));

    const [first, second] = postedBodies();
    expect(first.idempotency_key).toBeTruthy();
    expect(second.idempotency_key).toBe(first.idempotency_key);
  });

  it('a changed quantity is a different intent and gets a new key', async () => {
    render(<FuelSalesPage />);
    await openAndFill('10.000');
    api.mockReset();
    api.mockImplementation((path: string, options?: { method?: string }) => {
      if (options?.method === 'POST') return Promise.reject(new Error('timeout'));
      return Promise.resolve({ data: lists[path] ?? [] });
    });

    fireEvent.click(screen.getByText('createDraft'));
    await waitFor(() => expect(postedBodies()).toHaveLength(1));
    await screen.findByText('saveFailed');
    fireEvent.change(screen.getByLabelText('quantity'), { target: { value: '11.000' } });
    fireEvent.click(screen.getByText('createDraft'));
    await waitFor(() => expect(postedBodies()).toHaveLength(2));

    const [first, second] = postedBodies();
    expect(second.idempotency_key).not.toBe(first.idempotency_key);
  });
});
