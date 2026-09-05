'use client';

import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReceiptDialog, type Receipt } from './receipt-dialog';

const { printDocument, documentView } = vi.hoisted(() => ({
  printDocument: vi.fn(),
  documentView: vi.fn(({ templateId, themeId, showLogo, rootId }: { templateId: string; themeId?: string; showLogo?: boolean; rootId?: string }) => (
    <div id={rootId} data-show-logo={String(showLogo)} data-template-id={templateId} data-theme-id={themeId ?? ''} />
  )),
}));

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('@/components/pos/pos-dialog', () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  PosDialog: ({ children, title, className }: { children: React.ReactNode; title: string; className?: string }) => (
    <div role="dialog" aria-label={title} data-class={className}>{children}</div>
  ),
}));
vi.mock('@/components/ui/button', () => ({
  Button: ({ children, onClick, className }: { children: React.ReactNode; onClick?: () => void; className?: string }) => (
    <button type="button" className={className} onClick={onClick}>{children}</button>
  ),
}));
vi.mock('@/modules/documents/components/document-view', () => ({ DocumentView: documentView }));
vi.mock('@/modules/documents/components/document-scaler', () => ({ DocumentScaler: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/modules/documents/services/export', () => ({ printDocument }));

function receipt(templateId: string): Receipt {
  return {
    model: {
      totals: { subtotal: 10000, tax: 1500, total: 11500 },
      meta: { number: 'POS-2026-0001', date: '2026-08-30' },
    } as Receipt['model'],
    number: 'POS-2026-0001',
    thermalTemplateRevision: {
      id: 'thermal-revision-1',
      definition: {
        template_id: templateId,
        theme_id: 'black',
        show_logo: false,
        layout: [
          { key: 'header', visible: true },
          { key: 'parties', visible: true },
          { key: 'items', visible: true },
          { key: 'summary', visible: true },
          { key: 'footer', visible: true },
        ],
      },
    },
  };
}

describe('ReceiptDialog', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('uses the frozen thermal revision for both preview and auto/manual print', () => {
    vi.useFakeTimers();
    render(<ReceiptDialog receipt={receipt('tax-invoice-thermal80')} autoPrint paperSize="thermal_80" onClose={() => undefined} />);

    expect(documentView.mock.calls.at(-1)?.[0]).toMatchObject({
      templateId: 'tax-invoice-thermal80',
      themeId: 'black',
      showLogo: false,
      rootId: 'print-root',
    });

    act(() => { vi.advanceTimersByTime(300); });
    expect(printDocument).toHaveBeenCalledWith({ widthMm: 80, heightMm: 0 });

    fireEvent.click(screen.getByRole('button', { name: 'print' }));
    expect(printDocument).toHaveBeenLastCalledWith({ widthMm: 80, heightMm: 0 });
  });

  it('keeps the selected paper-size fallback when a frozen revision is incompatible', () => {
    render(<ReceiptDialog receipt={receipt('tax-invoice-thermal80')} paperSize="thermal_58" onClose={() => undefined} />);

    expect(documentView.mock.calls.at(-1)?.[0]).toMatchObject({
      templateId: 'tax-invoice-thermal58',
      rootId: 'print-root',
    });

    fireEvent.click(screen.getByRole('button', { name: 'print' }));
    expect(printDocument).toHaveBeenCalledWith({ widthMm: 58, heightMm: 0 });
  });

  it('يبرز نجاح العملية ورقم الفاتورة والإجمالي مع معاينة DocumentView وإجراءات لمس', () => {
    const onClose = vi.fn();
    render(<ReceiptDialog receipt={receipt('tax-invoice-thermal80')} paperSize="thermal_80" onClose={onClose} />);

    const dialog = screen.getByRole('dialog', { name: 'receipt' });
    // PR-4.1: توسيع مقصود على sm+/lg+ ليستثمر ارتفاع/عرض نافذة العرض على
    // سطح المكتب (كان `max-w-sm sm:max-w-md` يُنتج معاينة مصغَّرة جداً) —
    // الجوال (دون sm:) يبقى بعرض max-w-sm كما كان تماماً، لا max-w-xs الأضيق.
    expect(dialog.getAttribute('data-class')).toContain('max-w-sm');
    expect(dialog.getAttribute('data-class')).toContain('sm:max-w-xl');
    expect(dialog.getAttribute('data-class')).toContain('lg:max-w-2xl');
    expect(dialog.getAttribute('data-class')).not.toContain('max-w-xs');

    const success = screen.getByTestId('pos-receipt-success');
    expect(success.textContent).toContain('receipt_done');
    expect(success.textContent).toContain('POS-2026-0001');
    expect(success.querySelector('.text-positive')).toBeTruthy();

    expect(documentView.mock.calls.at(-1)?.[0]).toMatchObject({
      templateId: 'tax-invoice-thermal80',
      rootId: 'print-root',
    });

    const print = screen.getByRole('button', { name: 'print' });
    const next = screen.getByRole('button', { name: 'new_sale' });
    expect(print.className).toMatch(/min-h-11/);
    expect(next.className).toMatch(/min-h-11/);
    fireEvent.click(next);
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('PR-4: وضع المعاينة يستبدل إطار «تم البيع» بعنوان محايد وزر «إغلاق» بدل «بيع جديد»، مع إتاحة نسخ رقم الفاتورة', () => {
    const onClose = vi.fn();
    const onCopy = vi.fn();
    render(<ReceiptDialog receipt={receipt('tax-invoice-thermal80')} variant="preview" onCopy={onCopy} onClose={onClose} />);

    const dialog = screen.getByRole('dialog', { name: 'receipt_preview_title' });
    expect(dialog).toBeTruthy();
    const preview = screen.getByTestId('pos-receipt-preview');
    expect(preview.textContent).toContain('receipt_preview_title');
    expect(preview.textContent).not.toContain('receipt_done');
    expect(preview.querySelector('.text-positive')).toBeNull();

    expect(screen.queryByRole('button', { name: 'new_sale' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'close' }));
    expect(onClose).toHaveBeenCalledOnce();

    fireEvent.click(screen.getByRole('button', { name: 'receipt_copy_number' }));
    expect(onCopy).toHaveBeenCalledOnce();
  });

  it('PR-4: البيع الناجح لا يتأثر بفشل الطباعة — تُعرض حالة فشل صريحة والزرّ يبقى متاحاً لإعادة المحاولة', () => {
    printDocument.mockImplementationOnce(() => { throw new Error('print unavailable'); });
    render(<ReceiptDialog receipt={receipt('tax-invoice-thermal80')} onClose={() => undefined} />);

    expect(screen.queryByTestId('pos-receipt-print-error')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'print' }));
    expect(screen.getByTestId('pos-receipt-print-error').textContent).toContain('print_failed');
    // البيع نفسه يبقى ناجحاً — رقم الفاتورة والإجمالي ما زالا معروضين كما هما، لا إعادة تحقق.
    expect(screen.getByTestId('pos-receipt-success').textContent).toContain('POS-2026-0001');

    // إعادة المحاولة ممكنة ومستقلة عن أي عملية بيع جديدة.
    fireEvent.click(screen.getByRole('button', { name: 'print' }));
    expect(screen.queryByTestId('pos-receipt-print-error')).toBeNull();
    expect(printDocument).toHaveBeenCalledTimes(2);
  });
});
