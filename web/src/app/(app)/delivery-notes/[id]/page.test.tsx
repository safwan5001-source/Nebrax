// @vitest-environment jsdom

import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DeliveryNoteDetailPage from './page';

const { api, currentUser, translate } = vi.hoisted(() => {
  const strings: Record<string, string> = {
    back: 'Back',
    statusConfirmed: 'Confirmed',
    statusDraft: 'Draft',
    statusCancelled: 'Cancelled',
    deliveryDate: 'Delivery date',
    invoiceDraftOpenInvoice: 'Open linked draft',
    invoiceDraftAlreadyLinked: 'Already linked to draft {number}',
    confirmedReadOnly: 'Confirmed note is read only.',
    documentState: 'Document state',
    header: 'Header',
    customer: 'Customer',
    warehouse: 'Warehouse',
    externalReference: 'External reference',
    version: 'Version',
    status: 'Status',
    lines: 'Lines',
    product: 'Product',
    unit: 'Unit',
    quantity: 'Quantity',
    description: 'Description',
    history: 'History',
    noHistory: 'No history',
    cancellationReason: 'Cancellation reason',
  };
  const translator = (key: string, values?: Record<string, unknown>) => (strings[key] ?? key)
    .replace(/\{(\w+)\}/g, (_, name) => String(values?.[name] ?? ''));
  return { api: vi.fn(), currentUser: vi.fn(), translate: translator };
});

vi.mock('next-intl', () => ({ useTranslations: () => translate }));
vi.mock('next/navigation', () => ({ useParams: () => ({ id: 'dn-linked' }) }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('@/lib/auth', () => ({ currentUser: () => currentUser() }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: vi.fn() }) }));
vi.mock('lucide-react', () => {
  const Icon = () => <span />;
  return new Proxy({ __esModule: true } as Record<string | symbol, unknown>, {
    get: (target, name) => typeof name === 'symbol' || name === 'then' || name === '__esModule' ? Reflect.get(target, name) : Icon,
    has: () => true,
  });
});

const linkedNote = {
  id: 'dn-linked', branch_id: 'branch-1', number: 'DN-2026-00999', status: 'confirmed', version: 2,
  external_reference: null, delivery_date: '2026-08-20', notes: null,
  customer_id: 'customer-1', customer: { id: 'customer-1', name: 'Customer', type: 'customer' },
  warehouse_id: 'warehouse-1', warehouse: { id: 'warehouse-1', name: 'Warehouse', code: 'WH-1' },
  created_by: null, confirmed_by: 'owner', confirmed_at: '2026-08-20T09:00:00Z', cancelled_by: null, cancelled_at: null, cancellation_reason: null,
  invoice_draft: { allocation_id: 'allocation-1', invoice_id: 'invoice-linked', number: 'INV-2026-001', status: 'draft', line_count: 1 },
  lines: [{ id: 'line-1', line_number: 1, product_id: 'product-1', product_name: 'Product', product_sku: null, product_barcode: null, unit_name: 'piece', unit_factor: 1, quantity: 1, quantity_numerator: null, quantity_denominator: null, description: null }],
  events: [],
};

describe('DeliveryNoteDetailPage linked-invoice permission guard', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    api.mockReset();
    currentUser.mockReset();
    api.mockResolvedValue({ data: linkedNote });
  });

  it('keeps the linked state visible but hides invoice links for a delivery-note-only role', async () => {
    currentUser.mockReturnValue({ role: 'delivery-invoicer', permissions: ['delivery_notes.view', 'delivery_notes.invoice'] });

    render(<DeliveryNoteDetailPage />);

    await screen.findByText('Already linked to draft INV-2026-001');
    expect(screen.queryByRole('link', { name: 'Open linked draft' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'invoiceDraftAction' })).toBeNull();
  });

  it('hides cancellation for a linked note even when the role has delivery_notes.cancel', async () => {
    currentUser.mockReturnValue({ role: 'delivery-canceller', permissions: ['delivery_notes.view', 'delivery_notes.cancel', 'invoices.view'] });

    render(<DeliveryNoteDetailPage />);

    await screen.findByText('Already linked to draft INV-2026-001');
    expect(screen.queryByRole('button', { name: 'cancel' })).toBeNull();
  });

  it('shows linked invoice links only when the role has invoices.view', async () => {
    currentUser.mockReturnValue({ role: 'invoice-viewer', permissions: ['delivery_notes.view', 'delivery_notes.invoice', 'invoices.view'] });

    render(<DeliveryNoteDetailPage />);

    const links = await screen.findAllByRole('link', { name: 'Open linked draft' });
    expect(links).toHaveLength(2);
    expect(links.every((link) => link.getAttribute('href') === '/invoices/invoice-linked')).toBe(true);
  });
});
