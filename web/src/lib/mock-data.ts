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
  currency: 'SAR',
  country: 'SA',
  address: 'حي الفيصلية، الدمام',
  city: 'الدمام',
};

export const mockZatca = {
  qr: 'AR5uYnJhcyBhbC10dW1vaCBkZW1vIHFyIHBheWxvYWQ=',
  hash: 'demo-pih-hash-base64',
  uuid: '4d3c2b1a-0e9f-4a7c-8b6d-1f2e3a4b5c6d',
  icv: 118,
};

// ── المنتجات (إدارة المنتجات + نقطة البيع) ──────────────────────────────────
export interface MockProduct {
  id: string;
  sku: string | null;
  name: string;
  name_en: string | null;
  type: string;
  unit: string;
  sale_price: string;
  purchase_price: string;
  tax_rate: number;
  track_inventory: boolean;
  quantity_on_hand: number;
  avg_cost: string;
  is_active: boolean;
}

function product(
  id: string, sku: string, name: string, type: string, unit: string,
  sale: number, purchase: number, track: boolean, qty: number, avg: number, active = true
): MockProduct {
  return {
    id, sku, name, name_en: null, type, unit,
    sale_price: sale.toFixed(2), purchase_price: purchase.toFixed(2), tax_rate: 15,
    track_inventory: track, quantity_on_hand: qty, avg_cost: avg.toFixed(2), is_active: active,
  };
}

export const mockProducts: MockProduct[] = [
  product('pr1', 'SKU-001', 'ساعة عمل استشارية', 'service', 'hour', 250, 0, false, 0, 0),
  product('pr2', 'SKU-002', 'جهاز قياس رقمي', 'good', 'piece', 1200, 800, true, 35, 760),
  product('pr3', 'SKU-003', 'كرتون ورق A4', 'good', 'carton', 95, 60, true, 240, 58),
  product('pr4', 'SKU-004', 'حبر طابعة ليزر', 'good', 'piece', 180, 110, true, 80, 105),
  product('pr5', 'SKU-005', 'كرسي مكتب دوّار', 'good', 'piece', 650, 420, true, 18, 410),
  product('pr6', 'SKU-006', 'طاولة اجتماعات', 'good', 'piece', 2300, 1500, true, 6, 1480),
  product('pr7', 'SKU-007', 'رخصة برنامج سنوية', 'service', 'license', 1500, 0, false, 0, 0),
  product('pr8', 'SKU-008', 'عقد صيانة شهري', 'service', 'service', 400, 0, false, 0, 0, false),
];

// مجمّع إجماليات مستند من سطوره (الإجماليات مشتقّة لا مُدخلة).
function docTotals(lines: MockLine[]) {
  const subtotal = lines.reduce((s, l) => s + Number(l.line_subtotal), 0);
  const tax = lines.reduce((s, l) => s + Number(l.line_tax), 0);
  return { subtotal: subtotal.toFixed(2), tax_amount: tax.toFixed(2), total: (subtotal + tax).toFixed(2) };
}

// ── المشتريات ──────────────────────────────────────────────────────────────
export interface MockPurchase {
  id: string;
  number: string;
  partner_id: string;
  payment_type: string;
  status: string;
  payment_status: string;
  purchase_date: string;
  supplier_invoice_no: string | null;
  subtotal: string;
  tax_amount: string;
  total: string;
  paid_amount: string;
  remaining: string;
  lines: MockLine[];
}

function purchase(
  id: string, number: string, partner_id: string, date: string,
  status: string, payment_status: string, supplierInv: string | null, lines: MockLine[]
): MockPurchase {
  const { subtotal, tax_amount, total } = docTotals(lines);
  const paid = payment_status === 'paid' ? Number(total) : payment_status === 'partial' ? Math.round(Number(total) * 50) / 100 : 0;
  return {
    id, number, partner_id, payment_type: payment_status === 'paid' ? 'cash' : 'credit',
    status, payment_status, purchase_date: date, supplier_invoice_no: supplierInv,
    subtotal, tax_amount, total, paid_amount: paid.toFixed(2), remaining: (Number(total) - paid).toFixed(2), lines,
  };
}

export const mockPurchases: MockPurchase[] = [
  purchase('pu-42', 'PUR-2026-0042', 'p3', '2026-06-19', 'posted', 'paid', 'S-9921', [line('l1', 'مواد خام بلاستيك (طن)', 10, 600)]),
  purchase('pu-41', 'PUR-2026-0041', 'p5', '2026-06-15', 'posted', 'partial', 'S-8842', [line('l1', 'خدمة شحن حاويات', 1, 4000)]),
  purchase('pu-40', 'PUR-2026-0040', 'p4', '2026-05-30', 'posted', 'unpaid', 'S-8810', [line('l1', 'قطع غيار معدّات', 20, 150)]),
  purchase('pu-39', 'PUR-2026-0039', 'p2', '2026-06-22', 'draft', 'unpaid', null, [line('l1', 'أدوات مكتبية', 1, 1200)]),
];

// ── المرتجعات ──────────────────────────────────────────────────────────────
export interface MockReturn {
  id: string;
  number: string;
  type: 'sales' | 'purchase';
  partner_id: string;
  payment_type: string;
  status: string;
  return_date: string;
  subtotal: string;
  tax_amount: string;
  total: string;
  lines: MockLine[];
}

function returnDoc(
  id: string, number: string, type: 'sales' | 'purchase', partner_id: string,
  date: string, status: string, lines: MockLine[]
): MockReturn {
  const { subtotal, tax_amount, total } = docTotals(lines);
  return { id, number, type, partner_id, payment_type: 'cash', status, return_date: date, subtotal, tax_amount, total, lines };
}

export const mockReturns: MockReturn[] = [
  returnDoc('re-7', 'RET-2026-0007', 'sales', 'p1', '2026-06-21', 'posted', [line('l1', 'مرتجع بضاعة تالفة', 2, 500)]),
  returnDoc('re-6', 'RET-2026-0006', 'purchase', 'p3', '2026-06-17', 'posted', [line('l1', 'مواد معيبة مرتجعة للمورد', 5, 600)]),
  returnDoc('re-5', 'RET-2026-0005', 'sales', 'p5', '2026-06-10', 'posted', [line('l1', 'خدمة ملغاة', 1, 3700)]),
  returnDoc('re-4', 'RET-2026-0004', 'sales', 'p2', '2026-05-25', 'draft', [line('l1', 'مرتجع جزئي', 1, 800)]),
];

// ── عروض الأسعار ───────────────────────────────────────────────────────────
export interface MockQuote {
  id: string;
  number: string;
  partner_id: string;
  status: string;
  quote_date: string;
  valid_until: string | null;
  subtotal: string;
  tax_amount: string;
  total: string;
  notes: string | null;
  converted_invoice_id: string | null;
  lines: MockLine[];
}

function quote(
  id: string, number: string, partner_id: string, date: string, validUntil: string,
  status: string, lines: MockLine[]
): MockQuote {
  const { subtotal, tax_amount, total } = docTotals(lines);
  return {
    id, number, partner_id, status, quote_date: date, valid_until: validUntil,
    subtotal, tax_amount, total, notes: null, converted_invoice_id: null, lines,
  };
}

export const mockQuotes: MockQuote[] = [
  quote('qu-12', 'QUO-2026-0012', 'p1', '2026-06-23', '2026-07-07', 'sent', [line('l1', 'توريد وتركيب أجهزة', 4, 1200)]),
  quote('qu-11', 'QUO-2026-0011', 'p4', '2026-06-20', '2026-07-04', 'accepted', [line('l1', 'عقد صيانة سنوي', 1, 18000)]),
  quote('qu-10', 'QUO-2026-0010', 'p2', '2026-06-12', '2026-06-26', 'draft', [line('l1', 'استشارة وتدريب', 10, 250)]),
];

// ── المدفوعات ──────────────────────────────────────────────────────────────
export const mockPayments = [
  { id: 'pm-51', number: 'PMT-2026-0051', partner_id: 'p1', direction: 'received', method: 'bank', payment_date: '2026-06-24', amount: '5750.00' },
  { id: 'pm-50', number: 'PMT-2026-0050', partner_id: 'p2', direction: 'received', method: 'cash', payment_date: '2026-06-22', amount: '6325.00' },
  { id: 'pm-49', number: 'PMT-2026-0049', partner_id: 'p3', direction: 'paid', method: 'bank', payment_date: '2026-06-20', amount: '6900.00' },
  { id: 'pm-48', number: 'PMT-2026-0048', partner_id: 'p5', direction: 'received', method: 'bank', payment_date: '2026-06-18', amount: '21275.00' },
  { id: 'pm-47', number: 'PMT-2026-0047', partner_id: 'p4', direction: 'paid', method: 'cash', payment_date: '2026-06-12', amount: '3450.00' },
  { id: 'pm-46', number: 'PMT-2026-0046', partner_id: 'p6', direction: 'received', method: 'bank', payment_date: '2026-06-08', amount: '4600.00' },
];

// ── الموارد البشرية ────────────────────────────────────────────────────────
export interface MockEmployee {
  id: string;
  employee_no: string;
  name: string;
  national_id: string;
  job_title: string;
  basic_salary: string;
  allowances: string;
  gosi: string;
  other_deductions: string;
  is_active: boolean;
  gross: string;
  net: string;
}

function employee(
  id: string, no: string, name: string, job: string,
  basic: number, allow: number, gosi: number, other: number, active = true
): MockEmployee {
  const gross = basic + allow;
  const net = gross - gosi - other;
  return {
    id, employee_no: no, name, national_id: `10${no.slice(-6)}0`, job_title: job,
    basic_salary: basic.toFixed(2), allowances: allow.toFixed(2), gosi: gosi.toFixed(2),
    other_deductions: other.toFixed(2), is_active: active, gross: gross.toFixed(2), net: net.toFixed(2),
  };
}

export const mockEmployees: MockEmployee[] = [
  employee('em-1', 'EMP-001', 'أحمد العتيبي', 'مدير مالي', 18000, 4000, 1800, 0),
  employee('em-2', 'EMP-002', 'سارة القحطاني', 'محاسبة', 9000, 1500, 900, 0),
  employee('em-3', 'EMP-003', 'خالد الدوسري', 'أمين مستودع', 6000, 800, 600, 200),
  employee('em-4', 'EMP-004', 'منى الشمري', 'موظفة مبيعات', 7000, 2000, 700, 0),
  employee('em-5', 'EMP-005', 'فهد المطيري', 'فني صيانة', 5500, 700, 550, 150),
  employee('em-6', 'EMP-006', 'نورة الغامدي', 'موظفة استقبال', 4500, 500, 450, 0, false),
];

export interface MockRun {
  id: string;
  number: string;
  period: string;
  status: string;
  pay_method: string | null;
  total_gross: string;
  total_gosi: string;
  total_other_deductions: string;
  total_deductions: string;
  total_net: string;
  items: {
    id: string;
    employee: { id: string; name: string };
    basic_salary: string;
    allowances: string;
    gosi: string;
    other_deductions: string;
    gross: string;
    net: string;
  }[];
}

function payrollRun(id: string, number: string, period: string, status: string, payMethod: string | null): MockRun {
  const items = mockEmployees.map((e) => ({
    id: `${id}-${e.id}`,
    employee: { id: e.id, name: e.name },
    basic_salary: e.basic_salary,
    allowances: e.allowances,
    gosi: e.gosi,
    other_deductions: e.other_deductions,
    gross: e.gross,
    net: e.net,
  }));
  const sum = (k: 'gross' | 'gosi' | 'other_deductions' | 'net') =>
    items.reduce((s, it) => s + Number(it[k]), 0);
  const gross = sum('gross');
  const gosi = sum('gosi');
  const other = sum('other_deductions');
  return {
    id, number, period, status, pay_method: payMethod,
    total_gross: gross.toFixed(2), total_gosi: gosi.toFixed(2), total_other_deductions: other.toFixed(2),
    total_deductions: (gosi + other).toFixed(2), total_net: sum('net').toFixed(2), items,
  };
}

export const mockPayrollRuns: MockRun[] = [
  payrollRun('run-06', 'PR-2026-06', '2026-06', 'posted', null),
  payrollRun('run-05', 'PR-2026-05', '2026-05', 'paid', 'bank'),
  payrollRun('run-04', 'PR-2026-04', '2026-04', 'paid', 'bank'),
];

// ── المستخدمون والاشتراك ───────────────────────────────────────────────────
export const mockUsers = [
  { id: DEMO_USER.id, name: DEMO_USER.name, email: DEMO_USER.email, role: 'owner', is_active: true },
  { id: 'us-2', name: 'سارة القحطاني', email: 'sara@nibras.sa', role: 'accountant', is_active: true },
  { id: 'us-3', name: 'خالد الدوسري', email: 'khalid@nibras.sa', role: 'staff', is_active: true },
];

export const mockSubscription = {
  plan: 'pro',
  active: true,
  trial_ends_at: null as string | null,
  subscription_ends_at: '2026-12-31',
  limits: { invoices_per_month: 1000, users: 10 },
  usage: { invoices_this_month: 147, users: 3 },
};

// ── التقارير ───────────────────────────────────────────────────────────────
export const mockTrialBalance = {
  rows: [
    { code: '1110', name: 'الصندوق', debit: '54320.00', credit: '0.00' },
    { code: '1120', name: 'البنك', debit: '163520.00', credit: '0.00' },
    { code: '1130', name: 'العملاء', debit: '63200.00', credit: '0.00' },
    { code: '1140', name: 'المخزون', debit: '85000.00', credit: '0.00' },
    { code: '1150', name: 'ضريبة المدخلات', debit: '12400.00', credit: '0.00' },
    { code: '2110', name: 'الموردون', debit: '0.00', credit: '41250.00' },
    { code: '2120', name: 'ضريبة المخرجات', debit: '0.00', credit: '33960.00' },
    { code: '2130', name: 'رواتب مستحقة', debit: '0.00', credit: '5350.00' },
    { code: '3110', name: 'رأس المال', debit: '0.00', credit: '138000.00' },
    { code: '4110', name: 'إيرادات المبيعات', debit: '0.00', credit: '482500.00' },
    { code: '5110', name: 'تكلفة البضاعة المباعة', debit: '264660.00', credit: '0.00' },
    { code: '5120', name: 'الرواتب والأجور', debit: '54150.00', credit: '0.00' },
    { code: '5140', name: 'الوقود', debit: '3810.00', credit: '0.00' },
  ],
  total_debit: '701060.00',
  total_credit: '701060.00',
  balanced: true,
};

function agingFor(type: string) {
  if (type === 'payable') {
    return {
      type, as_of: '2026-06-26',
      rows: [
        { partner_id: 'p3', name: 'مصنع الشرق للبلاستيك', b0_30: '3450.00', b31_60: '0.00', b61_90: '0.00', b90_plus: '0.00', total: '3450.00' },
        { partner_id: 'p5', name: 'شركة البحر الأحمر اللوجستية', b0_30: '0.00', b31_60: '2300.00', b61_90: '0.00', b90_plus: '0.00', total: '2300.00' },
      ],
      totals: { b0_30: '3450.00', b31_60: '2300.00', b61_90: '0.00', b90_plus: '0.00', total: '5750.00' },
    };
  }
  return {
    type: 'receivable', as_of: '2026-06-26',
    rows: [
      { partner_id: 'p2', name: 'شركة الواحة للمقاولات', b0_30: '6325.00', b31_60: '0.00', b61_90: '0.00', b90_plus: '6612.50', total: '12937.50' },
      { partner_id: 'p3', name: 'مصنع الشرق للبلاستيك', b0_30: '0.00', b31_60: '8280.00', b61_90: '0.00', b90_plus: '0.00', total: '8280.00' },
      { partner_id: 'p6', name: 'مؤسسة الفيصل للأجهزة', b0_30: '5200.00', b31_60: '0.00', b61_90: '0.00', b90_plus: '0.00', total: '5200.00' },
    ],
    totals: { b0_30: '11525.00', b31_60: '8280.00', b61_90: '0.00', b90_plus: '6612.50', total: '26417.50' },
  };
}

function partnerStatement(id: string) {
  const p = mockPartners.find((x) => x.id === id) ?? mockPartners[0];
  return {
    partner: { id: p.id, name: p.name, type: p.type },
    opening_balance: '0.00',
    rows: [
      { date: '2026-06-01', number: 'INV-2026-0117', description: 'فاتورة مبيعات', debit: '12650.00', credit: '0.00', balance: '12650.00' },
      { date: '2026-06-22', number: 'PMT-2026-0050', description: 'دفعة مستلمة', debit: '0.00', credit: '6325.00', balance: '6325.00' },
    ],
    closing_balance: '6325.00',
  };
}

// ── موجّه الطلبات الوهمي ───────────────────────────────────────────────────
// يحاكي عقد الـ REST API: يعيد نفس الأشكال التي تتوقّعها الشاشات. المسارات غير
// المعرّفة تُعيد قائمة فارغة { data: [] } لتظهر الشاشة حالة فارغة نظيفة.
export function mockApi<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const clean = path.split('?')[0];
  const m = method.toUpperCase();

  // الطفرات (إنشاء/تعديل/حذف/ترحيل) — نجاح صوري دون أي أثر فعلي.
  if (m !== 'GET') {
    if (clean === '/logout') return resolve(null);
    // إنشاء فاتورة (نقطة البيع/الفواتير): نُعيد رقماً وإجمالاً محسوباً من السطور.
    if (clean === '/invoices') return resolve({ data: { id: 'demo-inv', number: 'INV-2026-0119', total: invoiceTotalFromBody(body) } });
    // إجراءات مسيّر الرواتب (ترحيل/صرف): نُعيد المسيّر المطابق ليُحدَّث العرض.
    const runAction = clean.match(/^\/payroll-runs\/([^/]+)\/(post|pay)$/);
    if (runAction) {
      const run = mockPayrollRuns.find((r) => r.id === runAction[1]) ?? mockPayrollRuns[0];
      return resolve({ data: run });
    }
    return resolve({ data: { id: 'demo-new' } });
  }

  if (clean === '/me') return resolve({ user: DEMO_USER, company: mockCompany });
  if (clean === '/subscription') return resolve(mockSubscription);
  if (clean === '/users') return resolve({ data: mockUsers });
  if (clean === '/products') return resolve({ data: mockProducts });
  if (clean === '/accounts') return resolve({ data: mockAccounts });
  if (clean === '/partners') return resolve({ data: mockPartners });
  if (clean === '/invoices') return resolve({ data: mockInvoices });
  if (clean === '/quotes') return resolve({ data: mockQuotes });
  if (clean === '/purchases') return resolve({ data: mockPurchases });
  if (clean === '/returns') return resolve({ data: mockReturns });
  if (clean === '/payments') return resolve({ data: mockPayments });
  if (clean === '/employees') return resolve({ data: mockEmployees });
  if (clean === '/payroll-runs') return resolve({ data: mockPayrollRuns });

  if (clean === '/inventory') return resolve(mockInventory());
  const movementsMatch = clean.match(/^\/inventory\/([^/]+)\/movements$/);
  if (movementsMatch) return resolve(mockMovements(movementsMatch[1]));

  if (clean === '/reports/income-statement') return resolve(mockIncomeStatement);
  if (clean === '/reports/trial-balance') return resolve(mockTrialBalance);
  const agingMatch = clean.match(/^\/reports\/aging\/([^/]+)$/);
  if (agingMatch) return resolve(agingFor(agingMatch[1]));
  const stmtMatch = clean.match(/^\/reports\/partner-statement\/([^/]+)$/);
  if (stmtMatch) return resolve(partnerStatement(stmtMatch[1]));

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

  const quoteMatch = clean.match(/^\/quotes\/([^/]+)$/);
  if (quoteMatch) {
    const found = mockQuotes.find((q) => q.id === quoteMatch[1]) ?? mockQuotes[0];
    return resolve({ data: found });
  }

  const purchaseMatch = clean.match(/^\/purchases\/([^/]+)$/);
  if (purchaseMatch) {
    const found = mockPurchases.find((p) => p.id === purchaseMatch[1]) ?? mockPurchases[0];
    return resolve({ data: found });
  }

  const returnMatch = clean.match(/^\/returns\/([^/]+)$/);
  if (returnMatch) {
    const found = mockReturns.find((r) => r.id === returnMatch[1]) ?? mockReturns[0];
    return resolve({ data: found });
  }

  const runMatch = clean.match(/^\/payroll-runs\/([^/]+)$/);
  if (runMatch) {
    const found = mockPayrollRuns.find((r) => r.id === runMatch[1]) ?? mockPayrollRuns[0];
    return resolve({ data: found });
  }

  // افتراضي: لا بيانات بعد (حالة فارغة).
  return resolve({ data: [] });

  function resolve<R>(value: R): Promise<T> {
    return Promise.resolve(value as unknown as T);
  }
}

// تقرير المخزون من المنتجات المتتبَّعة (القيمة = الكمية × متوسط التكلفة).
function mockInventory() {
  const items = mockProducts
    .filter((p) => p.track_inventory)
    .map((p) => ({
      id: p.id,
      sku: p.sku,
      name: p.name,
      unit: p.unit,
      quantity_on_hand: p.quantity_on_hand,
      avg_cost: p.avg_cost,
      stock_value: (p.quantity_on_hand * Number(p.avg_cost)).toFixed(2),
    }));
  const total = items.reduce((s, i) => s + Number(i.stock_value), 0).toFixed(2);
  return { data: items, total_value: total };
}

function mockMovements(productId: string) {
  const p = mockProducts.find((x) => x.id === productId);
  if (!p || !p.track_inventory) return { data: [] };
  const cost = Number(p.avg_cost);
  return {
    data: [
      { id: 'mv1', type: 'in', quantity: p.quantity_on_hand + 5, unit_cost: p.avg_cost, total_cost: ((p.quantity_on_hand + 5) * cost).toFixed(2), balance_quantity: p.quantity_on_hand + 5, movement_date: '2026-06-01', notes: 'رصيد افتتاحي' },
      { id: 'mv2', type: 'out', quantity: 5, unit_cost: p.avg_cost, total_cost: (5 * cost).toFixed(2), balance_quantity: p.quantity_on_hand, movement_date: '2026-06-15', notes: 'صرف/بيع' },
    ],
  };
}

// إجمالي فاتورة من جسم الطلب (السطور بالهللات) → ريال نصّي.
function invoiceTotalFromBody(body: unknown): string {
  const items = (body as { items?: { quantity?: number; unit_price?: number; tax_rate?: number }[] } | undefined)?.items ?? [];
  const minor = items.reduce((s, it) => {
    const sub = (it.quantity ?? 0) * (it.unit_price ?? 0);
    return s + sub + Math.round((sub * (it.tax_rate ?? 0)) / 100);
  }, 0);
  return (minor / 100).toFixed(2);
}
