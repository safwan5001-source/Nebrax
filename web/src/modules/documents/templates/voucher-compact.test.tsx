// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { VoucherCompact } from './voucher-compact';
import { DocPageFrameProvider } from '../components/doc-page-frame-context';
import { getTheme } from '../themes';
import { makeDocumentQaModel } from '../qa/document-qa-fixtures';
import type { DocumentModel } from '../types';
import type { DocPageFrame } from '../services/output-spec';

const locale = { current: 'ar' };

vi.mock('next-intl', () => ({
  useLocale: () => locale.current,
  useTranslations: (namespace: string) => (key: string) => `${namespace}.${key}`,
}));

const theme = getTheme('blue');
const formatMoney = (minor: number) => `M${minor}`;

type VoucherOverride = { [K in keyof NonNullable<DocumentModel['voucher']>]?: NonNullable<DocumentModel['voucher']>[K] | null };

function model(over: Omit<Partial<DocumentModel>, 'voucher'> & { voucher?: VoucherOverride | null } = {}, type: 'receipt_voucher' | 'payment_voucher' = 'receipt_voucher', scenario: 'single' | 'three' = 'three'): DocumentModel {
  const base = makeDocumentQaModel({ documentType: type, scenario, direction: 'rtl', showQr: true, showAssets: true });
  const { voucher, ...rest } = over;
  return { ...base, language: 'ar', ...rest, voucher: voucher === null ? null : ({ ...base.voucher!, ...voucher } as NonNullable<DocumentModel['voucher']>) };
}

function frame(contentWidthMm: number, contentMinHeightMm: number): DocPageFrame {
  return {
    paperWidthMm: contentWidthMm + 20, paperHeightMm: contentMinHeightMm + 20,
    marginsMm: { top: 10, right: 10, bottom: 10, left: 10 }, contentWidthMm, contentMinHeightMm,
  } as DocPageFrame;
}

function renderVoucher(m: DocumentModel, sections?: Parameters<typeof VoucherCompact>[0]['sections'], f: DocPageFrame | null = null) {
  const ui = <VoucherCompact model={m} theme={theme} formatMoney={formatMoney} sections={sections} />;
  return render(f ? <DocPageFrameProvider value={f}>{ui}</DocPageFrameProvider> : ui);
}

afterEach(() => { cleanup(); locale.current = 'ar'; });

describe('VoucherCompact — محتوى السند من السجلّ وحده', () => {
  it('يعرض الطرف والمبلغ والتفقيط والتفاصيل والتخصيصات والفرع بلا اختلاق', () => {
    const m = model();
    const { container } = renderVoucher(m);
    const text = container.textContent ?? '';
    expect(text).toContain(m.buyer.name);
    expect(text).toContain(`M${m.voucher!.amount}`);
    expect(text).toContain('استلمنا من');
    expect(container.querySelector('[data-voucher-words]')?.textContent).toContain('ريال');
    for (const value of [m.voucher!.reference!, m.voucher!.methodName!, m.voucher!.accountName!, m.voucher!.paymentDetails!, m.voucher!.collectorName!, m.voucher!.classificationName!, m.voucher!.branchName!]) {
      expect(text).toContain(value);
    }
    expect(container.querySelectorAll('[data-voucher-allocations] tr')).toHaveLength(m.voucher!.allocations!.length);
    for (const a of m.voucher!.allocations!) expect(text).toContain(`M${a.amount}`);
  });

  it('لا يعرض حقلاً بلا قيمة ولا جدول تخصيصات فارغاً ولا ملاحظات فارغة', () => {
    const m = model({
      voucher: { methodName: null, paymentDetails: null, accountName: null, collectorName: null, classificationName: null, branchName: null, reference: null, allocations: [] },
      notes: '   ',
    });
    const { container } = renderVoucher(m);
    const text = container.textContent ?? '';
    for (const key of ['account', 'payment_details', 'collector', 'classification', 'description']) expect(text).not.toContain(`voucherDoc.${key}`);
    expect(container.querySelector('[data-voucher-allocations]')).toBeNull();
    expect(container.querySelector('[data-voucher-notes]')).toBeNull();
    // الطريقة تبقى (حقل جوهري)، والمرجع يختفي.
    expect(container.querySelectorAll('[data-voucher-field]')).toHaveLength(1);
  });

  it('لا QR ولا باركود ولا حقول ضريبية في السند (لا مصدر QR معتمد)', () => {
    const m = model({ qr: { value: 'ZATCA-QR-VALUE' } });
    const { container } = renderVoucher(m);
    expect(container.querySelector('svg, canvas')).toBeNull();
    expect(container.textContent).not.toContain('ZATCA-QR-VALUE');
    expect(container.querySelector('table thead')).toBeNull();
  });

  it('اتجاه السند يحدد العبارة: قبض = استلمنا من، صرف = صرفنا إلى', () => {
    expect(renderVoucher(model()).container.textContent).toContain('استلمنا من');
    cleanup();
    const paid = renderVoucher(model({}, 'payment_voucher')).container.textContent ?? '';
    expect(paid).toContain('صرفنا إلى');
    expect(paid).not.toContain('استلمنا من');
  });

  it('عنوان السند ورقمه وتاريخه من الترويسة، والمسودة/الملغى يوسَمان فقط', () => {
    const m = model();
    const { container, rerender } = renderVoucher(m);
    const text = container.textContent ?? '';
    expect(text).toContain(m.meta.number);
    expect(text).toContain(m.meta.date);
    expect(container.textContent).not.toContain('مسودة');
    rerender(<VoucherCompact model={{ ...m, status: 'draft' }} theme={theme} formatMoney={formatMoney} />);
    expect(container.textContent).toContain('مسودة');
    rerender(<VoucherCompact model={{ ...m, status: 'posted' }} theme={theme} formatMoney={formatMoney} />);
    expect(container.textContent).not.toContain('مسودة');
  });

  it('توقيع الشركة في خانة جهتها: المستلِم في القبض والمسلِّم في الصرف، والخانة الأخرى بلا صورة', () => {
    const cellsOf = (c: HTMLElement) => [...c.querySelectorAll('[data-voucher-signatures] > div')].filter((el) => el.querySelector('div.border-t'));
    const received = renderVoucher(model());
    const withSig = (c: HTMLElement) => cellsOf(c).filter((el) => el.querySelector('img[alt="signature"]'));
    expect(withSig(received.container)).toHaveLength(1);
    expect(withSig(received.container)[0].textContent).toContain('voucherDoc.receiver_signature');
    cleanup();
    const paid = renderVoucher(model({}, 'payment_voucher'));
    expect(withSig(paid.container)).toHaveLength(1);
    expect(withSig(paid.container)[0].textContent).toContain('voucherDoc.payer_signature');
  });

  it('لا ختم/توقيع/شعار بلا صورة، ويُحترم إخفاؤها من الأقسام', () => {
    const noAssets = model({ stampUrl: null, signatureUrl: null, seller: { ...model().seller, logoUrl: null } });
    expect(renderVoucher(noAssets).container.querySelectorAll('img')).toHaveLength(0);
    cleanup();
    const withAssets = model();
    expect(renderVoucher(withAssets).container.querySelectorAll('img').length).toBeGreaterThanOrEqual(3);
    cleanup();
    const hidden = renderVoucher(withAssets, { logo: false, stamp: false, signature: false });
    expect(hidden.container.querySelectorAll('img')).toHaveLength(0);
  });

  it('الأقسام تُخفى بأعلامها: التفقيط والملاحظات والتذييل', () => {
    const m = model({ footerText: 'تذييل الاختبار', notes: 'ملاحظة الاختبار' });
    const shown = renderVoucher(m).container;
    expect(shown.querySelector('[data-voucher-words]')).not.toBeNull();
    expect(shown.textContent).toContain('ملاحظة الاختبار');
    expect(shown.textContent).toContain('تذييل الاختبار');
    cleanup();
    const hidden = renderVoucher(m, { amountWords: false, notes: false, footer: false }).container;
    expect(hidden.querySelector('[data-voucher-words]')).toBeNull();
    expect(hidden.textContent).not.toContain('ملاحظة الاختبار');
    expect(hidden.textContent).not.toContain('تذييل الاختبار');
  });

  it('مستند بلا بيانات سند لا يرسم شيئاً', () => {
    expect(renderVoucher(model({ voucher: null })).container.innerHTML).toBe('');
  });

  it('الإنجليزية: تسميات وتفقيط إنجليزيان بلا حروف عربية في الجسم المترجَم', () => {
    locale.current = 'en';
    const m = { ...model(), language: 'en' as const, direction: 'ltr' as const };
    const text = renderVoucher(m).container.querySelector('[data-voucher-compact]')?.textContent ?? '';
    expect(text).toContain('Received from');
    expect(text).toContain('Amount in words');
  });
});

describe('VoucherCompact — الكثافة حسب إطار الصفحة', () => {
  const density = (f: DocPageFrame | null) => {
    const { container } = renderVoucher(model(), undefined, f);
    const root = container.querySelector('[data-voucher-compact]')!;
    const grid = root.querySelector('[data-voucher-field]')!.parentElement!;
    const out = { density: root.getAttribute('data-voucher-density'), cols: grid.className.match(/grid-cols-\d/)?.[0] };
    cleanup();
    return out;
  };

  it('بلا إطار (A4 التاريخي) كثافة عادية بثلاثة أعمدة', () => {
    expect(density(null)).toEqual({ density: 'normal', cols: 'grid-cols-3' });
  });
  it('A5 أفقي: عادية بثلاثة أعمدة؛ A5 عمودي: عادية بعمودين', () => {
    expect(density(frame(190, 128))).toEqual({ density: 'normal', cols: 'grid-cols-3' });
    expect(density(frame(128, 190))).toEqual({ density: 'normal', cols: 'grid-cols-2' });
  });
  it('A6 أفقي: مضغوطة بثلاثة أعمدة بلا حذف أي حقل', () => {
    expect(density(frame(132, 89))).toEqual({ density: 'tight', cols: 'grid-cols-3' });
    const m = model();
    const { container } = renderVoucher(m, undefined, frame(132, 89));
    expect(container.querySelectorAll('[data-voucher-field]')).toHaveLength(6); // الطريقة والمرجع والحساب والتفاصيل والمُحصِّل والتصنيف (الفرع في الترويسة)
  });
});
