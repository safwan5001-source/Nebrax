// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { TaxInvoicePremium } from '../templates/tax-invoice-premium';
import { getTemplate, listTemplatesForDocumentType, TEMPLATES } from '../registry/templates';
import { makeDocumentQaModel } from '../qa/document-qa-fixtures';
import { getTheme } from '../themes';
import { formatModernAmount } from '../presentation/visual-v2';
import { PREMIUM } from '../presentation/tax-invoice-premium';
import type { DocSectionLayoutItem, DocumentModel } from '../types';

const locale = { current: 'ar' };

vi.mock('next-intl', () => ({
  useLocale: () => locale.current,
  useTranslations: (namespace: string) => (key: string) => {
    if (namespace === 'documentTypes') return locale.current === 'ar' ? 'فاتورة ضريبية' : 'Tax Invoice';
    if (namespace === 'documentTypesAlt') return locale.current === 'ar' ? 'Tax Invoice' : 'فاتورة ضريبية';
    return key;
  },
}));

const theme = getTheme('green');
const formatMoney = (minor: number) => String(minor);
const sample = (direction: 'rtl' | 'ltr' = 'rtl'): DocumentModel => makeDocumentQaModel({ scenario: 'reference_sample', direction, showQr: true, showAssets: true });

function renderPremium(model: DocumentModel, layout?: DocSectionLayoutItem[] | null, sections?: Parameters<typeof TaxInvoicePremium>[0]['sections']) {
  return render(<TaxInvoicePremium model={model} theme={theme} formatMoney={formatMoney} layout={layout} sections={sections} rootId="qa-print-root" />);
}

const FULL: DocSectionLayoutItem[] = ['header', 'parties', 'items', 'summary', 'amountWords', 'notes', 'terms', 'bank', 'signature', 'stamp', 'footer']
  .map((key) => ({ key: key as DocSectionLayoutItem['key'], visible: true }));

afterEach(() => { cleanup(); locale.current = 'ar'; });

describe('tax-invoice-premium-v1 registration', () => {
  it('is a distinct template identity that leaves every published template untouched', () => {
    const descriptor = getTemplate('tax-invoice-premium-v1');
    expect(descriptor.id).toBe('tax-invoice-premium-v1');
    expect(descriptor.component).toBe(TaxInvoicePremium);
    expect(descriptor.documentTypes).toEqual(['tax_invoice', 'simplified_tax_invoice']);
    expect(descriptor.supportedPaper).toEqual(['a4', 'letter', 'legal']);
    const others = Object.values(TEMPLATES).filter((t) => t.id !== 'tax-invoice-premium-v1');
    expect(others.every((t) => t.component !== TaxInvoicePremium)).toBe(true);
    expect(getTemplate(undefined).id).toBe('tax-invoice-classic');
  });

  it('is offered for tax invoices only', () => {
    expect(listTemplatesForDocumentType('tax_invoice').map((t) => t.id)).toContain('tax-invoice-premium-v1');
    expect(listTemplatesForDocumentType('quotation').map((t) => t.id)).not.toContain('tax-invoice-premium-v1');
    expect(listTemplatesForDocumentType('receipt_voucher').map((t) => t.id)).not.toContain('tax-invoice-premium-v1');
  });

  it('is presentation-only: no network, tenant or accounting imports (isolation by construction)', () => {
    const dir = resolve(__dirname, '..');
    for (const file of ['templates/tax-invoice-premium.tsx', 'presentation/tax-invoice-premium.ts']) {
      const source = readFileSync(resolve(dir, file), 'utf8');
      expect(source, file).not.toMatch(/from '@\/lib\/api'|fetch\(|tenant|LedgerService|zatca/i);
    }
  });
});

describe('tax-invoice-premium-v1 rendering', () => {
  it('renders the reference structure with real model data', () => {
    const { container } = renderPremium(sample());
    const root = container.querySelector('[data-doc-composition="tax_invoice_premium"]')!;
    expect(container.querySelector('[data-doc-composition="tax_invoice_premium"]')).toBeTruthy();
    expect(root.querySelector('[data-premium-header] h1')?.textContent).toBe('فاتورة ضريبية');
    expect(root.querySelector('[data-premium-header]')?.textContent).toContain('Tax Invoice');
    expect([...root.querySelectorAll('[data-premium-meta-tile]')].map((n) => n.getAttribute('data-premium-meta-tile'))).toEqual(['invoice_no', 'issue_date', 'due_date', 'payment']);
    expect(root.querySelector('[data-premium-party="seller"]')?.textContent).toContain('313037133700003');
    expect(root.querySelector('[data-premium-party="buyer"]')?.textContent).toContain('مطعم الذوق الأصيل');
    expect(root.querySelector('[data-premium-qr] svg')).toBeTruthy();
    expect(root.querySelector('[data-premium-words]')?.textContent).toContain('فقط لا غير');
    expect(root.querySelector('[data-premium-footer]')?.textContent).toContain('0557996876');
  });

  it('prints the stored totals verbatim — the grand total is the model total, never recomputed', () => {
    const model = sample();
    const { container } = renderPremium(model);
    const grand = container.querySelector('[data-premium-grand-total]')!.textContent!;
    expect(grand).toContain(formatModernAmount(model.totals.total, 'SAR'));
    // إجمالي معدَّل في المصدر يظهر كما هو حتى لو لم يطابق الحساب (لا إصلاح صامت).
    const tampered = { ...model, totals: { ...model.totals, total: model.totals.total + 777 } };
    cleanup();
    const second = renderPremium(tampered);
    expect(second.container.querySelector('[data-premium-grand-total]')!.textContent).toContain(formatModernAmount(tampered.totals.total, 'SAR'));
    // وبما أنه لا يطابق: لا صف «خاضع» مشتق.
    expect(second.container.querySelector('[data-premium-total-row="taxable"]')).toBeNull();
  });

  it('prints line values from the model: taxable, VAT amount, total per row', () => {
    const model = sample();
    const { container } = renderPremium(model);
    const rows = [...container.querySelectorAll('[data-premium-row="line"]')];
    expect(rows).toHaveLength(model.lines.length);
    model.lines.forEach((l, i) => {
      const text = rows[i].textContent!;
      expect(text).toContain(formatModernAmount(l.total, 'SAR'));
      expect(text).toContain(formatModernAmount(l.tax, 'SAR'));
      expect(text).toContain(formatModernAmount(l.netAmount!, 'SAR'));
    });
  });

  it('pads the table with numbered empty rows up to the minimum, and none beyond it', () => {
    const { container } = renderPremium(sample());
    expect(container.querySelectorAll('[data-premium-row="filler"]')).toHaveLength(PREMIUM.minTableRows - 7);
    cleanup();
    const many = { ...sample(), lines: Array.from({ length: 14 }, (_, i) => ({ ...sample().lines[0], id: `m${i}` })) };
    const big = renderPremium(many);
    expect(big.container.querySelectorAll('[data-premium-row="filler"]')).toHaveLength(0);
    expect(big.container.querySelectorAll('[data-premium-row="line"]')).toHaveLength(14);
  });

  it('empty states: no QR, notes, bank, assets → those cards and images are absent, nothing crashes', () => {
    const model: DocumentModel = { ...sample(), qr: null, notes: null, terms: null, bank: null, stampUrl: null, signatureUrl: null, footerText: null, lines: [] };
    const { container } = renderPremium(model);
    expect(container.querySelector('[data-premium-qr]')).toBeNull();
    expect(container.querySelector('[data-premium-card]')).toBeNull();
    expect(container.querySelectorAll('[data-premium-sign-box] img')).toHaveLength(0);
    expect(container.querySelectorAll('[data-premium-row="filler"]')).toHaveLength(PREMIUM.minTableRows);
    expect(container.textContent).not.toMatch(/NaN|undefined|null/);
  });

  it('legacy payload without line detail falls back to the engine columns (no empty unit/discount columns)', () => {
    const model = sample();
    const legacy = { ...model, lines: model.lines.map(({ unit: _u, lineDiscount: _d, netAmount: _n, taxRate: _r, ...rest }) => rest) };
    const { container } = renderPremium(legacy);
    const heads = [...container.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(heads).toHaveLength(6);
    expect(heads.join('|')).not.toMatch(/(^|\|)الوحدة|الخصم|الخاضع|نسبة الضريبة/);
  });

  it('shows the draft notice only for notice statuses', () => {
    expect(renderPremium({ ...sample(), status: 'draft' }).container.querySelector('[data-premium-notice]')).toBeTruthy();
    cleanup();
    expect(renderPremium({ ...sample(), status: 'posted' }).container.querySelector('[data-premium-notice]')).toBeNull();
  });
});

describe('tax-invoice-premium-v1 direction and language', () => {
  it('RTL Arabic+English keeps the English line isolated LTR so punctuation (VAT No.) stays put', () => {
    const { container } = renderPremium(sample('rtl'));
    expect(container.querySelector('[data-doc-paper]')?.getAttribute('dir')).toBe('rtl');
    const bilingual = container.querySelector('[data-premium-party-row="vat_no"] [data-premium-bilingual]')!;
    expect(bilingual.children[0].textContent).toBe('الرقم الضريبي');
    expect(bilingual.children[1].getAttribute('dir')).toBe('ltr');
    expect(bilingual.children[1].textContent).toBe('VAT No.');
  });

  it('LTR English document renders English-only labels and an English amount in words', () => {
    locale.current = 'en';
    const { container } = renderPremium(sample('ltr'));
    expect(container.querySelector('[data-premium-header]')?.getAttribute('data-premium-mode')).toBe('en');
    expect(container.querySelector('[data-doc-paper]')?.getAttribute('dir')).toBe('ltr');
    expect(container.querySelector('[data-premium-header] h1')?.textContent).toBe('Tax Invoice');
    expect(container.querySelector('[data-premium-bilingual]')).toBeNull();
    expect(container.querySelector('[data-premium-words]')?.textContent).toMatch(/one thousand/i);
    expect(container.querySelector('[data-premium-words]')?.textContent).not.toMatch(/[؀-ۿ]{4}.*فقط/);
  });

  it('uses logical alignment only — no physical left/right utilities in the template source', () => {
    const source = readFileSync(resolve(__dirname, '../templates/tax-invoice-premium.tsx'), 'utf8');
    expect(source).not.toMatch(/\b(?:ml|mr|pl|pr|left|right|text-left|text-right)-/);
  });
});

describe('tax-invoice-premium-v1 studio integration (layout & block properties)', () => {
  it('honours section visibility and order from a saved layout', () => {
    const layout: DocSectionLayoutItem[] = [
      { key: 'header', visible: true },
      { key: 'items', visible: true },
      { key: 'parties', visible: true },
      { key: 'summary', visible: false },
      { key: 'footer', visible: false },
    ];
    const { container } = renderPremium(sample(), layout);
    const order = [...container.querySelectorAll('[data-doc-composition="tax_invoice_premium"] > header, [data-doc-composition="tax_invoice_premium"] > section, [data-doc-composition="tax_invoice_premium"] > footer')].map((n) => n.tagName === 'HEADER' ? 'header' : n.tagName === 'FOOTER' ? 'footer' : n.getAttribute('data-premium-items') !== null ? 'items' : 'parties');
    expect(order).toEqual(['header', 'items', 'parties']);
    expect(container.querySelector('[data-premium-summary]')).toBeNull();
  });

  it('composes notes/bank inside the summary row, and stands them alone when the summary is hidden', () => {
    const inline = renderPremium(sample(), FULL);
    expect(inline.container.querySelector('[data-premium-summary] [data-premium-card="notes"]')).toBeTruthy();
    expect(inline.container.querySelector('[data-premium-summary] [data-premium-card="bank"]')).toBeTruthy();
    expect(inline.container.querySelector('[data-premium-cards]')).toBeNull();
    cleanup();
    const alone = renderPremium(sample(), FULL.map((i) => (i.key === 'summary' ? { ...i, visible: false } : i)));
    expect(alone.container.querySelector('[data-premium-summary]')).toBeNull();
    expect(alone.container.querySelector('[data-premium-cards] [data-premium-card="bank"]')).toBeTruthy();
  });

  it('hides blocks the editor turned off (bank, signature+stamp, amount in words)', () => {
    const layout = FULL.map((i) => (['bank', 'signature', 'stamp', 'amountWords'].includes(i.key) ? { ...i, visible: false } : i));
    const { container } = renderPremium(sample(), layout);
    expect(container.querySelector('[data-premium-card="bank"]')).toBeNull();
    expect(container.querySelector('[data-premium-signatures]')).toBeNull();
    expect(container.querySelector('[data-premium-words]')).toBeNull();
  });

  it('applies saved item columns (order, custom label) and footer static content', () => {
    const layout: DocSectionLayoutItem[] = FULL.map((i) => {
      if (i.key === 'items') return { ...i, properties: { columns: [{ id: 'number' }, { id: 'product' }, { id: 'quantity', label: 'العدد' }, { id: 'total' }] } };
      if (i.key === 'footer') return { ...i, properties: { static_content: 'شكراً لتعاملكم' } };
      return i;
    });
    const { container } = renderPremium(sample(), layout);
    const heads = [...container.querySelectorAll('thead th')].map((th) => th.textContent);
    expect(heads).toHaveLength(4);
    expect(heads[2]).toBe('العدد');
    expect(container.querySelector('[data-premium-footer]')?.textContent).toContain('شكراً لتعاملكم');
  });

  it('respects explicit section flags when no layout is saved (logo/qr off)', () => {
    const { container } = renderPremium(sample(), null, { logo: false, qr: false, amountWords: false });
    expect(container.querySelector('[data-premium-logo]')).toBeNull();
    expect(container.querySelector('[data-premium-seller-name]')).toBeTruthy();
    expect(container.querySelector('[data-premium-qr]')).toBeNull();
    expect(container.querySelector('[data-premium-words]')).toBeNull();
  });

  it('follows the chosen theme: green = deep green identity, blue = derived deep blue', () => {
    const green = renderPremium(sample());
    expect(green.container.querySelector<HTMLElement>('[data-doc-composition="tax_invoice_premium"]')!.style.getPropertyValue('--pv-deep')).toBe('#0b3d2e');
    cleanup();
    const blue = render(<TaxInvoicePremium model={sample()} theme={getTheme('blue')} formatMoney={formatMoney} />);
    expect(blue.container.querySelector<HTMLElement>('[data-doc-composition="tax_invoice_premium"]')!.style.getPropertyValue('--pv-deep')).not.toBe('#0b3d2e');
  });
});

describe('tax-invoice-premium-v1 PDF export boundaries and image properties', () => {
  it('every section is a direct child of the capture root so the PDF exporter can break between them', () => {
    const { container } = renderPremium(sample(), FULL);
    const root = container.querySelector('[data-doc-composition="tax_invoice_premium"]')!;
    const direct = [...root.children].map((c) => c.getAttribute('data-premium-header') !== null ? 'header' : c.getAttribute('data-premium-parties') !== null ? 'parties' : c.getAttribute('data-premium-items') !== null ? 'items' : c.getAttribute('data-premium-summary') !== null ? 'summary' : c.getAttribute('data-premium-words') !== null ? 'words' : c.getAttribute('data-premium-signatures') !== null ? 'signatures' : c.getAttribute('data-premium-footer') !== null ? 'footer' : 'other');
    expect(direct).toEqual(['header', 'parties', 'items', 'summary', 'words', 'signatures', 'footer']);
  });

  it('honours the saved image size and opacity for stamp and signature (same classes as DocStamp/DocSignature)', () => {
    const layout = FULL.map((i) => (i.key === 'stamp' ? { ...i, properties: { image_size: 'lg' as const, image_opacity: 'faint' as const } } : i.key === 'signature' ? { ...i, properties: { image_size: 'sm' as const } } : i));
    const { container } = renderPremium(sample(), layout);
    const stamp = container.querySelector('img[alt="stamp"]')!;
    const sign = container.querySelector('img[alt="signature"]')!;
    expect(stamp.className).toContain('h-32');
    expect(stamp.className).toContain('opacity-50');
    expect(sign.className).toContain('h-10');
    cleanup();
    const plain = renderPremium(sample(), FULL);
    // بلا حجم محفوظ: الحجم المضغوط الافتراضي (يبقي العينة في صفحة واحدة).
    expect(plain.container.querySelector('img[alt="stamp"]')!.className).toContain('max-h-[13mm]');
    expect(plain.container.querySelector('img[alt="signature"]')!.className).toContain('max-h-[11mm]');
  });
});

describe('tax-invoice-premium-v1 saved alignment', () => {
  it('stamp and signature are aligned independently, each from its own saved alignment', () => {
    const layout = FULL.map((i) => (i.key === 'stamp' ? { ...i, properties: { alignment: 'start' as const } } : i.key === 'signature' ? { ...i, properties: { alignment: 'end' as const } } : i));
    const { container } = renderPremium(sample(), layout);
    expect(container.querySelector('[data-premium-stamp-cell]')!.className).toContain('justify-start');
    expect(container.querySelector('[data-premium-signature-cell]')!.className).toContain('justify-end');
  });

  it('a stamp alone (signature block hidden) still follows its own alignment', () => {
    const layout = FULL.map((i) => (i.key === 'signature' ? { ...i, visible: false } : i.key === 'stamp' ? { ...i, properties: { alignment: 'center' as const } } : i));
    const { container } = renderPremium(sample(), layout);
    expect(container.querySelector('[data-premium-signature-cell]')).toBeNull();
    expect(container.querySelector('[data-premium-stamp-cell]')!.className).toContain('justify-center');
  });

  it('item cells follow column alignment, then the saved items-block alignment, then the default', () => {
    const layout = FULL.map((i) => (i.key === 'items' ? { ...i, properties: { alignment: 'end' as const, columns: [{ id: 'number' as const }, { id: 'product' as const, alignment: 'center' as const }, { id: 'quantity' as const }, { id: 'total' as const }] } } : i));
    const { container } = renderPremium(sample(), layout);
    const heads = [...container.querySelectorAll('thead th')];
    expect(heads[0].className).toContain('text-end'); // يرث محاذاة الكتلة (لا الافتراضي start)
    expect(heads[1].className).toContain('text-center'); // محاذاة العمود تغلب
    expect(heads[2].className).toContain('text-end');
    const firstRow = [...container.querySelector('[data-premium-row="line"]')!.children];
    expect(firstRow[0].className).toContain('text-end');
    expect(firstRow[1].className).toContain('text-center');
    cleanup();
    const plain = renderPremium(sample(), FULL);
    expect([...plain.container.querySelectorAll('thead th')][1].className).toContain('text-start'); // الافتراضي كما كان
  });
});

describe('tax-invoice-premium-v1 saved items font size', () => {
  const withSize = (font_size?: 'sm' | 'md' | 'lg') => FULL.map((i) => (i.key === 'items' && font_size ? { ...i, properties: { font_size } } : i));

  it('applies the saved size to header cells, body cells and product/code content, replacing the fixed sizes', () => {
    const { container } = renderPremium(sample(), withSize('lg'));
    const root = container.querySelector('[data-premium-items]')!;
    expect(root.querySelector('thead th')!.className).toContain('text-base');
    expect(root.querySelector('tbody tr td')!.className).toContain('text-base');
    expect(root.innerHTML).not.toMatch(/text-\[(?:9\.5|10\.5|11\.5|9|10)px\]/);
    expect(root.querySelector('tbody td span[dir="auto"]')!.className).toContain('text-base');
  });

  it('keeps the compact sizes when no size is saved', () => {
    const { container } = renderPremium(sample(), withSize());
    const root = container.querySelector('[data-premium-items]')!;
    expect(root.querySelector('thead th')!.className).toContain('text-[9.5px]');
    expect(root.querySelector('tbody tr td')!.className).toContain('text-[10.5px]');
  });
});

describe('tax-invoice-premium-v1 multi-page', () => {
  it('40 lines render without filler and keep the summary/signature blocks unsplittable', () => {
    const model = makeDocumentQaModel({ scenario: 'multipage', direction: 'rtl', showQr: true, showAssets: true });
    const { container } = renderPremium(model);
    expect(container.querySelectorAll('[data-premium-row="line"]')).toHaveLength(40);
    expect(container.querySelectorAll('[data-premium-row="filler"]')).toHaveLength(0);
    for (const selector of ['[data-premium-summary]', '[data-premium-signatures]', '[data-premium-row="line"]']) {
      expect(container.querySelector(selector)?.className, selector).toContain('break-inside-avoid');
    }
  });
});
