import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DeliveryNoteInvoiceDraftWizard } from './delivery-note-invoice-draft-wizard';

const { api, translate, currentUser, searchParams, ApiError } = vi.hoisted(() => {
  const strings: Record<string, string> = {
    invoiceDraftTitle: 'Create sales invoice draft',
    invoiceDraftSubtitle: 'Create one draft',
    invoiceDraftBoundaryTitle: 'Draft creation only',
    invoiceDraftBoundaryHint: 'No posting takes place.',
    invoiceDraftGenericInvoice: 'Standalone sales invoice',
    invoiceDraftSelectTitle: 'Select delivery notes',
    invoiceDraftSelectHint: 'Select confirmed notes.',
    invoiceDraftSelectedCount: '{count} selected',
    invoiceDraftSelectionLimitReached: 'The maximum of {limit} delivery notes is already selected.',
    invoiceDraftSelectNote: 'Select delivery note {number}',
    invoiceDraftAvailability: 'Invoice availability',
    invoiceDraftAvailable: 'Available for a draft',
    invoiceDraftAlreadyLinked: 'Already linked to {number}',
    invoiceDraftNoConfirmed: 'No confirmed notes.',
    invoiceDraftPreviewTitle: 'Preview and pricing',
    invoiceDraftPriceList: 'Price list',
    invoiceDraftCustomerDefault: 'Customer default',
    invoiceDraftPriceListHint: 'Use the selected list.',
    invoiceDraftPriceListsUnavailable: 'Price lists could not be loaded.',
    invoiceDraftRunPreview: 'Preview eligibility and pricing',
    invoiceDraftPreviewing: 'Preparing preview…',
    invoiceDraftNeedSelection: 'Select a note.',
    issue_source_line_limit_exceeded: 'The selection exceeds the {limit}-source-line limit.',
    issue_price_list_item_missing: 'The selected price list has no price for this product and unit.',
    invoiceDraftIneligibleTitle: 'The current selection cannot create a draft',
    invoiceDraftEligible: 'Eligible',
    invoiceDraftIneligible: 'Ineligible',
    invoiceDraftUnitPrice: 'Unit price',
    invoiceDraftTaxRate: 'Tax rate',
    invoiceDraftLineDiscount: 'Line discount',
    invoiceDraftMinimumOverride: 'Minimum override reason',
    invoiceDraftSuggestedPrice: 'Suggested price: {price}',
    invoiceDraftDecisionTitle: 'Draft creation decision',
    invoiceDraftReason: 'Reason for creating the draft',
    invoiceDraftReasonHint: 'Audit reason.',
    invoiceDraftDate: 'Invoice date',
    invoiceDraftDueDate: 'Due date',
    invoiceDraftNotes: 'Invoice notes',
    invoiceDraftTaxInclusive: 'Prices include tax',
    invoiceDraftTaxInclusiveHint: 'Inclusive tax.',
    invoiceDraftCreate: 'Create invoice draft',
    invoiceDraftCreating: 'Creating draft…',
    invoiceDraftReset: 'Reset preview',
    invoiceDraftCreated: 'Sales invoice draft created.',
    invoiceDraftCreatedHint: 'No posting takes place.',
    invoiceDraftOpenInvoice: 'Open draft',
    backToList: 'Back to delivery notes',
    invoiceDraftBreadcrumb: 'Invoice draft from delivery notes',
  };
  const translator = (key: string, values?: Record<string, unknown>) => (strings[key] ?? key)
    .replace(/\{(\w+)\}/g, (_, name) => String(values?.[name] ?? ''));
  class MockApiError extends Error {}
  return { api: vi.fn(), translate: translator, currentUser: vi.fn(), searchParams: vi.fn(), ApiError: MockApiError };
});

vi.mock('next-intl', () => ({ useTranslations: () => translate }));
vi.mock('next/navigation', () => ({ useSearchParams: () => searchParams() }));
vi.mock('next/link', () => ({ default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a> }));
vi.mock('@/lib/api', () => ({ api, ApiError }));
vi.mock('@/lib/auth', () => ({ currentUser: () => currentUser() }));
vi.mock('lucide-react', () => {
  const Icon = () => <span />;
  return new Proxy({ __esModule: true } as Record<string | symbol, unknown>, {
    get: (target, name) => typeof name === 'symbol' || name === 'then' || name === '__esModule' ? Reflect.get(target, name) : Icon,
    has: () => true,
  });
});

const note = (id: string, number: string, version: number) => ({
  id, branch_id: 'br-1', number, status: 'confirmed', version, external_reference: null,
  delivery_date: '2026-08-20', notes: null, customer_id: 'customer-1', customer: { id: 'customer-1', name: 'Customer', type: 'customer' },
  warehouse_id: 'warehouse-1', warehouse: { id: 'warehouse-1', name: 'Warehouse', code: 'WH-1' },
  created_by: null, confirmed_by: 'owner', confirmed_at: '2026-08-20T10:00:00Z', cancelled_by: null, cancelled_at: null, cancellation_reason: null, lines: [],
});

const preview = {
  delivery_notes: ['dn-1', 'dn-2'].map((id, index) => ({
    id, number: `DN-00${index + 1}`, version: index + 1, customer_id: 'customer-1', customer_name: 'Customer', warehouse_id: 'warehouse-1', warehouse_name: 'Warehouse', delivery_date: '2026-08-20', eligible: true, issues: [],
    lines: [{ id: `${id}-line`, line_number: 1, product_id: 'product-1', product_name: 'Product', unit_name: 'piece', unit_factor: 1, quantity: 1, quantity_numerator: null, quantity_denominator: null, suggested_unit_price: 12500, suggested_tax_rate: 15, recommended_price_list_id: null }],
  })),
  compatible: true, compatibility_issues: [], pricing_required: true, requested_price_list_id: null,
};

describe('DeliveryNoteInvoiceDraftWizard', () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    api.mockReset();
    currentUser.mockReset();
    searchParams.mockReset();
    searchParams.mockReturnValue(new URLSearchParams('notes=dn-1,dn-2'));
    currentUser.mockReturnValue({ role: 'owner', permissions: ['*'] });
    api.mockImplementation((path: string) => {
      if (path.startsWith('/delivery-notes?')) return Promise.resolve({ data: [note('dn-1', 'DN-001', 1), note('dn-2', 'DN-002', 2)] });
      if (path === '/price-lists') return Promise.resolve({ data: [] });
      if (path === '/delivery-notes/invoice-draft/preview') return Promise.resolve({ data: preview });
      if (path === '/delivery-notes/invoice-draft') return Promise.resolve({ data: { id: 'invoice-1', number: 'INV-001', status: 'draft' }, meta: { idempotent_replay: false } });
      return Promise.resolve({ data: [] });
    });
  });

  it('keeps the wizard usable for delivery-note-only permissions when price-list access returns 403', async () => {
    currentUser.mockReturnValue({
      role: 'delivery-invoicer',
      permissions: ['delivery_notes.view', 'delivery_notes.invoice'],
    });
    api.mockImplementation((path: string) => {
      if (path.startsWith('/delivery-notes?')) return Promise.resolve({ data: [note('dn-1', 'DN-001', 1)] });
      if (path === '/price-lists') return Promise.reject(new ApiError('Forbidden: price lists'));
      return Promise.resolve({ data: [] });
    });

    render(<DeliveryNoteInvoiceDraftWizard />);

    await screen.findAllByText('DN-001');
    await screen.findByText('Forbidden: price lists');
    expect(screen.getByText('Forbidden: price lists')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'Standalone sales invoice' })).toBeNull();
    const previewButton = screen.getByRole('button', { name: 'Preview eligibility and pricing' });
    expect((previewButton as HTMLButtonElement).disabled).toBe(false);
  });

  it('caps the initial selection at 50 notes and disables the next unchecked note before preview', async () => {
    const noteIds = Array.from({ length: 51 }, (_, index) => `dn-${index + 1}`);
    searchParams.mockReturnValue(new URLSearchParams(`notes=${noteIds.join(',')}`));
    api.mockImplementation((path: string) => {
      if (path.startsWith('/delivery-notes?')) return Promise.resolve({ data: noteIds.map((id, index) => note(id, `DN-${String(index + 1).padStart(3, '0')}`, index + 1)) });
      if (path === '/price-lists') return Promise.resolve({ data: [] });
      return Promise.resolve({ data: [] });
    });

    render(<DeliveryNoteInvoiceDraftWizard />);

    await screen.findAllByText('DN-051');
    expect(screen.getByText('50 selected')).toBeTruthy();
    expect(screen.getAllByText('The maximum of 50 delivery notes is already selected.').length).toBeGreaterThan(0);
    expect(screen.getAllByLabelText('Select delivery note DN-051').every((input) => (input as HTMLInputElement).disabled)).toBe(true);
    expect(screen.getAllByLabelText('Select delivery note DN-001').every((input) => !(input as HTMLInputElement).disabled)).toBe(true);
  });

  it('shows the source-line cap from preview and blocks draft creation before pricing', async () => {
    const user = userEvent.setup();
    const oversizedPreview = { ...preview, compatible: false, compatibility_issues: ['source_line_limit_exceeded'], source_line_count: 501, source_line_limit: 500 };
    api.mockImplementation((path: string) => {
      if (path.startsWith('/delivery-notes?')) return Promise.resolve({ data: [note('dn-1', 'DN-001', 1), note('dn-2', 'DN-002', 2)] });
      if (path === '/price-lists') return Promise.resolve({ data: [] });
      if (path === '/delivery-notes/invoice-draft/preview') return Promise.resolve({ data: oversizedPreview });
      return Promise.resolve({ data: [] });
    });

    render(<DeliveryNoteInvoiceDraftWizard />);

    const previewButton = await screen.findByRole('button', { name: 'Preview eligibility and pricing' });
    await user.click(previewButton);
    await screen.findByText('The selection exceeds the 500-source-line limit.');
    const createButton = screen.getByRole('button', { name: 'Create invoice draft' });
    expect((createButton as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getAllByLabelText('Unit price')[0] as HTMLInputElement).disabled).toBe(true);
  });

  it('requests a safe preview for the selected notes and never calls invoice posting', async () => {
    const user = userEvent.setup();
    render(<DeliveryNoteInvoiceDraftWizard />);

    await screen.findByRole('heading', { name: 'Create sales invoice draft' });
    const previewButton = screen.getByRole('button', { name: 'Preview eligibility and pricing' });
    await waitFor(() => expect((previewButton as HTMLButtonElement).disabled).toBe(false));
    await user.click(previewButton);
    await waitFor(() => expect(api.mock.calls.some(([path]) => path === '/delivery-notes/invoice-draft/preview')).toBe(true));
    const previewCall = api.mock.calls.find(([path]) => path === '/delivery-notes/invoice-draft/preview');
    expect(previewCall).toBeDefined();
    expect(previewCall?.[1]).toEqual({ method: 'POST', body: { delivery_note_ids: ['dn-1', 'dn-2'] } });
    expect(api.mock.calls.some(([path]) => String(path).includes('/post'))).toBe(false);
  });
});
