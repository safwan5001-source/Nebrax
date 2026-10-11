import { describe, expect, it } from 'vitest';
import { buildCreditNoteDocumentModel, type SourceCreditNote, type SourceCreditNoteLine } from './from-credit-note';

/** هللات → نص ريال كما يخرجه الـ API (`Money::toRiyal`). */
const riyal = (minor: number) => `${Math.trunc(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;

/** سطر كما يخزّنه الخادم: gross قبل الخصم، discount، tax؛ والإجمالي = gross − discount + tax. */
function storedLine(input: {
  id?: string;
  quantity: number;
  unit: number;
  unitBeforeTax?: number;
  gross: number;
  discount: number;
  tax: number;
  rate?: number;
}): SourceCreditNoteLine {
  return {
    id: input.id ?? 'l1',
    description: 'بند',
    quantity: input.quantity,
    unit_price: riyal(input.unit),
    unit_price_before_tax: riyal(input.unitBeforeTax ?? input.unit),
    tax_rate: input.rate ?? 15,
    line_subtotal: riyal(input.gross),
    line_discount: riyal(input.discount),
    line_tax: riyal(input.tax),
    line_total: riyal(input.gross - input.discount + input.tax),
  };
}

/** إشعار كما يرحّله الخادم: subtotal صافٍ بعد الخصم = Σ(line_subtotal − line_discount). */
function storedNote(lines: SourceCreditNoteLine[]): SourceCreditNote {
  const minor = (v?: string | null) => Math.round(Number(v ?? 0) * 100);
  const net = lines.reduce((s, l) => s + minor(l.line_subtotal) - minor(l.line_discount), 0);
  const tax = lines.reduce((s, l) => s + minor(l.line_tax), 0);
  return {
    number: 'CN-1',
    note_date: '2026-10-11',
    subtotal: riyal(net),
    tax_amount: riyal(tax),
    total: riyal(net + tax),
    type: 'sales',
    lines,
  };
}

const build = (note: SourceCreditNote, direction: 'rtl' | 'ltr' = 'rtl') =>
  buildCreditNoteDocumentModel({ note, company: { name: 'نبراس' }, customer: null, direction });

/** كل ما يجب أن يصدق على أي مستند مطبوع. */
function expectPrintedInvariants(model: ReturnType<typeof build>, note: SourceCreditNote) {
  const posted = {
    subtotal: Math.round(Number(note.subtotal) * 100),
    tax: Math.round(Number(note.tax_amount) * 100),
    total: Math.round(Number(note.total) * 100),
  };
  // 1) مجموع الإجماليات المطبوعة للأسطر = إجمالي المستند المرحَّل.
  expect(model.lines.reduce((s, l) => s + l.total, 0)).toBe(posted.total);
  // 2) الضريبة تطابق المرحَّلة بالهللة، والإجمالي والضريبة لا يتغيران في الطباعة.
  expect(model.lines.reduce((s, l) => s + l.tax, 0)).toBe(posted.tax);
  expect(model.totals.tax).toBe(posted.tax);
  expect(model.totals.total).toBe(posted.total);
  // 3) كل سطر: الصافي + الضريبة = الإجمالي.
  for (const l of model.lines) expect((l.netAmount ?? NaN) + l.tax).toBe(l.total);
  // 4) الخصم لا يُحتسب مرتين: المجموع المطبوع − الخصم المطبوع = المجموع المرحَّل الصافي.
  expect(model.totals.subtotal - (model.totals.discount ?? 0)).toBe(posted.subtotal);
  expect(model.totals.subtotal - (model.totals.discount ?? 0) + model.totals.tax).toBe(model.totals.total);
}

describe('credit-note print reconciliation', () => {
  it('one unit on a VAT-inclusive invoice: 115.00 = 100.00 + 15.00, no discount row', () => {
    const note = storedNote([storedLine({ quantity: 1, unit: 11500, unitBeforeTax: 10000, gross: 10000, discount: 0, tax: 1500 })]);
    const model = build(note);

    expect(model.lines[0]).toMatchObject({
      unitPrice: 10000, priceBeforeTax: 10000, discount: 0, netAmount: 10000, taxRate: 15, tax: 1500, total: 11500, unitPriceRounded: false,
    });
    expect(model.totals).toEqual({ subtotal: 10000, tax: 1500, total: 11500, taxRate: 15 });
    expect(model.totals.discount).toBeUndefined();
    expectPrintedInvariants(model, note);
  });

  it('line discount: 100.00 − 20.00 + 12.00 VAT = 92.00, discount shown explicitly', () => {
    const note = storedNote([storedLine({ quantity: 1, unit: 10000, gross: 10000, discount: 2000, tax: 1200 })]);
    const model = build(note);

    expect(model.lines[0]).toMatchObject({ discount: 2000, netAmount: 8000, tax: 1200, total: 9200 });
    // المرحَّل: subtotal 80.00 (صافٍ). المطبوع: 100.00 − 20.00 + 12.00 = 92.00.
    expect(note.subtotal).toBe('80.00');
    expect(model.totals).toMatchObject({ subtotal: 10000, discount: 2000, tax: 1200, total: 9200 });
    expectPrintedInvariants(model, note);
  });

  it('header discount allocated across lines is counted once', () => {
    // فاتورة 100 + 100، خصم رأس 20 → حصة 10 لكل سطر؛ الضريبة على الصافي 90: 13.50 لكل سطر.
    const note = storedNote([
      storedLine({ id: 'a', quantity: 1, unit: 10000, gross: 10000, discount: 1000, tax: 1350 }),
      storedLine({ id: 'b', quantity: 1, unit: 10000, gross: 10000, discount: 1000, tax: 1350 }),
    ]);
    const model = build(note);

    expect(note).toMatchObject({ subtotal: '180.00', tax_amount: '27.00', total: '207.00' });
    expect(model.totals).toMatchObject({ subtotal: 20000, discount: 2000, tax: 2700, total: 20700 });
    expectPrintedInvariants(model, note);
  });

  it('line discount plus header share combine into one stored discount per line, never doubled', () => {
    // خصم سطر 5.00 + حصة رأس 5.00 = 10.00 مخزَّنة في line_discount؛ لا يُضاف شيء فوقها.
    const note = storedNote([storedLine({ quantity: 1, unit: 10000, gross: 10000, discount: 1000, tax: 1350 })]);
    const model = build(note);
    expect(model.lines[0].discount).toBe(1000);
    expect(model.totals.discount).toBe(1000);
    expectPrintedInvariants(model, note);
  });

  it('multi-unit inclusive line: authoritative net/tax/total are printed, the rounded unit price is flagged', () => {
    // 7 × 0.10 شامل 15%: الضريبة 0.09 والصافي 0.61 والإجمالي 0.70؛ السعر قبل الضريبة 0.09 للعرض فقط.
    const note = storedNote([storedLine({ quantity: 7, unit: 10, unitBeforeTax: 9, gross: 61, discount: 0, tax: 9 })]);
    const model = build(note);

    expect(model.lines[0]).toMatchObject({ unitPrice: 9, netAmount: 61, tax: 9, total: 70, unitPriceRounded: true });
    // 7 × 0.09 = 0.63 ≠ 0.61: لا يُشتق السطر من السعر المقرَّب، ولا يُعرض صفّ تسوية مختلق.
    expect(model.lines[0].quantity * model.lines[0].unitPrice).not.toBe(model.lines[0].netAmount);
    expect(model.totals.discount).toBeUndefined();
    expectPrintedInvariants(model, note);
  });

  it('review-thread example: 7 × 0.01 at 15% prints net 0.06 + VAT 0.01 = 0.07 and flags the rounded unit price', () => {
    const note = storedNote([storedLine({ quantity: 7, unit: 1, unitBeforeTax: 1, gross: 6, discount: 0, tax: 1 })]);
    const model = build(note);

    expect(model.lines[0]).toMatchObject({ quantity: 7, unitPrice: 1, netAmount: 6, tax: 1, total: 7, unitPriceRounded: true });
    expectPrintedInvariants(model, note);
  });

  it('partial credit notes of one line each reconcile and sum to the charged line', () => {
    // خط 3 × 0.10 شامل: صافي 0.26 وضريبة 0.04 موزَّعان تراكمياً 8/9/9 و1/1/2.
    const parts = [
      { net: 8, tax: 1 },
      { net: 9, tax: 1 },
      { net: 9, tax: 2 },
    ].map((p, i) => storedNote([storedLine({ id: `p${i}`, quantity: 1, unit: 10, unitBeforeTax: 9, gross: p.net, discount: 0, tax: p.tax })]));

    const models = parts.map((n) => build(n));
    models.forEach((m, i) => expectPrintedInvariants(m, parts[i]));

    expect(models.reduce((s, m) => s + m.totals.total, 0)).toBe(30);
    expect(models.reduce((s, m) => s + m.totals.tax, 0)).toBe(4);
    expect(models.reduce((s, m) => s + (m.lines[0].netAmount ?? 0), 0)).toBe(26);
  });

  it('single non-15% rate is announced for the VAT row; mixed rates drop the percentage', () => {
    const five = build(storedNote([storedLine({ quantity: 1, unit: 10000, gross: 10000, discount: 0, tax: 500, rate: 5 })]));
    expect(five.totals.taxRate).toBe(5);

    const mixed = build(storedNote([
      storedLine({ id: 'a', quantity: 1, unit: 10000, gross: 10000, discount: 0, tax: 1500, rate: 15 }),
      storedLine({ id: 'b', quantity: 1, unit: 10000, gross: 10000, discount: 0, tax: 0, rate: 0 }),
    ]));
    expect(mixed.totals.taxRate).toBeNull();
  });
});

describe('credit-note print — historical payloads', () => {
  it('payload from before REM-02 (no pre-tax price, discount or rate) keeps stored totals and invents nothing', () => {
    const note: SourceCreditNote = {
      number: 'CN-OLD', note_date: '2026-01-01', subtotal: '100.00', tax_amount: '15.00', total: '115.00', type: 'sales',
      lines: [{ id: 'o1', description: 'قديم', quantity: 2, unit_price: '50.00', line_tax: '15.00', line_total: '115.00' }],
    };
    const model = build(note);

    expect(model.lines[0]).toMatchObject({
      unitPrice: 5000, priceBeforeTax: null, discount: null, netAmount: 10000, taxRate: null, tax: 1500, total: 11500,
    });
    // بلا نسبة معلنة يبقى عنوان الضريبة كما كان، وبلا صف خصم.
    expect(model.totals).toEqual({ subtotal: 10000, tax: 1500, total: 11500 });
    expectPrintedInvariants(model, note);
  });

  it('pre-REM-02 payload that carries line_subtotal proves a zero discount and an exclusive unit price', () => {
    const note: SourceCreditNote = {
      number: 'CN-OLD2', note_date: '2026-01-01', subtotal: '100.00', tax_amount: '15.00', total: '115.00', type: 'sales',
      lines: [{ id: 'o1', description: 'قديم', quantity: 2, unit_price: '50.00', tax_rate: 15, line_subtotal: '100.00', line_tax: '15.00', line_total: '115.00' }],
    };
    const model = build(note);

    expect(model.lines[0]).toMatchObject({ priceBeforeTax: 5000, discount: 0, netAmount: 10000, taxRate: 15, unitPriceRounded: false });
    expectPrintedInvariants(model, note);
  });

  it('stored amounts that do not reconcile never produce a discount row', () => {
    // line_subtotal − line_discount (80.00) ≠ الإجمالي − الضريبة (85.00): بيانات غير قابلة للتفسير.
    const note: SourceCreditNote = {
      number: 'CN-ODD', note_date: '2026-01-01', subtotal: '85.00', tax_amount: '12.00', total: '97.00', type: 'sales',
      lines: [{
        id: 'x', description: 'x', quantity: 1, unit_price: '100.00', unit_price_before_tax: '100.00', tax_rate: 15,
        line_subtotal: '100.00', line_discount: '20.00', line_tax: '12.00', line_total: '97.00',
      }],
    };
    const model = build(note);

    expect(model.lines[0].discount).toBeNull();
    expect(model.lines[0].netAmount).toBe(8500);
    expect(model.totals.discount).toBeUndefined();
    expect(model.totals.subtotal).toBe(8500);
    expect(model.totals.total).toBe(9700);
  });

  it('document totals that do not match their lines are printed as stored, with no adjustment invented', () => {
    const note: SourceCreditNote = {
      number: 'CN-DRIFT', note_date: '2026-01-01', subtotal: '90.00', tax_amount: '13.50', total: '103.50', type: 'sales',
      lines: [{
        id: 'x', description: 'x', quantity: 1, unit_price: '100.00', unit_price_before_tax: '100.00', tax_rate: 15,
        line_subtotal: '100.00', line_discount: '20.00', line_tax: '12.00', line_total: '92.00',
      }],
    };
    const model = build(note);

    expect(model.totals).toMatchObject({ subtotal: 9000, tax: 1350, total: 10350 });
    expect(model.totals.discount).toBeUndefined();
  });
});

describe('credit-note print — invariants over seeded random notes', () => {
  function rng(seed: number) {
    let s = seed;
    return () => {
      s = (s * 1664525 + 1013904223) % 4294967296;
      return s / 4294967296;
    };
  }

  it('Σ line totals = posted total, Σ VAT = posted VAT, discount counted once, ar = en', () => {
    const rand = rng(20261011);
    for (let n = 0; n < 300; n += 1) {
      const lineCount = 1 + Math.floor(rand() * 4);
      const lines = Array.from({ length: lineCount }, (_, i) => {
        const quantity = 1 + Math.floor(rand() * 9);
        const unitBeforeTax = 1 + Math.floor(rand() * 5000);
        const gross = Math.max(1, Math.round(unitBeforeTax * quantity * (0.9 + rand() * 0.2)));
        const discount = rand() < 0.5 ? 0 : Math.floor(rand() * gross);
        const rate = rand() < 0.2 ? 5 : 15;
        const tax = Math.floor(((gross - discount) * rate) / 100 + rand());
        return storedLine({ id: `l${i}`, quantity, unit: unitBeforeTax, unitBeforeTax, gross, discount, tax, rate });
      });
      const note = storedNote(lines);
      const ar = build(note, 'rtl');
      const en = build(note, 'ltr');

      expectPrintedInvariants(ar, note);
      // عربي وإنجليزي: النتائج المالية متطابقة تماماً، والاتجاه وحده يختلف.
      expect({ ...ar, direction: 'x' }).toEqual({ ...en, direction: 'x' });
    }
  });
});
