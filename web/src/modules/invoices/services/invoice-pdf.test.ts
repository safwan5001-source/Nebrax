import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DocSectionLayoutItem } from '@/modules/documents/types';
import { createInvoicePdf, getInvoicePdfOrientation, resolvePdfBlockContent, type InvoicePdfInput } from './invoice-pdf';

// مسجِّل نصوص بديل عن jsPDF: يلتقط ما يُكتب في الصفحة دون محرك PDF حقيقي.
const written = vi.hoisted(() => ({ texts: [] as string[] }));
vi.mock('jspdf', () => {
  class FakePdf {
    internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
    text(value: string | string[]) { written.texts.push(...(Array.isArray(value) ? value : [value])); return this; }
    splitTextToSize(value: string) { return [value]; }
    getTextWidth() { return 10; }
    processArabic(value: string) { return value; }
    output() { return new Blob(['pdf']); }
    constructor() {
      return new Proxy(this, {
        get: (target, name, receiver) => (name in target ? Reflect.get(target, name, receiver) : () => target),
      });
    }
  }
  return { jsPDF: FakePdf };
});

const visibleTerms = (staticContent?: string): DocSectionLayoutItem[] => [
  { key: 'terms', visible: true, properties: staticContent === undefined ? undefined : { static_content: staticContent } },
  { key: 'bank', visible: false },
];

describe('تخطيط جدول PDF المتجهي', () => {
  it('يستخدم A4 أفقياً مع ترتيب الأعمدة الكامل', () => {
    expect(getInvoicePdfOrientation([
      { id: 'number' }, { id: 'product_code' }, { id: 'barcode' }, { id: 'product' },
      { id: 'description' }, { id: 'unit_price' }, { id: 'quantity' },
      { id: 'price_before_tax' }, { id: 'tax' }, { id: 'total' },
    ])).toBe('landscape');
  });

  it('يبقي الجداول المختصرة على A4 رأسي', () => {
    expect(getInvoicePdfOrientation([{ id: 'description' }, { id: 'quantity' }, { id: 'total' }])).toBe('portrait');
  });
});

describe('محتوى كتل PDF المتجهية', () => {
  it('يستخدم المحتوى الثابت للمراجعة المنشورة قبل القيمة الديناميكية', () => {
    expect(resolvePdfBlockContent(visibleTerms('يُسدَّد خلال 30 يوماً'), 'terms', 'قيمة حية أحدث'))
      .toBe('يُسدَّد خلال 30 يوماً');
  });

  it('لا يعرض كتلة مخفية حتى لو وُجدت قيمة ديناميكية', () => {
    expect(resolvePdfBlockContent(visibleTerms(), 'bank', 'IBAN SA0000000000000000000000')).toBeNull();
  });

  it('يعامل المحتوى الثابت الفارغ كتعطيل صريح ولا يتراجع للقيمة الديناميكية', () => {
    expect(resolvePdfBlockContent(visibleTerms('   '), 'terms', 'قيمة حية أحدث')).toBeNull();
  });

  it('يعرض القيمة الديناميكية فقط عند ظهور الكتلة وغياب محتواها الثابت', () => {
    expect(resolvePdfBlockContent(visibleTerms(), 'terms', 'قيمة متوافقة')).toBe('قيمة متوافقة');
  });
});

describe('سطر الفاتورة في PDF', () => {
  afterEach(() => { written.texts.length = 0; vi.unstubAllGlobals(); });
  const input = (line: { product_name: string | null; description: string | null }): InvoicePdfInput => ({
    invoice: {
      number: 'INV-1', invoice_date: '2026-08-17', payment_type: 'cash',
      subtotal: '95.00', tax_amount: '14.25', total: '109.25',
      lines: [{
        id: 'l1', product_code: 'SKU-003', barcode: null, quantity: 1,
        unit_price: '95.00', unit_price_before_tax: '95.00', tax_rate: 15, line_tax: '14.25', line_total: '109.25',
        ...line,
      }],
    },
    company: null, customer: null,
    labels: new Proxy({}, { get: (_t, key) => String(key) }) as unknown as InvoicePdfInput['labels'],
    locale: 'en',
  } as unknown as InvoicePdfInput);
  const render = async (line: { product_name: string | null; description: string | null }) => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(8) })));
    await createInvoicePdf(input(line));
    return written.texts;
  };
  it('يكتب الوصف المخصَّص في عمود الوصف ولا يستبدله باسم المنتج الافتراضي', async () => {
    const texts = await render({ product_name: 'A4 paper carton', description: 'A4 paper carton — bundled with delivery' });
    expect(texts).toContain('A4 paper carton — bundled with delivery');
    // اسم المنتج يبقى في عموده الخاص كلقطة هوية، لا في مكان الوصف.
    expect(texts).toContain('A4 paper carton');
  });
});
