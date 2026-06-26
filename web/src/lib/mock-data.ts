// بيانات وهمية واقعية لوضع المعاينة (Demo). كل المبالغ بالريال كنصوص (مثل ما يعيده الـ API)
// لأن التحويل من الهللات يتم في طبقة موارد الـ backend. لا يُستخدم أي float في حساب مالي حقيقي هنا.

import { DEMO_USER } from './demo';

// ── العملاء ───────────────────────────────────────────────────────────────
export interface MockPartner {
  id: string;
  name: string;
  type: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  vat_number: string | null;
}

export const mockPartners: MockPartner[] = [
  { id: 'p1', name: 'مؤسسة الخليج للتجارة', type: 'customer', email: 'info@gulf-trade.sa', phone: '0138012345', city: 'الدمام', vat_number: '311111111100003' },
  { id: 'p2', name: 'شركة الواحة للمقاولات', type: 'customer', email: 'accounts@alwaha.sa', phone: '0138023456', city: 'الخبر', vat_number: '312222222200003' },
  { id: 'p3', name: 'مصنع الشرق للبلاستيك', type: 'customer', email: 'sales@east-plast.sa', phone: '0138034567', city: 'الجبيل', vat_number: '313333333300003' },
  { id: 'p4', name: 'مؤسسة نجد للتوريدات', type: 'customer', email: 'po@najd-supply.sa', phone: '0138045678', city: 'الظهران', vat_number: '314444444400003' },
  { id: 'p5', name: 'شركة البحر الأحمر اللوجستية', type: 'customer', email: 'ops@redsea-log.sa', phone: '0138056789', city: 'الدمام', vat_number: '315555555500003' },
  { id: 'p6', name: 'مؤسسة الفيصل للأجهزة', type: 'customer', email: 'buy@faisal-dev.sa', phone: '0138067890', city: 'الأحساء', vat_number: '316666666600003' },
];

// ── الفواتير ──────────────────────────────────────────────────────────────
export interface MockLine {
  id: string;
  description: string | null;
  quantity: number;
  unit_price: string;
  tax_rate: number;
  line_subtotal: string;
  line_tax: string;
  line_total: string;
}
export interface MockInvoice {
  id: string;
  number: string;
  partner_id: string;
  payment_type: string;
  status: string;
  payment_status: string;
  invoice_date: string;
  subtotal: string;
  tax_amount: string;
  total: string;
  paid_amount: string;
  remaining: string;
  lines: MockLine[];
}

// مولّد سطر واحد متّسق (الإجماليات مشتقّة من الكمية × السعر + الضريبة).
function line(id: string, description: string, quantity: number, unitPrice: number): MockLine {
  const subtotal = quantity * unitPrice;
  const tax = Math.round(subtotal * 15) / 100; // 15% بدقّة هللتين
  return {
    id,
    description,
    quantity,
    unit_price: unitPrice.toFixed(2),
    tax_rate: 15,
    line_subtotal: subtotal.toFixed(2),
    line_tax: tax.toFixed(2),
    line_total: (subtotal + tax).toFixed(2),
  };
}

function invoice(
  id: string,
  number: string,
  partner_id: string,
  invoice_date: string,
  status: string,
  payment_status: string,
  payment_type: string,
  lines: MockLine[]
): MockInvoice {
  const subtotal = lines.reduce((s, l) => s + Number(l.line_subtotal), 0);
  const tax = lines.reduce((s, l) => s + Number(l.line_tax), 0);
  const total = subtotal + tax;
  const paid = payment_status === 'paid' ? total : payment_status === 'partial' ? Math.round(total * 0.5 * 100) / 100 : 0;
  return {
    id,
    number,
    partner_id,
    payment_type,
    status,
    payment_status,
    invoice_date,
    subtotal: subtotal.toFixed(2),
    tax_amount: tax.toFixed(2),
    total: total.toFixed(2),
    paid_amount: paid.toFixed(2),
    remaining: (total - paid).toFixed(2),
    lines,
  };
}

export const mockInvoices: MockInvoice[] = [
  invoice('inv-118', 'INV-2026-0118', 'p1', '2026-06-24', 'posted', 'paid', 'cash', [
    line('l1', 'خدمات استشارية محاسبية', 1, 5000),
  ]),
  invoice('inv-117', 'INV-2026-0117', 'p2', '2026-06-22', 'posted', 'partial', 'credit', [
    line('l1', 'توريد مواد بناء', 200, 55),
  ]),
  invoice('inv-116', 'INV-2026-0116', 'p3', '2026-05-28', 'posted', 'unpaid', 'credit', [
    line('l1', 'حبيبات بلاستيك صناعية (طن)', 12, 600),
  ]),
  invoice('inv-115', 'INV-2026-0115', 'p4', '2026-06-23', 'draft', 'unpaid', 'credit', [
    line('l1', 'قطع غيار معدّات', 6, 500),
  ]),
  invoice('inv-114', 'INV-2026-0114', 'p5', '2026-06-18', 'posted', 'paid', 'cash', [
    line('l1', 'خدمات شحن ونقل بري', 5, 3700),
  ]),
  invoice('inv-113', 'INV-2026-0113', 'p6', '2026-06-12', 'posted', 'partial', 'credit', [
    line('l1', 'أجهزة قياس إلكترونية', 8, 1000),
  ]),
  invoice('inv-112', 'INV-2026-0112', 'p2', '2026-04-29', 'posted', 'unpaid', 'credit', [
    line('l1', 'أعمال صيانة دورية', 1, 5750),
  ]),
  invoice('inv-111', 'INV-2026-0111', 'p1', '2026-06-25', 'draft', 'unpaid', 'cash', [
    line('l1', 'اشتراك خدمة سحابية', 1, 1600),
  ]),
];

// ── مؤشرات لوحة التحكم (قيم العرض المطلوبة) ────────────────────────────────
export const mockDashboard = {
  totalSales: '482500.00',
  overdue: '63200.00',
  cash: '217840.00',
  invoiceCount: 147,
};

export const mockIncomeStatement = {
  total_revenue: '482500.00',
  total_expense: '264660.00',
  net_income: '217840.00',
};

export const mockAccounts = [
  { code: '1110', name: 'الصندوق', balance: '54320.00' },
  { code: '1120', name: 'البنك', balance: '163520.00' },
  { code: '1130', name: 'العملاء', balance: '63200.00' },
  { code: '4110', name: 'إيرادات المبيعات', balance: '482500.00' },
  { code: '5110', name: 'تكلفة البضاعة المباعة', balance: '264660.00' },
];

export const mockCompany = {
  name: 'نبراس الطموح للتجارة',
  vat_number: '310122393500003',
  cr_number: '2050123456',
  address: 'حي الفيصلية، الدمام',
  city: 'الدمام',
};

export const mockZatca = {
  qr: 'AR5uYnJhcyBhbC10dW1vaCBkZW1vIHFyIHBheWxvYWQ=',
  hash: 'demo-pih-hash-base64',
  uuid: '4d3c2b1a-0e9f-4a7c-8b6d-1f2e3a4b5c6d',
  icv: 118,
};

// ── موجّه الطلبات الوهمي ───────────────────────────────────────────────────
// يحاكي عقد الـ REST API: يعيد نفس الأشكال التي تتوقّعها الشاشات. المسارات غير
// المعرّفة تُعيد قائمة فارغة { data: [] } لتظهر الشاشة حالة فارغة نظيفة.
export function mockApi<T = unknown>(path: string, method = 'GET'): Promise<T> {
  const clean = path.split('?')[0];
  const m = method.toUpperCase();

  // الطفرات (إنشاء/تعديل/حذف/ترحيل) — نجاح صوري دون أي أثر فعلي.
  if (m !== 'GET') {
    if (clean === '/logout') return resolve(null);
    return resolve({ data: { id: 'demo-new' } });
  }

  if (clean === '/me') return resolve({ user: DEMO_USER, company: mockCompany });
  if (clean === '/reports/income-statement') return resolve(mockIncomeStatement);
  if (clean === '/accounts') return resolve({ data: mockAccounts });
  if (clean === '/partners') return resolve({ data: mockPartners });
  if (clean === '/invoices') return resolve({ data: mockInvoices });

  const partnerMatch = clean.match(/^\/partners\/([^/]+)$/);
  if (partnerMatch) {
    const found = mockPartners.find((p) => p.id === partnerMatch[1]) ?? mockPartners[0];
    return resolve({ data: found });
  }

  if (/^\/invoices\/[^/]+\/zatca$/.test(clean)) return resolve(mockZatca);

  const invoiceMatch = clean.match(/^\/invoices\/([^/]+)$/);
  if (invoiceMatch) {
    const found = mockInvoices.find((i) => i.id === invoiceMatch[1]) ?? mockInvoices[0];
    return resolve({ data: found });
  }

  // افتراضي: لا بيانات بعد (حالة فارغة).
  return resolve({ data: [] });

  function resolve<R>(value: R): Promise<T> {
    return Promise.resolve(value as unknown as T);
  }
}
