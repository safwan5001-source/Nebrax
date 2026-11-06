// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import FuelStationsReceivingPage from './page';

const { api, translate } = vi.hoisted(() => ({ api: vi.fn(), translate: (key: string) => key }));

vi.mock('next-intl', () => ({ useTranslations: () => translate }));
vi.mock('next/link', () => ({ default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a> }));
vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: vi.fn() }) }));

const delivery = (extra: Record<string, unknown>) => ({
  id: 'd-1', status: 'approved', delivery_note_number: 'DN-1', supplier_id: 's-1', received_liters: '10', warehouse_id: 'w-1', received_at: null, ...extra,
});
const invoice = (extra: Record<string, unknown>) => ({ id: 'i-1', invoice_number: 'INV-1', status: 'unmatched', supplier_id: 's-1', currency: 'SAR', ...extra });

function mockApi(deliveries: unknown[], invoices: unknown[]) {
  api.mockImplementation((path: string) => Promise.resolve({
    data: path === '/fuel-stations/deliveries' ? deliveries : path === '/fuel-stations/supplier-invoices' ? invoices : [],
  }));
}

describe('FuelStationsReceivingPage — B1 cost redaction', () => {
  beforeEach(() => { vi.stubGlobal('React', React); });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); api.mockReset(); });

  it('shows a dash, never zero or NaN, when the API removes the monetary keys for a user without the cost permission', async () => {
    mockApi([delivery({})], [invoice({})]);
    const { container } = render(<FuelStationsReceivingPage />);

    expect(await screen.findByText('DN-1')).toBeTruthy();
    expect(screen.getByText('INV-1')).toBeTruthy();
    expect(container.textContent).not.toMatch(/NaN|undefined/);
    // خليتا القيمة (الاستلام والفاتورة) تعرضان «—».
    expect(screen.getAllByText('—').length).toBeGreaterThanOrEqual(2);
  });

  it('still renders the amounts when the API includes them', async () => {
    mockApi([delivery({ received_total_cost_minor: 234500 })], [invoice({ total_value_minor: 234500 })]);
    const { container } = render(<FuelStationsReceivingPage />);

    expect(await screen.findByText('DN-1')).toBeTruthy();
    expect(container.textContent).toMatch(/2[,٬]?345/);
  });
});
