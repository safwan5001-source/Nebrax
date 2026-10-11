import type { SourceCreditNote, SourceCreditNoteLine } from '../builder/from-credit-note';
import type { SourceCompany, SourceCustomer } from '../builder/from-invoice';

/**
 * إشعارات دائنة بصيغة حمولة الـ API (المبالغ بالريال نصّاً) لتحقق بصري يدوي. كل سطر يُبنى
 * من مبالغ مخزَّنة بالهللة كما يخزّنها الخادم: الإجمالي = line_subtotal − line_discount + line_tax،
 * والمجموع الصافي للإشعار = Σ(line_subtotal − line_discount). لا تُشتق هنا مبالغ من أسعار مقرَّبة.
 */
export const CREDIT_NOTE_QA_SCENARIOS = [
  'inclusive', 'exclusive', 'line_discount', 'header_discount', 'rounding', 'vat5',
  'mixed_rates', 'partial', 'historical', 'long_names', 'many_lines',
] as const;
export type CreditNoteQaScenario = (typeof CREDIT_NOTE_QA_SCENARIOS)[number];

export const CREDIT_NOTE_QA_COMPANY: SourceCompany = {
  name: 'شركة نبراس الطموح للتجارة',
  vat_number: '300012345600003',
  cr_number: '2050123456',
  currency: 'SAR',
};
export const CREDIT_NOTE_QA_CUSTOMER: SourceCustomer = { name: 'مؤسسة الأفق للمقاولات', vat_number: '310987654300003', city: 'الدمام' };

const riyal = (minor: number) => `${Math.trunc(minor / 100)}.${String(minor % 100).padStart(2, '0')}`;

interface StoredLine {
  description: string;
  quantity: number;
  /** unit_price المخزَّن (شامل الضريبة على فاتورة شاملة). */
  unit: number;
  /** unit_price_before_tax المخزَّن. */
  before: number;
  gross: number;
  discount: number;
  tax: number;
  rate?: number;
}

function line(id: string, l: StoredLine): SourceCreditNoteLine {
  return {
    id,
    description: l.description,
    quantity: l.quantity,
    unit_price: riyal(l.unit),
    unit_price_before_tax: riyal(l.before),
    tax_rate: l.rate ?? 15,
    line_subtotal: riyal(l.gross),
    line_discount: riyal(l.discount),
    line_tax: riyal(l.tax),
    line_total: riyal(l.gross - l.discount + l.tax),
  };
}

function note(lines: StoredLine[], reason: string): SourceCreditNote {
  const net = lines.reduce((s, l) => s + l.gross - l.discount, 0);
  const tax = lines.reduce((s, l) => s + l.tax, 0);
  return {
    number: 'CN-2026-0042',
    note_date: '2026-10-11',
    subtotal: riyal(net),
    tax_amount: riyal(tax),
    total: riyal(net + tax),
    reason,
    type: 'sales',
    lines: lines.map((l, i) => line(`l${i + 1}`, l)),
  };
}

function manyLines(): StoredLine[] {
  return Array.from({ length: 28 }, (_, i) => {
    const quantity = 1 + (i % 4);
    const unit = 1500 + i * 250;
    const gross = quantity * unit;
    const discount = i % 5 === 0 ? Math.round(gross * 0.1) : 0;
    return {
      description: `بند رقم ${i + 1} — خدمة تركيب وصيانة`,
      quantity, unit, before: unit, gross, discount, tax: Math.round(((gross - discount) * 15) / 100),
    };
  });
}

export function makeCreditNoteQaNote(scenario: CreditNoteQaScenario): SourceCreditNote {
  switch (scenario) {
    case 'inclusive':
      return note([{ description: 'خدمة صيانة — فاتورة شاملة الضريبة', quantity: 1, unit: 11500, before: 10000, gross: 10000, discount: 0, tax: 1500 }], 'إلغاء جزئي');
    case 'exclusive':
      return note([{ description: 'ترخيص برنامج — فاتورة غير شاملة', quantity: 2, unit: 5000, before: 5000, gross: 10000, discount: 0, tax: 1500 }], 'مرتجع');
    case 'line_discount':
      return note([{ description: 'اشتراك سنوي بخصم على السطر', quantity: 1, unit: 10000, before: 10000, gross: 10000, discount: 2000, tax: 1200 }], 'مرتجع بخصم');
    case 'header_discount':
      return note([
        { description: 'جهاز طباعة', quantity: 1, unit: 10000, before: 10000, gross: 10000, discount: 875, tax: 1369 },
        { description: 'حبر طباعة', quantity: 2, unit: 5000, before: 5000, gross: 10000, discount: 875, tax: 1369 },
        { description: 'عقد صيانة', quantity: 1, unit: 20000, before: 20000, gross: 20000, discount: 1750, tax: 2738 },
      ], 'خصم الرأس 35.00 موزَّع على البنود');
    case 'rounding':
      return note([{ description: 'قطعة صغيرة (٧ وحدات)', quantity: 7, unit: 10, before: 9, gross: 61, discount: 0, tax: 9 }], 'تقريب هللات');
    case 'vat5':
      return note([{ description: 'خدمة بنسبة ضريبة 5%', quantity: 1, unit: 10000, before: 10000, gross: 10000, discount: 0, tax: 500, rate: 5 }], 'نسبة 5%');
    case 'mixed_rates':
      return note([
        { description: 'سلعة خاضعة 15%', quantity: 1, unit: 10000, before: 10000, gross: 10000, discount: 0, tax: 1500 },
        { description: 'سلعة بنسبة صفر', quantity: 1, unit: 10000, before: 10000, gross: 10000, discount: 0, tax: 0, rate: 0 },
      ], 'نسب متعددة');
    case 'partial':
      return note([{ description: 'إشعار جزئي: وحدتان من ثلاث', quantity: 2, unit: 10000, before: 10000, gross: 20000, discount: 0, tax: 3000 }], 'إشعار جزئي');
    case 'long_names':
      return note([
        { description: 'خدمات الاستشارات الهندسية والإشراف الفني على أعمال التركيبات الكهربائية والميكانيكية لمشروع المجمع السكني المرحلة الثانية', quantity: 1, unit: 10000, before: 10000, gross: 10000, discount: 1000, tax: 1350 },
        { description: 'Supply, installation, testing and commissioning of the HVAC chilled-water distribution system including all associated fittings', quantity: 3, unit: 3333, before: 3333, gross: 9999, discount: 0, tax: 1500 },
        { description: 'مسمار-برغي-صامولة-حلقة-تثبيت-فولاذ-مقاوم-للصدأ-بدون-مسافات-لاختبار-الالتفاف-في-الخلية', quantity: 5, unit: 200, before: 200, gross: 1000, discount: 0, tax: 150 },
      ], 'أسماء طويلة');
    case 'many_lines':
      return note(manyLines(), 'اختبار فواصل الصفحات');
    case 'historical': {
      // حمولة إشعار صدر قبل REM-02: لا سعر قبل الضريبة ولا خصم ولا نسبة ولا line_subtotal.
      return {
        number: 'CN-2026-0007', note_date: '2026-03-01', subtotal: '100.00', tax_amount: '15.00', total: '115.00', reason: 'إشعار سابق', type: 'sales',
        lines: [{ id: 'h1', description: 'بند من إشعار قديم', quantity: 2, unit_price: '50.00', line_tax: '15.00', line_total: '115.00' }],
      };
    }
  }
}
