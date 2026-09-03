/* @vitest-environment jsdom */
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { InvoicePreviewPanel } from './invoice-preview-panel';
import { renderIntl } from '@/test-utils/intl';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock('@/lib/api', () => ({ api }));

const detail = {
  id: 'inv-1',
  number: 'INV-2026-0118',
  partner_id: 'p1',
  status: 'posted',
  payment_status: 'unpaid',
  invoice_date: '2026-06-24',
  due_date: '2026-07-08',
  subtotal: '5000.00',
  tax_amount: '750.00',
  total: '5750.00',
  paid_amount: '0.00',
  remaining: '5750.00',
  lines: [
    { id: 'l1', product_name: 'خدمات استشارية', description: null, quantity: 1, line_total: '5750.00' },
  ],
};

const draft = {
  ...detail,
  id: 'inv-draft',
  number: 'INV-2026-0115',
  status: 'draft',
  payment_status: 'unpaid',
  due_date: '2026-12-01',
  remaining: '3450.00',
};

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

describe('InvoicePreviewPanel', () => {
  beforeEach(() => {
    api.mockReset();
  });

  it('loads trusted financial values from the detail resource and keeps preview actions lightweight', async () => {
    api.mockResolvedValue({ data: detail });
    renderIntl(
      <InvoicePreviewPanel invoiceId="inv-1" customerName="مؤسسة الخليج للتجارة" listStatus="posted" onClose={vi.fn()} />,
      'ar',
    );

    expect(await screen.findByRole('dialog', { name: 'INV-2026-0118' })).toBeTruthy();
    expect(screen.getByText('مؤسسة الخليج للتجارة')).toBeTruthy();
    expect(screen.getByText('خدمات استشارية')).toBeTruthy();
    expect(screen.getByText('متأخرة')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'فتح الفاتورة' }).getAttribute('href')).toBe('/invoices/inv-1');
    expect(screen.queryByRole('link', { name: 'تعديل' })).toBeNull();
    expect(screen.queryByText('ترحيل الفاتورة')).toBeNull();
    expect(screen.queryByText('إضافة عملية دفع')).toBeNull();
    expect(screen.queryByText('إنشاء مرتجع')).toBeNull();
    expect(screen.queryByText('طباعة')).toBeNull();
    expect(screen.queryByText('الفاتورة الإلكترونية (ZATCA)')).toBeNull();
  });

  it('shows edit only for drafts without inventing overdue on a future due date', async () => {
    api.mockResolvedValue({ data: draft });
    renderIntl(
      <InvoicePreviewPanel invoiceId="inv-draft" customerName="عميل" listStatus="draft" onClose={vi.fn()} />,
      'ar',
    );

    const edit = await screen.findByRole('link', { name: 'تعديل' });
    expect(edit.getAttribute('href')).toBe('/invoices/inv-draft/edit');
    expect(screen.queryByText('متأخرة')).toBeNull();
  });

  it('closes on Escape', async () => {
    api.mockResolvedValue({ data: detail });
    const onClose = vi.fn();
    renderIntl(
      <InvoicePreviewPanel invoiceId="inv-1" customerName="عميل" onClose={onClose} />,
      'ar',
    );
    await screen.findByRole('dialog');
    await userEvent.keyboard('{Escape}');
    expect(onClose).toHaveBeenCalled();
  });

  it('retries after a load error', async () => {
    api.mockRejectedValueOnce(new Error('offline'));
    renderIntl(
      <InvoicePreviewPanel invoiceId="inv-1" customerName="عميل" onClose={vi.fn()} />,
      'ar',
    );
    expect(await screen.findByRole('alert')).toBeTruthy();
    api.mockResolvedValueOnce({ data: detail });
    await userEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    await waitFor(() => expect(screen.getByText('INV-2026-0118')).toBeTruthy());
  });
});
