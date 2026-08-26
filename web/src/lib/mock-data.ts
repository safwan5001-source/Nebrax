// بيانات وهمية واقعية لوضع المعاينة (Demo). كل المبالغ بالريال كنصوص (مثل ما يعيده الـ API)
// لأن التحويل من الهللات يتم في طبقة موارد الـ backend. لا يُستخدم أي float في حساب مالي حقيقي هنا.

import { DEMO_USER } from './demo';
import { handleDocumentReviewDemo } from './document-review-demo';
import {
  deleteDemoProductMedia,
  demoId,
  listDemoProductMedia,
  listDemoProducts,
  saveDemoProduct,
  saveDemoProductMedia,
} from './demo-product-store';

// ── العملاء ───────────────────────────────────────────────────────────────
export interface MockPartner {
  id: string;
  name: string;
  type: string;
  email: string | null;
  phone: string | null;
  city: string | null;
  vat_number: string | null;
  entity_type?: string;
  mobile?: string | null;
  code?: string | null;
  address?: string | null;
  building_no?: string | null;
  street?: string | null;
  district?: string | null;
  postal_code?: string | null;
  country?: string | null;
  classification?: string | null;
  credit_limit?: string | null;   // بالريال كنص (مثل موارد الـ API)
  credit_period?: number | null;
}

export const mockPartners: MockPartner[] = [
  { id: 'p1', name: 'مؤسسة الخليج للتجارة', type: 'customer', entity_type: 'commercial', email: 'info@gulf-trade.sa', phone: '0138012345', mobile: '0551234567', city: 'الدمام', vat_number: '311111111100003', code: 'C-001', classification: 'VIP', credit_limit: '150000.00', credit_period: 30, building_no: '3421', street: 'طريق الملك فهد', district: 'العليا', postal_code: '32233', country: 'SA' },
  { id: 'p2', name: 'شركة الواحة للمقاولات', type: 'customer', email: 'accounts@alwaha.sa', phone: '0138023456', city: 'الخبر', vat_number: '312222222200003' },
  { id: 'p3', name: 'مصنع الشرق للبلاستيك', type: 'customer', email: 'sales@east-plast.sa', phone: '0138034567', city: 'الجبيل', vat_number: '313333333300003' },
  { id: 'p4', name: 'مؤسسة نجد للتوريدات', type: 'customer', email: 'po@najd-supply.sa', phone: '0138045678', city: 'الظهران', vat_number: '314444444400003' },
  { id: 'p5', name: 'شركة البحر الأحمر اللوجستية', type: 'customer', email: 'ops@redsea-log.sa', phone: '0138056789', city: 'الدمام', vat_number: '315555555500003' },
  { id: 'p6', name: 'مؤسسة الفيصل للأجهزة', type: 'customer', email: 'buy@faisal-dev.sa', phone: '0138067890', city: 'الأحساء', vat_number: '316666666600003' },
  // موردون — لتظهر شاشة «إدارة الموردين» ببيانات في المعاينة.
  { id: 'p7', name: 'شركة الجزيرة للتوريدات الصناعية', type: 'supplier', entity_type: 'commercial', email: 'sales@jazira-ind.sa', phone: '0138078901', city: 'الجبيل', vat_number: '317777777700003', code: 'S-001' },
  { id: 'p8', name: 'مصنع الرياض للتغليف', type: 'supplier', entity_type: 'commercial', email: 'orders@riyadh-pack.sa', phone: '0112233445', city: 'الرياض', vat_number: '318888888800003', code: 'S-002' },
  // طرف مزدوج (عميل ومورّد معاً) — يظهر في الشاشتين.
  { id: 'p9', name: 'مجموعة الخليج التجارية الشاملة', type: 'both', entity_type: 'commercial', email: 'hub@gulf-group.sa', phone: '0138090123', city: 'الدمام', vat_number: '319999999900003', code: 'CS-001' },
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

interface MockDeliveryNote {
  id: string;
  branch_id: string;
  number: string;
  status: 'draft' | 'confirmed' | 'cancelled';
  version: number;
  external_reference: string | null;
  delivery_date: string;
  notes: string | null;
  customer_id: string;
  warehouse_id: string;
  customer: { id: string; name: string; type: string };
  warehouse: { id: string; name: string; code: string | null };
  lines: Array<{ id: string; line_number: number; product_id: string; product_name: string; product_sku: string | null; product_barcode: string | null; unit_name: string; unit_factor: number; quantity: number; quantity_numerator: number | null; quantity_denominator: number | null; description: string | null }>;
  events: Array<{ id: string; event: string; from_status: string | null; to_status: string | null; actor_id: string | null; actor_name: string | null; reason: string | null; metadata: Record<string, unknown> | null; occurred_at: string }>;
  confirmed_at: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  created_by: string | null;
  confirmed_by: string | null;
  cancelled_by: string | null;
}

/** بيانات fixture محلية فقط؛ لا تمثل سندات حقيقية ولا تتصل بأي API. */
export const mockDeliveryNotes: MockDeliveryNote[] = [
  {
    id: 'dn-104', branch_id: 'br-1', number: 'DN-2026-00104', status: 'draft', version: 1,
    external_reference: 'DN-PAPER-104', delivery_date: '2026-08-24', notes: 'تسليم مجدول للموقع الرئيسي.',
    customer_id: 'p1', warehouse_id: 'wh-1', customer: { id: 'p1', name: 'مؤسسة الخليج للتجارة', type: 'customer' }, warehouse: { id: 'wh-1', name: 'المخزن الرئيسي', code: '00001' },
    lines: [{ id: 'dn-104-l1', line_number: 1, product_id: 'pr2', product_name: 'جهاز قياس رقمي', product_sku: 'SKU-002', product_barcode: null, unit_name: 'piece', unit_factor: 1, quantity: 3, quantity_numerator: null, quantity_denominator: null, description: 'تسليم أولي' }],
    events: [{ id: 'dn-104-e1', event: 'created', from_status: null, to_status: 'draft', actor_id: 'demo-user', actor_name: 'مستخدم المعاينة', reason: null, metadata: { line_count: 1 }, occurred_at: '2026-08-24T08:30:00Z' }],
    confirmed_at: null, cancelled_at: null, cancellation_reason: null, created_by: 'demo-user', confirmed_by: null, cancelled_by: null,
  },
  {
    id: 'dn-103', branch_id: 'br-1', number: 'DN-2026-00103', status: 'confirmed', version: 2,
    external_reference: null, delivery_date: '2026-08-22', notes: null,
    customer_id: 'p2', warehouse_id: 'wh-1', customer: { id: 'p2', name: 'شركة الواحة للمقاولات', type: 'customer' }, warehouse: { id: 'wh-1', name: 'المخزن الرئيسي', code: '00001' },
    lines: [{ id: 'dn-103-l1', line_number: 1, product_id: 'pr4', product_name: 'مواد تثبيت صناعية', product_sku: 'SKU-004', product_barcode: null, unit_name: 'box', unit_factor: 12, quantity: 4, quantity_numerator: null, quantity_denominator: null, description: null }],
    events: [{ id: 'dn-103-e1', event: 'created', from_status: null, to_status: 'draft', actor_id: 'demo-user', actor_name: 'مستخدم المعاينة', reason: null, metadata: { line_count: 1 }, occurred_at: '2026-08-21T09:00:00Z' }, { id: 'dn-103-e2', event: 'confirmed', from_status: 'draft', to_status: 'confirmed', actor_id: 'demo-user', actor_name: 'مستخدم المعاينة', reason: null, metadata: null, occurred_at: '2026-08-22T10:10:00Z' }],
    confirmed_at: '2026-08-22T10:10:00Z', cancelled_at: null, cancellation_reason: null, created_by: 'demo-user', confirmed_by: 'demo-user', cancelled_by: null,
  },
];

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
  revenues: [
    { code: '4110', name: 'إيرادات المبيعات', amount: '470000.00' },
    { code: '4130', name: 'إيرادات الشحن', amount: '12500.00' },
  ],
  expenses: [
    { code: '5110', name: 'تكلفة البضاعة المباعة', amount: '198000.00' },
    { code: '5120', name: 'الرواتب والأجور', amount: '52000.00' },
    { code: '5140', name: 'الوقود', amount: '8660.00' },
    { code: '5160', name: 'مصروف الإهلاك', amount: '6000.00' },
  ],
  total_revenue: '482500.00',
  total_expense: '264660.00',
  net_income: '217840.00',
};

/**
 * ميزانية عمومية متوازنة: أصول = خصوم + حقوق ملكية + صافي الدخل.
 * الأرقام مشتقّة من قائمة الدخل الوهمية فتبقى الشاشتان متّسقتين.
 */
export const mockBalanceSheet = {
  assets: [
    { code: '1110', name: 'الصندوق', amount: '86000.00' },
    { code: '1120', name: 'البنك', amount: '214000.00' },
    { code: '1130', name: 'العملاء', amount: '132840.00' },
    { code: '1140', name: 'المخزون', amount: '95000.00' },
  ],
  liabilities: [
    { code: '2110', name: 'الموردون', amount: '210000.00' },
    { code: '2120', name: 'ضريبة المخرجات', amount: '40000.00' },
  ],
  equity: [{ code: '3110', name: 'رأس المال', amount: '60000.00' }],
  total_assets: '527840.00',
  total_liabilities: '250000.00',
  total_equity: '60000.00',
  net_income: '217840.00',
  total_equity_and_income: '277840.00',
  balanced: true,
};

/**
 * قائمة الدخل مصفّاة بفرع: الرواتب مصروف مركزي **غير موزَّع**، فتخرج من
 * إجمالي الفرع وتظهر في بندها الخاص — كما يفعل الخادم تماماً.
 */
function incomeStatementFor(path: string) {
  const params = new URLSearchParams(path.split('?')[1] ?? '');
  const filtered = params.has('branch_id') || params.has('branch_id[]');
  if (!filtered) return mockIncomeStatement;

  const expenses = mockIncomeStatement.expenses.filter((e) => e.code !== '5120');

  return {
    ...mockIncomeStatement,
    expenses,
    total_expense: '212660.00',
    net_income: '269840.00',
    unallocated: { total_revenue: '0.00', total_expense: '52000.00', net_income: '-52000.00' },
  };
}

// دليل الحسابات السعودي القياسي (يطابق ChartOfAccountsSeeder) — شجرة 3 مستويات.
// المجموعات (is_group) لا تقبل قيوداً ولا رصيد مباشر؛ الأوراق تحمل الأرصدة.
export interface MockAccount {
  id: string;
  code: string;
  name: string;
  name_en: string;
  type: 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
  normal_balance: 'debit' | 'credit';
  is_group: boolean;
  balance: string;
}

const acc = (
  code: string,
  name: string,
  name_en: string,
  type: MockAccount['type'],
  is_group: boolean,
  balance = '0.00',
): MockAccount => ({
  id: `a${code}`,
  code,
  name,
  name_en,
  type,
  normal_balance: type === 'asset' || type === 'expense' ? 'debit' : 'credit',
  is_group,
  balance,
});

export const mockAccounts: MockAccount[] = [
  acc('1', 'الأصول', 'Assets', 'asset', true),
  acc('11', 'الأصول المتداولة', 'Current Assets', 'asset', true),
  acc('1110', 'الصندوق', 'Cash', 'asset', false, '54320.00'),
  acc('1120', 'البنك', 'Bank', 'asset', false, '163520.00'),
  acc('1130', 'العملاء (المدينون)', 'Accounts Receivable', 'asset', false, '63200.00'),
  acc('1140', 'المخزون', 'Inventory', 'asset', false, '88400.00'),
  acc('1150', 'ضريبة القيمة المضافة - مدخلات', 'VAT Input', 'asset', false, '12150.00'),
  acc('12', 'الأصول الثابتة', 'Fixed Assets', 'asset', true),
  acc('1210', 'المعدات والآليات', 'Equipment', 'asset', false, '45000.00'),
  acc('1220', 'وسائل النقل', 'Vehicles', 'asset', false, '120000.00'),
  acc('1230', 'مجمع الإهلاك', 'Accumulated Depreciation', 'asset', false, '-18500.00'),
  acc('2', 'الخصوم', 'Liabilities', 'liability', true),
  acc('21', 'الخصوم المتداولة', 'Current Liabilities', 'liability', true),
  acc('2110', 'الموردون (الدائنون)', 'Accounts Payable', 'liability', false, '47800.00'),
  acc('2120', 'ضريبة القيمة المضافة - مخرجات', 'VAT Output', 'liability', false, '21300.00'),
  acc('2130', 'رواتب مستحقة', 'Accrued Salaries', 'liability', false, '18000.00'),
  acc('2140', 'التأمينات الاجتماعية مستحقة', 'GOSI Payable', 'liability', false, '6400.00'),
  acc('2150', 'استقطاعات موظفين مستحقة', 'Employee Deductions Payable', 'liability', false, '2100.00'),
  acc('3', 'حقوق الملكية', 'Equity', 'equity', true),
  acc('3110', 'رأس المال', 'Capital', 'equity', false, '300000.00'),
  acc('3120', 'الأرباح المرحّلة', 'Retained Earnings', 'equity', false, '85000.00'),
  acc('3130', 'الأرصدة الافتتاحية', 'Opening Balances', 'equity', false, '0.00'),
  acc('4', 'الإيرادات', 'Revenue', 'revenue', true),
  acc('4110', 'إيرادات المبيعات', 'Sales Revenue', 'revenue', false, '482500.00'),
  acc('4120', 'إيرادات الخدمات', 'Service Revenue', 'revenue', false, '36000.00'),
  acc('5', 'المصروفات', 'Expenses', 'expense', true),
  acc('5110', 'تكلفة البضاعة المباعة', 'COGS', 'expense', false, '264660.00'),
  acc('5120', 'الرواتب والأجور', 'Salaries', 'expense', false, '96000.00'),
  acc('5130', 'الإيجار', 'Rent', 'expense', false, '48000.00'),
  acc('5140', 'الوقود والمحروقات', 'Fuel', 'expense', false, '14300.00'),
  acc('5150', 'مصروفات عامة', 'General Expenses', 'expense', false, '9750.00'),
  acc('5160', 'الإهلاك', 'Depreciation', 'expense', false, '18500.00'),
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
  barcode: string | null;
  name: string;
  name_en: string | null;
  type: string;
  unit: string;
  units: Array<{ name: string; factor: number }>;
  description: string | null;
  category: string | null;
  brand: string | null;
  reorder_level: number | null;
  supplier_id: string | null;
  sales_account_id: string | null;
  cogs_account_id: string | null;
  min_sale_price: string | null;
  discount: number | null;
  discount_type: string | null;
  profit_margin: number | null;
  tags: string | null;
  internal_notes: string | null;
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
    id, sku, barcode: sku ? '2' + sku.replace(/\D/g, '').padStart(12, '0') : null, name, name_en: null, type, unit,
    units: unit ? [{ name: unit, factor: 1 }] : [],
    description: null, category: null, brand: null, reorder_level: track ? 10 : null,
    supplier_id: null, sales_account_id: null, cogs_account_id: null, min_sale_price: null, discount: null, discount_type: null, profit_margin: null, tags: null, internal_notes: null,
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

function allMockProducts(): MockProduct[] {
  const stored = (listDemoProducts() as unknown as MockProduct[]).map((item) => ({
    ...item,
    units: Array.isArray(item.units) ? item.units : item.unit ? [{ name: item.unit, factor: 1 }] : [],
  }));
  const storedIds = new Set(stored.map((item) => item.id));
  return [...stored, ...mockProducts.filter((item) => !storedIds.has(item.id))];
}

function productFromDemoInput(body: unknown): MockProduct {
  const input = (body ?? {}) as Record<string, unknown>;
  const minorToRiyal = (value: unknown) => (Number(value ?? 0) / 100).toFixed(2);
  const purchasePrice = minorToRiyal(input.purchase_price);

  return {
    id: demoId('product'),
    sku: typeof input.sku === 'string' && input.sku ? input.sku : '',
    barcode: typeof input.barcode === 'string' && input.barcode ? input.barcode : null,
    name: String(input.name ?? 'منتج تجريبي'),
    name_en: typeof input.name_en === 'string' && input.name_en ? input.name_en : null,
    type: String(input.type ?? 'good'),
    unit: String(input.unit ?? ''),
    units: input.unit ? [{ name: String(input.unit), factor: 1 }] : [],
    description: typeof input.description === 'string' && input.description ? input.description : null,
    category: typeof input.category === 'string' && input.category ? input.category : null,
    brand: typeof input.brand === 'string' && input.brand ? input.brand : null,
    reorder_level: input.reorder_level === null || input.reorder_level === undefined ? null : Number(input.reorder_level),
    supplier_id: typeof input.supplier_id === 'string' && input.supplier_id ? input.supplier_id : null,
    sales_account_id: typeof input.sales_account_id === 'string' && input.sales_account_id ? input.sales_account_id : null,
    cogs_account_id: typeof input.cogs_account_id === 'string' && input.cogs_account_id ? input.cogs_account_id : null,
    min_sale_price: input.min_sale_price === null || input.min_sale_price === undefined ? null : minorToRiyal(input.min_sale_price),
    discount: input.discount === null || input.discount === undefined ? null : Number(input.discount),
    discount_type: typeof input.discount_type === 'string' && input.discount_type ? input.discount_type : null,
    profit_margin: input.profit_margin === null || input.profit_margin === undefined ? null : Number(input.profit_margin),
    tags: typeof input.tags === 'string' && input.tags ? input.tags : null,
    internal_notes: typeof input.internal_notes === 'string' && input.internal_notes ? input.internal_notes : null,
    sale_price: minorToRiyal(input.sale_price),
    purchase_price: purchasePrice,
    tax_rate: Number(input.tax_rate ?? 0),
    track_inventory: Boolean(input.track_inventory),
    quantity_on_hand: Number(input.initial_quantity ?? 0),
    avg_cost: purchasePrice,
    is_active: input.is_active !== false,
  };
}

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
  // بيانات مورد حقيقية في وضع المعاينة: فاتورة آجلة + إشعار مدين + سند صرف.
  purchase('pu-43', 'PUR-2026-0043', 'p7', '2026-06-15', 'posted', 'partial', 'JZ-4412', [line('l1', 'مضخات صناعية', 10, 1200)]),
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
  returnDoc('re-6', 'RET-2026-0006', 'purchase', 'p7', '2026-06-17', 'posted', [line('l1', 'مواد معيبة مرتجعة للمورد', 5, 600)]),
  returnDoc('re-5', 'RET-2026-0005', 'sales', 'p5', '2026-06-10', 'posted', [line('l1', 'خدمة ملغاة', 1, 3700)]),
  returnDoc('re-4', 'RET-2026-0004', 'sales', 'p2', '2026-05-25', 'draft', [line('l1', 'مرتجع جزئي', 1, 800)]),
  returnDoc('re-3', 'RET-2026-0003', 'purchase', 'p8', '2026-05-18', 'draft', [line('l1', 'شحنة ناقصة مرتجعة', 3, 450)]),
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

// ── الإشعارات الدائنة ──────────────────────────────────────────────────────
export interface MockCreditNote {
  id: string;
  number: string;
  type: string;
  partner_id: string;
  refund_type: string;
  status: string;
  note_date: string;
  subtotal: string;
  tax_amount: string;
  total: string;
  reason: string | null;
  lines: MockLine[];
}

function creditNote(
  id: string, number: string, partner_id: string, date: string,
  refundType: string, status: string, reason: string, lines: MockLine[], type = 'sales'
): MockCreditNote {
  const { subtotal, tax_amount, total } = docTotals(lines);
  return { id, number, type, partner_id, refund_type: refundType, status, note_date: date, subtotal, tax_amount, total, reason, lines };
}

export const mockCreditNotes: MockCreditNote[] = [
  creditNote('cn-3', 'CN-2026-0003', 'p1', '2026-06-22', 'credit', 'posted', 'خصم تسوية على فاتورة', [line('l1', 'تسوية سعر', 1, 800)]),
  creditNote('cn-2', 'CN-2026-0002', 'p5', '2026-06-15', 'cash', 'posted', 'استرداد جزئي', [line('l1', 'استرداد خدمة', 1, 1500)]),
  creditNote('cn-1', 'CN-2026-0001', 'p2', '2026-06-10', 'credit', 'draft', 'بضاعة ناقصة', [line('l1', 'نقص في التوريد', 2, 300)]),
  // إشعارات مدينة (للموردين) — خصم بلا حركة مخزون.
  creditNote('dn-2', 'DN-2026-0002', 'p7', '2026-06-19', 'credit', 'posted', 'خصم تجاري لاحق', [line('l1', 'خصم على توريد', 1, 1200)], 'purchase'),
  creditNote('dn-1', 'DN-2026-0001', 'p8', '2026-06-05', 'credit', 'draft', 'تعويض عن تلف جزئي', [line('l1', 'تعويض', 1, 450)], 'purchase'),
];

// ── سجلّ تغييرات المستندات ──────────────────────────────────────────────────
// القيم بالهللات كما يعيدها الـ API (التحويل إلى ريال في طبقة العرض).
export const mockRevisions = [
  {
    id: 'rev-2', action: 'updated', user_name: 'مستخدم المعاينة',
    created_at: '2026-06-22T10:42:00+03:00',
    changes: { shipping: [50000, 20000], total: [172500, 138000], notes: [null, 'تخفيض الشحن'] },
  },
  {
    id: 'rev-1', action: 'created', user_name: 'مستخدم المعاينة',
    created_at: '2026-06-20T09:15:00+03:00',
    changes: {},
  },
];

// ── لوحة التحكم: تفصيل المبيعات · تغذية النشاطات · ورديات ─────────────────
export const mockBreakdown: Record<string, { key: string | null; label: string; amount: string }[]> = {
  day: [
    { key: '2026-08-04', label: '2026-08-04', amount: '12400.00' },
    { key: '2026-08-05', label: '2026-08-05', amount: '15800.00' },
    { key: '2026-08-06', label: '2026-08-06', amount: '9600.00' },
    { key: '2026-08-07', label: '2026-08-07', amount: '21300.00' },
    { key: '2026-08-08', label: '2026-08-08', amount: '18450.00' },
    { key: '2026-08-09', label: '2026-08-09', amount: '27900.00' },
    { key: '2026-08-10', label: '2026-08-10', amount: '31200.00' },
  ],
  product: [
    { key: 'pr2', label: 'حديد تسليح 12مم', amount: '48900.00' },
    { key: 'pr1', label: 'إسمنت مقاوم', amount: '32400.00' },
    { key: 'pr3', label: 'مواد تغليف', amount: '11250.00' },
  ],
  category: [
    { key: 'مواد بناء', label: 'مواد بناء', amount: '81300.00' },
    { key: null, label: 'غير محدّد', amount: '11250.00' },
  ],
  branch: [
    { key: 'b1', label: 'فرع الدمام', amount: '54600.00' },
    { key: 'b2', label: 'فرع الجبيل', amount: '37950.00' },
  ],
  salesperson: [
    { key: 'e1', label: 'سارة إبراهيم', amount: '61200.00' },
    { key: 'e2', label: 'خالد المطيري', amount: '31350.00' },
  ],
};

export const mockFeed = [
  { id: 'rv5', action: 'created', document_type: 'purchase', document_number: 'PUR-2026-0040', user_name: 'مستخدم المعاينة', created_at: '2026-08-10T10:16:00+03:00', changes: {} },
  { id: 'rv1', action: 'status', document_type: 'invoice', document_number: 'INV-2026-00023', user_name: 'مستخدم المعاينة', created_at: '2026-08-10T09:02:00+03:00', changes: {} },
  { id: 'rv2', action: 'created', document_type: 'invoice', document_number: 'INV-2026-00023', user_name: 'مستخدم المعاينة', created_at: '2026-08-09T16:41:00+03:00', changes: {} },
  { id: 'rv3', action: 'created', document_type: 'quote', document_number: 'QUO-2026-00007', user_name: 'مستخدم المعاينة', created_at: '2026-08-09T14:15:00+03:00', changes: {} },
  { id: 'rv4', action: 'status', document_type: 'stock_permit', document_number: 'SI-2026-00002', user_name: 'مستخدم المعاينة', created_at: '2026-08-08T11:20:00+03:00', changes: {} },
];

export const mockSessions = [
  { id: 'ps1', number: 'POS-2026-00012', status: 'open', opening_balance: '3000.00', closing_balance: null, opened_at: '2026-08-10T09:02:00+03:00' },
  { id: 'ps2', number: 'POS-2026-00011', status: 'closed', opening_balance: '2500.00', closing_balance: '4120.00', opened_at: '2026-08-09T08:30:00+03:00' },
  { id: 'ps3', number: 'POS-2026-00010', status: 'closed', opening_balance: '2000.00', closing_balance: '2860.50', opened_at: '2026-08-08T08:15:00+03:00' },
];

// ── الجرد ───────────────────────────────────────────────────────────────────
export const mockStocktakes = [
  {
    id: 'stk-2', number: 'STK-2026-00002', warehouse_name: 'المخزن الرئيسي',
    stocktake_date: '2026-06-28', status: 'draft', notes: null,
    difference_value: '0.00', journal_entry_id: null,
    lines: [
      { id: 'sl1', product_id: 'pr1', product_name: 'إسمنت مقاوم', system_quantity: 420, counted_quantity: null, difference: null, difference_value: '0.00' },
      { id: 'sl2', product_id: 'pr2', product_name: 'حديد تسليح 12مم', system_quantity: 85, counted_quantity: null, difference: null, difference_value: '0.00' },
    ],
  },
  {
    id: 'stk-1', number: 'STK-2026-00001', warehouse_name: 'المخزن الرئيسي',
    stocktake_date: '2026-03-31', status: 'posted', notes: 'جرد الربع الأول',
    difference_value: '-1,125.00', journal_entry_id: 'je-7',
    lines: [
      { id: 'sl3', product_id: 'pr1', product_name: 'إسمنت مقاوم', system_quantity: 300, counted_quantity: 250, difference: -50, difference_value: '-1125.00' },
      { id: 'sl4', product_id: 'pr2', product_name: 'حديد تسليح 12مم', system_quantity: 60, counted_quantity: 60, difference: 0, difference_value: '0.00' },
    ],
  },
];

// ── الأذون المخزنية ─────────────────────────────────────────────────────────
export const mockStockPermits = [
  {
    id: 'sp-3', type: 'transfer', number: 'ST-2026-00001',
    warehouse_name: 'المخزن الرئيسي', target_warehouse_name: 'مخزن الجبيل',
    permit_date: '2026-06-26', status: 'posted', reason: 'إعادة توزيع', notes: null,
    total_cost: '4,500.00', journal_entry_id: null,   // تحويل داخلي — بلا قيد
    lines: [{ id: 'l1', product_name: 'إسمنت مقاوم', quantity: 200, unit_cost: '22.50', line_cost: '4500.00' }],
  },
  {
    id: 'sp-2', type: 'issue', number: 'SI-2026-00002',
    warehouse_name: 'المخزن الرئيسي', target_warehouse_name: null,
    permit_date: '2026-06-23', status: 'posted', reason: 'تلف أثناء المناولة', notes: null,
    total_cost: '675.00', journal_entry_id: 'je-9',
    lines: [{ id: 'l1', product_name: 'إسمنت مقاوم', quantity: 30, unit_cost: '22.50', line_cost: '675.00' }],
  },
  {
    id: 'sp-1', type: 'receipt', number: 'SR-2026-00001',
    warehouse_name: 'المخزن الرئيسي', target_warehouse_name: null,
    permit_date: '2026-06-18', status: 'draft', reason: 'بضاعة وُجدت في الجرد', notes: null,
    total_cost: '225.00', journal_entry_id: null,
    lines: [{ id: 'l1', product_name: 'إسمنت مقاوم', quantity: 10, unit_cost: '22.50', line_cost: '225.00' }],
  },
];

// ── إعدادات المشتريات ───────────────────────────────────────────────────────
export const mockPurchaseSettings = {
  default_tax_rate: 15,
  default_payment_type: 'credit',
  default_tax_inclusive: false,
  purchase_prefix: 'BILL',
};

// ── دورة الشراء (طلب · طلب عروض · عرض مورّد · أمر شراء) ──────────────────────
export interface MockProcurement {
  id: string;
  type: string;
  number: string;
  partner_id: string | null;
  partner_name: string | null;
  status: string;
  doc_date: string;
  due_date: string | null;
  requested_by: string | null;
  subtotal: string;
  tax_amount: string;
  total: string;
  notes: string | null;
  source_document_id: string | null;
  source_number: string | null;
  source_type: string | null;
  converted_purchase_id: string | null;
  supplier_ids: string[];
  lines: MockLine[];
}

function procurement(
  id: string, type: string, number: string, partnerId: string | null, date: string,
  status: string, requestedBy: string | null, lines: MockLine[],
  extra: Partial<MockProcurement> = {}
): MockProcurement {
  const { subtotal, tax_amount, total } = docTotals(lines);
  return {
    id, type, number, partner_id: partnerId,
    partner_name: partnerId ? (mockPartners.find((p) => p.id === partnerId)?.name ?? null) : null,
    status, doc_date: date, due_date: null, requested_by: requestedBy,
    subtotal, tax_amount, total, notes: null,
    source_document_id: null, source_number: null, source_type: null,
    converted_purchase_id: null, supplier_ids: [], lines,
    ...extra,
  };
}

// سلسلة واقعية: طلب ← طلب عروض ← عرض مورّد ← أمر شراء.
export const mockProcurement: MockProcurement[] = [
  procurement('pr-2', 'request', 'PR-2026-00002', null, '2026-06-24', 'submitted', 'إدارة الصيانة',
    [line('l1', 'قطع غيار مضخات', 4, 950)]),
  procurement('pr-1', 'request', 'PR-2026-00001', null, '2026-06-11', 'converted', 'إدارة المشاريع',
    [line('l1', 'إسمنت مقاوم', 200, 24), line('l2', 'حديد تسليح 12مم', 40, 310)]),

  procurement('rfq-1', 'rfq', 'RFQ-2026-00001', null, '2026-06-13', 'converted', 'إدارة المشاريع',
    [line('l1', 'إسمنت مقاوم', 200, 24), line('l2', 'حديد تسليح 12مم', 40, 310)],
    { source_document_id: 'pr-1', source_number: 'PR-2026-00001', source_type: 'request', supplier_ids: ['p7', 'p8'], due_date: '2026-06-18' }),

  procurement('pq-1', 'quotation', 'PQ-2026-00001', 'p7', '2026-06-17', 'converted', 'إدارة المشاريع',
    [line('l1', 'إسمنت مقاوم', 200, 23.5), line('l2', 'حديد تسليح 12مم', 40, 305)],
    { source_document_id: 'rfq-1', source_number: 'RFQ-2026-00001', source_type: 'rfq', due_date: '2026-07-17' }),

  procurement('po-2', 'order', 'PO-2026-00002', 'p8', '2026-06-25', 'approved', 'إدارة التشغيل',
    [line('l1', 'مواد تغليف', 500, 6.5)], { due_date: '2026-07-05' }),
  procurement('po-1', 'order', 'PO-2026-00001', 'p7', '2026-06-20', 'converted', 'إدارة المشاريع',
    [line('l1', 'إسمنت مقاوم', 200, 23.5), line('l2', 'حديد تسليح 12مم', 40, 305)],
    { source_document_id: 'pq-1', source_number: 'PQ-2026-00001', source_type: 'quotation',
      converted_purchase_id: mockPurchases[0].id, due_date: '2026-06-30' }),
];

// ── المصروفات (الحسابات) ────────────────────────────────────────────────────
export interface MockExpense {
  id: string;
  number: string;
  account_id: string;
  account_code: string;
  account_name: string;
  partner_id: string | null;
  expense_date: string;
  payment_method: 'cash' | 'bank' | 'credit';
  description: string | null;
  amount: string;
  tax_rate: number;
  tax_amount: string;
  total: string;
  status: string;
}

function expense(
  id: string, number: string, code: string, name: string, date: string,
  method: MockExpense['payment_method'], status: string, amount: number, rate: number, description: string,
): MockExpense {
  const tax = Math.round((amount * rate) / 100);
  return {
    id, number, account_id: `a${code}`, account_code: code, account_name: name,
    partner_id: method === 'credit' ? 'p3' : null, expense_date: date, payment_method: method,
    description, amount: amount.toFixed(2), tax_rate: rate, tax_amount: tax.toFixed(2),
    total: (amount + tax).toFixed(2), status,
  };
}

export const mockExpenses: MockExpense[] = [
  expense('exp-4', 'EXP-2026-00004', '5130', 'الإيجار', '2026-06-25', 'bank', 'posted', 12000, 15, 'إيجار المعرض - يونيو'),
  expense('exp-3', 'EXP-2026-00003', '5140', 'الوقود والمحروقات', '2026-06-20', 'cash', 'posted', 1850, 15, 'تعبئة وقود الأسطول'),
  expense('exp-2', 'EXP-2026-00002', '5150', 'مصروفات عامة', '2026-06-14', 'credit', 'posted', 3200, 15, 'قرطاسية ولوازم مكتبية'),
  expense('exp-1', 'EXP-2026-00001', '5120', 'الرواتب والأجور', '2026-06-01', 'bank', 'draft', 48000, 0, 'رواتب يونيو (مسودة)'),
];

// ── مراكز التكلفة (الحسابات) ─────────────────────────────────────────────────
export interface MockCostCenter {
  id: string;
  code: string;
  name: string;
  is_active: boolean;
}

export const mockCostCenters: MockCostCenter[] = [
  { id: 'cc-1', code: 'CC-DMM', name: 'فرع الدمام', is_active: true },
  { id: 'cc-2', code: 'CC-KHB', name: 'فرع الخبر', is_active: true },
  { id: 'cc-3', code: 'CC-JBL', name: 'فرع الجبيل', is_active: true },
  { id: 'cc-4', code: 'CC-ADM', name: 'الإدارة العامة', is_active: false },
];

// ── الأصول الثابتة (الحسابات) ────────────────────────────────────────────────
export interface MockAsset {
  id: string;
  number: string;
  name: string;
  account_id: string;
  account_code: string;
  account_name: string;
  partner_id: string | null;
  acquisition_date: string;
  payment_method: 'cash' | 'bank' | 'credit';
  cost: string;
  tax_rate: number;
  tax_amount: string;
  total: string;
  salvage_value: string;
  useful_life_months: number;
  accumulated_depreciation: string;
  book_value: string;
  status: string;
}

function asset(
  id: string, number: string, name: string, code: string, accName: string, date: string,
  method: MockAsset['payment_method'], status: string, cost: number, rate: number,
  salvage: number, life: number, accumulated: number,
): MockAsset {
  const tax = Math.round((cost * rate) / 100);
  return {
    id, number, name, account_id: `a${code}`, account_code: code, account_name: accName,
    partner_id: method === 'credit' ? 'p3' : null, acquisition_date: date, payment_method: method,
    cost: cost.toFixed(2), tax_rate: rate, tax_amount: tax.toFixed(2), total: (cost + tax).toFixed(2),
    salvage_value: salvage.toFixed(2), useful_life_months: life,
    accumulated_depreciation: accumulated.toFixed(2), book_value: (cost - accumulated).toFixed(2), status,
  };
}

export const mockAssets: MockAsset[] = [
  asset('fa-3', 'FA-2026-00003', 'سيارة توصيل هيونداي', '1220', 'وسائل النقل', '2026-01-15', 'bank', 'active', 120000, 15, 12000, 60, 18000),
  asset('fa-2', 'FA-2026-00002', 'خط إنتاج تعبئة', '1210', 'المعدات والآليات', '2026-03-01', 'credit', 'active', 45000, 15, 5000, 48, 5000),
  asset('fa-1', 'FA-2026-00001', 'أثاث مكتبي', '1210', 'المعدات والآليات', '2026-06-10', 'cash', 'draft', 8000, 15, 0, 36, 0),
];

// ── الفواتير الدورية ───────────────────────────────────────────────────────
export interface MockRecurring {
  id: string;
  title: string | null;
  partner_id: string;
  payment_type: string;
  frequency: string;
  start_date: string;
  next_run_date: string;
  end_date: string | null;
  active: boolean;
  generated_count: number;
  subtotal: string;
  tax_amount: string;
  total: string;
  notes: string | null;
  lines: MockLine[];
}

function recurring(
  id: string, title: string, partner_id: string, frequency: string,
  start: string, next: string, count: number, lines: MockLine[]
): MockRecurring {
  const { subtotal, tax_amount, total } = docTotals(lines);
  return {
    id, title, partner_id, payment_type: 'credit', frequency,
    start_date: start, next_run_date: next, end_date: null, active: true,
    generated_count: count, subtotal, tax_amount, total, notes: null, lines,
  };
}

export const mockRecurring: MockRecurring[] = [
  recurring('rc-1', 'اشتراك خدمة سحابية شهري', 'p1', 'monthly', '2026-01-01', '2026-07-01', 6, [line('l1', 'اشتراك شهري', 1, 1500)]),
  recurring('rc-2', 'عقد صيانة ربع سنوي', 'p4', 'quarterly', '2026-01-01', '2026-07-01', 2, [line('l1', 'صيانة دورية', 1, 4000)]),
  recurring('rc-3', 'إيجار وحدة سنوي', 'p5', 'yearly', '2026-01-01', '2027-01-01', 1, [line('l1', 'إيجار سنوي', 1, 60000)]),
];

// ── سجلّ علاقات العملاء (CRM) ──────────────────────────────────────────────
export const mockCrmActivities = [
  { id: 'cr-1', partner_id: 'p1', type: 'call', subject: 'متابعة عرض السعر', activity_at: '2026-06-26T11:00:00', status: 'done', notes: 'مهتم، سيردّ الأسبوع القادم' },
  { id: 'cr-2', partner_id: 'p4', type: 'meeting', subject: 'اجتماع تجديد العقد', activity_at: '2026-07-03T09:30:00', status: 'open', notes: null },
  { id: 'cr-3', partner_id: 'p2', type: 'task', subject: 'إرسال كتالوج المنتجات', activity_at: '2026-06-29T08:00:00', status: 'open', notes: null },
];

// ── جهات الاتصال ───────────────────────────────────────────────────────────
export const mockContacts = [
  { id: 'ct-1', partner_id: 'p1', name: 'سعد المالكي', job_title: 'مدير المشتريات', email: 'saad@gulf-trade.sa', phone: '0551112233', notes: null },
  { id: 'ct-2', partner_id: 'p4', name: 'هند العتيبي', job_title: 'محاسبة', email: 'hind@najd-supply.sa', phone: '0554445566', notes: null },
  { id: 'ct-3', partner_id: null, name: 'مكتب الاستشارات القانونية', job_title: 'مستشار', email: 'info@legal.sa', phone: '0138001122', notes: 'جهة خارجية' },
];

// ── المواعيد ───────────────────────────────────────────────────────────────
export const mockAppointments = [
  { id: 'ap-1', partner_id: 'p1', title: 'اجتماع متابعة العقد', appointment_at: '2026-07-02T10:00:00', duration_minutes: 60, status: 'scheduled', location: 'مكتب الدمام', notes: null },
  { id: 'ap-2', partner_id: 'p4', title: 'عرض المنتجات الجديدة', appointment_at: '2026-06-28T13:30:00', duration_minutes: 45, status: 'scheduled', location: 'عبر الهاتف', notes: null },
  { id: 'ap-3', partner_id: 'p2', title: 'توقيع اتفاقية', appointment_at: '2026-06-20T09:00:00', duration_minutes: 30, status: 'done', location: 'الخبر', notes: 'تم بنجاح' },
];

// ── المدفوعات ──────────────────────────────────────────────────────────────
export const mockPaymentMethods = [
  { id: 'pm-method-cash', name: 'نقدي', settlement_type: 'cash', cash_bank_account_id: 'cash-main', is_active: true, is_default: true },
  { id: 'pm-method-bank', name: 'تحويل بنكي', settlement_type: 'bank', cash_bank_account_id: 'bank-main', is_active: true, is_default: false },
];

export const mockCashBankAccounts = [
  { id: 'cash-main', account_id: 'acc-1110', name: 'الخزينة الرئيسية', type: 'cash', is_active: true, is_main: true },
  { id: 'bank-main', account_id: 'acc-1120', name: 'الحساب البنكي الرئيسي', type: 'bank', is_active: true, is_main: true },
];

export const mockPayments = [
  { id: 'pm-51', number: 'PMT-2026-0051', partner_id: 'p1', direction: 'received', method: 'bank', payment_date: '2026-06-24', amount: '5750.00' },
  { id: 'pm-50', number: 'PMT-2026-0050', partner_id: 'p2', direction: 'received', method: 'cash', payment_date: '2026-06-22', amount: '6325.00' },
  { id: 'pm-49', number: 'PMT-2026-0049', partner_id: 'p7', direction: 'paid', method: 'bank', payment_date: '2026-06-20', amount: '6900.00' },
  { id: 'pm-48', number: 'PMT-2026-0048', partner_id: 'p5', direction: 'received', method: 'bank', payment_date: '2026-06-18', amount: '21275.00' },
  { id: 'pm-47', number: 'PMT-2026-0047', partner_id: 'p8', direction: 'paid', method: 'cash', payment_date: '2026-06-12', amount: '3450.00' },
  { id: 'pm-46', number: 'PMT-2026-0046', partner_id: 'p6', direction: 'received', method: 'bank', payment_date: '2026-06-08', amount: '4600.00' },
];

// ── الموارد البشرية ────────────────────────────────────────────────────────
export interface MockEmployee {
  id: string;
  employee_no: string;
  name: string;
  national_id: string;
  job_title: { id: string; name: string } | null;
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
    id, employee_no: no, name, national_id: `10${no.slice(-6)}0`,
    job_title: { id: `jt-${id}`, name: job },
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

// الهيكل التنظيمي — كيانات مُدارة (تعرض قوائم اختيار في نموذج الموظف).
export const mockJobTitles = mockEmployees
  .map((e) => e.job_title)
  .filter((jt): jt is { id: string; name: string } => !!jt)
  .map((jt) => ({ ...jt, is_active: true }));
export const mockDepartments = [
  { id: 'dep-1', name: 'المالية', is_active: true },
  { id: 'dep-2', name: 'المبيعات', is_active: true },
  { id: 'dep-3', name: 'العمليات', is_active: true },
];
export const mockJobLevels = [
  { id: 'lvl-1', name: 'مبتدئ', is_active: true },
  { id: 'lvl-2', name: 'متوسط', is_active: true },
  { id: 'lvl-3', name: 'أول', is_active: true },
];
export const mockEmploymentTypes = [
  { id: 'et-1', name: 'دوام كامل', is_active: true },
  { id: 'et-2', name: 'دوام جزئي', is_active: true },
  { id: 'et-3', name: 'عقد', is_active: true },
];

// الإجازات — نطاق البناء الأول (نوعٌ فقط + رصيدٌ مباشر).
export const mockLeaveTypes = [
  { id: 'lt-1', name: 'سنوية', is_paid: true, annual_days: 21, requires_approval: true, is_active: true, leave_requests_count: 1 },
  { id: 'lt-2', name: 'مرضية', is_paid: true, annual_days: 30, requires_approval: true, is_active: true, leave_requests_count: 0 },
  { id: 'lt-3', name: 'بلا راتب', is_paid: false, annual_days: 0, requires_approval: true, is_active: true, leave_requests_count: 0 },
];
export const mockLeaveRequests = [
  {
    id: 'lr-1', employee_id: 'em-1', employee: { id: 'em-1', name: 'أحمد العتيبي' },
    leave_type_id: 'lt-1', leave_type: { id: 'lt-1', name: 'سنوية', is_paid: true },
    start_date: '2026-09-01', end_date: '2026-09-05', days_count: 5, status: 'pending',
    reason: 'سفر عائلي', rejection_reason: null, approver: null, approved_at: null,
    created_at: '2026-08-15T09:00:00Z',
  },
];

// إدارة الطلبات — أنواع ثابتة بحقول موحّدة (نطاق البناء الأول)، منفصلة عن الإجازات.
export const mockRequestTypes = [
  { id: 'rqt-1', name: 'سلفة', requires_approval: true, is_active: true, employee_requests_count: 1 },
  { id: 'rqt-2', name: 'استئذان', requires_approval: true, is_active: true, employee_requests_count: 0 },
  { id: 'rqt-3', name: 'شكوى', requires_approval: false, is_active: true, employee_requests_count: 0 },
];
export const mockEmployeeRequests = [
  {
    id: 'er-1', employee_id: 'em-1', employee: { id: 'em-1', name: 'أحمد العتيبي' },
    request_type_id: 'rqt-1', request_type: { id: 'rqt-1', name: 'سلفة' },
    title: 'سلفة براتب شهر', description: 'سلفة على الراتب لظرف طارئ.', requested_date: '2026-09-10',
    status: 'pending', rejection_reason: null, approver: null, approved_at: null,
    created_at: '2026-08-18T10:00:00Z',
  },
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

export const mockSalesConfig: Record<string, unknown> = {
  statuses: [
    { name: 'مسودة', color: '#6B7280' },
    { name: 'مرحّلة', color: '#1E40AF' },
    { name: 'مدفوعة', color: '#16A34A' },
    { name: 'ملغاة', color: '#DC2626' },
  ],
  fields: [
    { label: 'رقم أمر الشراء', type: 'text' },
    { label: 'تاريخ التسليم', type: 'date' },
  ],
  pricelists: [
    { name: 'قائمة التجزئة', adjustment: 0 },
    { name: 'قائمة الجملة', adjustment: -10 },
  ],
  sources: [{ name: 'المتجر الإلكتروني' }, { name: 'الفرع الرئيسي' }, { name: 'مندوب المبيعات' }],
  shipping: [
    { name: 'توصيل داخل المدينة', rate: 25 },
    { name: 'شحن بين المدن', rate: 60 },
  ],
  taxes: [
    { name: 'VAT', rate: 15, inclusive: false },
    { name: 'Zero Rated', rate: 0, inclusive: false },
    { name: 'Tax Free', rate: 0, inclusive: false },
  ],
  einvoice: { enabled: true, phase: '2', vat_number: '310122393500003' },
  designs: { template: 'classic', theme: 'blue', show_logo: true, logo: '', logo_height: 56, sections: [], accent_color: '#1E40AF', footer_text: 'شكراً لتعاملكم معنا', terms_text: 'السداد خلال 30 يوماً من تاريخ الفاتورة.' },
  orders: { auto_convert: false, require_approval: true, prefix: 'SO' },
  pos: {
    default_customer: 'عميل نقدي (POS)',
    print_receipt: true,
    receipt_paper_size: 'thermal_80',
    allow_discount: true,
    receipt_footer: 'شكراً لزيارتكم',
    enabled_payment_method_ids: [],
    payment_methods_mode: 'all_active',
    default_payment_method_id: 'pm-method-cash',
    allow_deferred_payment: true,
    show_product_images: true,
    cash_drawer_enabled: false,
    cash_drawer_driver: 'unavailable',
    cash_drawer_auto_open_after_cash: false,
  },
};

export const mockBranches = [
  { id: 'br-1', code: '00001', name: 'الفرع الرئيسي', is_main: true, phone: '0138100000', mobile: '0550000000', address_line1: 'طريق الملك فهد', address_line2: '', city: 'الدمام', region: 'المنطقة الشرقية', country: 'Saudi Arabia', description: '', working_hours: 'الأحد–الخميس ٩ص–٥م', latitude: 26.4207, longitude: 50.0888, is_active: true },
  { id: 'br-2', code: '00002', name: 'فرع الخبر', is_main: false, phone: '0138200000', mobile: '0551111111', address_line1: 'شارع الأمير فيصل', address_line2: '', city: 'الخبر', region: 'المنطقة الشرقية', country: 'Saudi Arabia', description: '', working_hours: '', latitude: 26.2794, longitude: 50.2083, is_active: true },
  { id: 'br-3', code: '00003', name: 'فرع الجبيل', is_main: false, phone: '0133000000', mobile: '', address_line1: '', address_line2: '', city: 'الجبيل', region: 'المنطقة الشرقية', country: 'Saudi Arabia', description: '', working_hours: '', latitude: null, longitude: null, is_active: false },
];

export const mockWarehouses = [
  { id: 'wh-1', code: '00001', name: 'المخزن الرئيسي', branch_id: 'br-1', city: 'الدمام', address: '', notes: '', is_default: true, is_active: true },
  { id: 'wh-2', code: '00002', name: 'مخزن الخبر', branch_id: 'br-2', city: 'الخبر', address: '', notes: '', is_default: false, is_active: true },
  { id: 'wh-3', code: '00003', name: 'مخزن مركزي', branch_id: null, city: 'الدمام', address: '', notes: '', is_default: false, is_active: false },
];

export const mockBranchSettings = {
  main_branch_id: 'br-1',
  share_customers: true,
  share_products: true,
  share_suppliers: true,
  share_cost_centers: true,
  account_branch_scoping: false,
};

export const mockPosSessions = [
  { id: 'ps-2', number: 'POS-2026-0002', status: 'open', opening_balance: '500.00', closing_balance: null, expected_balance: null, difference: null, opened_at: '2026-06-28T08:00:00', closed_at: null },
  { id: 'ps-1', number: 'POS-2026-0001', status: 'closed', opening_balance: '500.00', closing_balance: '4380.00', expected_balance: '4380.00', difference: '0.00', opened_at: '2026-06-27T08:00:00', closed_at: '2026-06-27T20:00:00' },
];

export const mockCustomerSettings = {
  default_type: 'customer',
  default_city: 'الدمام',
  payment_terms_days: 30,
  require_tax_number: false,
  loyalty_enabled: false,
};

export const mockSalesSettings = {
  default_tax_rate: 15,
  default_payment_type: 'credit',
  quote_validity_days: 14,
  invoice_prefix: 'INV',
  default_terms: 'الدفع خلال 30 يوماً من تاريخ الفاتورة.',
};

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

export const mockCostCenterProfit = {
  rows: [
    { cost_center_id: 'cc-1', code: 'CC-DMM', name: 'فرع الدمام', revenue: '210000.00', expense: '84300.00', profit: '125700.00' },
    { cost_center_id: 'cc-2', code: 'CC-KHB', name: 'فرع الخبر', revenue: '148000.00', expense: '96500.00', profit: '51500.00' },
    { cost_center_id: 'cc-3', code: 'CC-JBL', name: 'فرع الجبيل', revenue: '124500.00', expense: '132000.00', profit: '-7500.00' },
    { cost_center_id: 'cc-4', code: 'CC-ADM', name: 'الإدارة العامة', revenue: '0.00', expense: '18750.00', profit: '-18750.00' },
  ],
  total_revenue: '482500.00',
  total_expense: '331550.00',
  total_profit: '150950.00',
};

// تقارير الحسابات العامة في وضع العرض: تطابق عقود Laravel الحقيقية كي يبقى
// اختبار الواجهة التجريبية كاشفاً لانحراف العقد لا سبباً لانهيار وقت التشغيل.
export const mockCashFlow = {
  operating: {
    inflows: '38250.00', outflows: '14400.00', net: '23850.00',
    entries: [
      { date: '2026-06-24', number: 'JRN-2026-0051', description: 'تحصيل من عميل', inflow: '5750.00', outflow: '0.00', net: '5750.00' },
      { date: '2026-06-20', number: 'JRN-2026-0049', description: 'سداد مورد', inflow: '0.00', outflow: '6900.00', net: '-6900.00' },
    ],
  },
  investing: {
    inflows: '0.00', outflows: '45000.00', net: '-45000.00',
    entries: [{ date: '2026-06-15', number: 'JRN-2026-0042', description: 'شراء معدات', inflow: '0.00', outflow: '45000.00', net: '-45000.00' }],
  },
  financing: {
    inflows: '60000.00', outflows: '0.00', net: '60000.00',
    entries: [{ date: '2026-06-01', number: 'JRN-2026-0038', description: 'ضخ رأس مال', inflow: '60000.00', outflow: '0.00', net: '60000.00' }],
  },
  net_cash_flow: '38850.00',
};

export const mockTaxReport = {
  input_vat: '12150.00',
  output_vat: '21300.00',
  net_vat: '9150.00',
  status: 'payable',
};

export const mockJournalEntries = {
  rows: [
    {
      entry_id: 'jrn-51', date: '2026-06-24', number: 'JRN-2026-0051', description: 'تحصيل من عميل', debit: '5750.00', credit: '5750.00',
      lines: [
        { account_id: 'a1120', account_code: '1120', account_name: 'البنك', description: null, debit: '5750.00', credit: '0.00' },
        { account_id: 'a1130', account_code: '1130', account_name: 'العملاء (المدينون)', description: null, debit: '0.00', credit: '5750.00' },
      ],
    },
    {
      entry_id: 'jrn-49', date: '2026-06-20', number: 'JRN-2026-0049', description: 'سداد مورد', debit: '6900.00', credit: '6900.00',
      lines: [
        { account_id: 'a2110', account_code: '2110', account_name: 'الموردون (الدائنون)', description: null, debit: '6900.00', credit: '0.00' },
        { account_id: 'a1110', account_code: '1110', account_name: 'الصندوق', description: null, debit: '0.00', credit: '6900.00' },
      ],
    },
  ],
  total_debit: '12650.00',
  total_credit: '12650.00',
};

function accountLedgerFor(accountId: string) {
  const account = mockAccounts.find((candidate) => candidate.id === accountId) ?? mockAccounts.find((candidate) => candidate.code === '1110')!;
  const rows = account.code === '1120'
    ? [{ date: '2026-06-24', number: 'JRN-2026-0051', description: 'تحصيل من عميل', debit: '5750.00', credit: '0.00', balance: '163520.00' }]
    : [{ date: '2026-06-20', number: 'JRN-2026-0049', description: 'سداد مورد', debit: '0.00', credit: '6900.00', balance: '54320.00' }];
  return { account: { id: account.id, code: account.code, name: account.name }, opening_balance: account.code === '1120' ? '157770.00' : '61220.00', rows, closing_balance: rows[rows.length - 1].balance };
}

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
  const base = { partner: { id: p.id, name: p.name, type: p.type }, opening_balance: '0.00' };

  // عند فتح التقرير عبر المورد، لا نعيد إطلاقاً مستندات مبيعات أو سندات قبض.
  // المورد p7 لديه دورة متكاملة: شراء آجل، إشعار مدين، ثم سند صرف.
  if (p.type === 'supplier' || p.type === 'both') {
    if (p.id !== 'p7') return { ...base, rows: [], closing_balance: '0.00' };
    return {
      ...base,
      rows: [
        {
          date: '2026-06-15', number: 'JRN-2026-0043', description: 'فاتورة شراء PUR-2026-0043',
          debit: '0.00', credit: '13800.00', balance: '-13800.00',
          source: { kind: 'purchase', id: 'pu-43', label: 'فاتورة شراء PUR-2026-0043', allocations: [] },
        },
        {
          date: '2026-06-19', number: 'JRN-2026-0044', description: 'إشعار مدين DN-2026-0002',
          debit: '1200.00', credit: '0.00', balance: '-12600.00',
          source: { kind: 'credit_note', id: 'dn-2', label: 'إشعار مدين DN-2026-0002', allocations: [] },
        },
        {
          date: '2026-06-20', number: 'JRN-2026-0049', description: 'سند صرف PMT-2026-0049',
          debit: '6900.00', credit: '0.00', balance: '-5700.00',
          source: {
            kind: 'payment', id: 'pm-49', label: 'سند صرف PMT-2026-0049',
            allocations: [{ kind: 'purchase', id: 'pu-43', number: 'PUR-2026-0043', amount: '6900.00' }],
          },
        },
      ],
      closing_balance: '-5700.00',
    };
  }

  return {
    ...base,
    rows: [
      {
        date: '2026-06-01', number: 'JRN-2026-0117', description: 'فاتورة مبيعات INV-2026-0117',
        debit: '12650.00', credit: '0.00', balance: '12650.00',
        source: { kind: 'invoice', id: 'inv-0117', label: 'فاتورة INV-2026-0117', allocations: [] },
      },
      {
        date: '2026-06-22', number: 'JRN-2026-0050', description: 'دفعة مستلمة PMT-2026-0050',
        debit: '0.00', credit: '6325.00', balance: '6325.00',
        source: {
          kind: 'payment', id: 'pmt-0050', label: 'دفعة PMT-2026-0050',
          allocations: [{ kind: 'invoice', id: 'inv-0117', number: 'INV-2026-0117', amount: '6325.00' }],
        },
      },
    ],
    closing_balance: '6325.00',
  };
}

// ── تقرير المبيعات في وضع العرض التجريبي ───────────────────────────────────
// يبقى هذا المسار محصوراً في `isDemo()`؛ الواجهة الحقيقية تقرأ عقد Laravel نفسه.
function salesReportFor(path: string) {
  const query = new URLSearchParams(path.split('?')[1] ?? '');
  const view = query.get('view') ?? 'period';
  const from = query.get('from') ?? '';
  const to = query.get('to') ?? '';
  const customerId = query.get('customer_id') ?? '';
  const paymentStatus = query.get('payment_status') ?? '';
  const receiptMethod = query.get('receipt_method') ?? '';
  const money = (value: number) => value.toFixed(2);
  const inRange = (date: string) => (!from || date >= from) && (!to || date <= to);
  const invoices = mockInvoices.filter((invoice) => invoice.status === 'posted'
    && inRange(invoice.invoice_date)
    && (!customerId || invoice.partner_id === customerId)
    && (!paymentStatus || invoice.payment_status === paymentStatus));
  const amount = (list: MockInvoice[]) => list.reduce((sum, invoice) => sum + Number(invoice.total), 0);
  const netSales = (list: MockInvoice[]) => list.reduce((sum, invoice) => sum + Number(invoice.subtotal), 0);
  const tax = (list: MockInvoice[]) => list.reduce((sum, invoice) => sum + Number(invoice.tax_amount), 0);
  const invoiceTotals = { invoices: invoices.length, amount: money(amount(invoices)), net_sales: money(netSales(invoices)), tax: money(tax(invoices)) };
  const group = <T extends { key: string; label: string }>(items: T[], value: (item: T) => number, countKey: 'invoices' | 'quantity' | 'receipts') => {
    const buckets = new Map<string, { key: string; label: string; count: number; amount: number }>();
    items.forEach((item) => {
      const bucket = buckets.get(item.key) ?? { key: item.key, label: item.label, count: 0, amount: 0 };
      bucket.count += 1;
      bucket.amount += value(item);
      buckets.set(item.key, bucket);
    });
    return [...buckets.values()].sort((a, b) => b.amount - a.amount).map((bucket) => ({ key: bucket.key, label: bucket.label, [countKey]: bucket.count, amount: money(bucket.amount) }));
  };

  if (view === 'payments') {
    const receipts = mockPayments.filter((payment) => payment.direction === 'received' && inRange(payment.payment_date) && (!receiptMethod || payment.method === receiptMethod));
    const rows = group(receipts.map((payment) => ({ key: payment.payment_date.slice(0, 7), label: payment.payment_date.slice(0, 7), amount: Number(payment.amount) })), (row) => row.amount, 'receipts');
    return { view, data: rows, totals: { receipts: receipts.length, amount: money(receipts.reduce((sum, receipt) => sum + Number(receipt.amount), 0)) }, scope: { interval: query.get('interval') ?? 'month', source: 'posted_receipts' } };
  }

  if (view === 'product') {
    const rows = group(invoices.flatMap((invoice) => invoice.lines.map((line) => ({ key: line.description ?? 'manual', label: line.description ?? 'بند وصفي', amount: Number(line.line_total), quantity: line.quantity }))), (row) => row.amount, 'quantity');
    const quantityByProduct = new Map(invoices.flatMap((invoice) => invoice.lines).map((line) => [line.description ?? 'manual', line.quantity]));
    return { view, data: rows.map((row) => ({ ...row, quantity: quantityByProduct.get(row.key) ?? row.quantity })), totals: { invoices: invoices.length, amount: money(invoices.flatMap((invoice) => invoice.lines).reduce((sum, line) => sum + Number(line.line_total), 0)) }, scope: { interval: query.get('interval') ?? 'month', source: 'posted_sales_invoices' } };
  }

  if (view === 'customer') {
    const rows = group(invoices.map((invoice) => ({ key: invoice.partner_id, label: mockPartners.find((partner) => partner.id === invoice.partner_id)?.name ?? 'غير مسند', amount: Number(invoice.total) })), (row) => row.amount, 'invoices');
    return { view, data: rows, totals: invoiceTotals, scope: { interval: query.get('interval') ?? 'month', source: 'posted_sales_invoices' } };
  }

  const periods = group(invoices.map((invoice) => ({ key: invoice.invoice_date.slice(0, 7), label: invoice.invoice_date.slice(0, 7), amount: Number(invoice.total) })), (row) => row.amount, 'invoices');
  if (view === 'profit') {
    const rows = periods.map((row) => ({ ...row, revenue: row.amount, cost: '0.00', profit: row.amount, margin_bp: 10000 }));
    const revenue = netSales(invoices);
    return { view, data: rows, totals: { revenue: money(revenue), cost: '0.00', profit: money(revenue), margin_bp: 10000 }, scope: { interval: query.get('interval') ?? 'month', source: 'posted_sales_invoices' } };
  }
  if (view === 'salesperson') {
    return { view, data: [{ key: 'unassigned', label: 'غير مسند', invoices: invoices.length, amount: money(amount(invoices)) }], totals: invoiceTotals, scope: { interval: query.get('interval') ?? 'month', source: 'posted_sales_invoices' } };
  }
  return { view, data: periods, totals: invoiceTotals, scope: { interval: query.get('interval') ?? 'month', source: 'posted_sales_invoices' } };
}

// ── تقرير المشتريات في وضع العرض التجريبي ───────────────────────────────────
// هذا الموجّه لا يُستدعى إلا مع `isDemo()`؛ وهو يسهّل مراجعة واجهة التقارير
// المتجاوبة من دون طلب أي بيانات حقيقية أو تغيير منطق تقارير Laravel.
function purchasesReportFor(path: string) {
  const query = new URLSearchParams(path.split('?')[1] ?? '');
  const view = query.get('view') ?? 'period';
  const from = query.get('from') ?? '';
  const to = query.get('to') ?? '';
  const supplierId = query.get('supplier_id') ?? '';
  const paymentStatus = query.get('payment_status') ?? '';
  const paymentMethod = query.get('payment_method') ?? '';
  const money = (value: number) => value.toFixed(2);
  const inRange = (date: string) => (!from || date >= from) && (!to || date <= to);
  const purchases = mockPurchases.filter((purchase) => purchase.status === 'posted'
    && inRange(purchase.purchase_date)
    && (!supplierId || purchase.partner_id === supplierId)
    && (!paymentStatus || purchase.payment_status === paymentStatus));
  const amount = (list: MockPurchase[]) => list.reduce((sum, purchase) => sum + Number(purchase.total), 0);
  const net = (list: MockPurchase[]) => list.reduce((sum, purchase) => sum + Number(purchase.subtotal), 0);
  const tax = (list: MockPurchase[]) => list.reduce((sum, purchase) => sum + Number(purchase.tax_amount), 0);
  const balance = (list: MockPurchase[]) => list.reduce((sum, purchase) => sum + Number(purchase.remaining), 0);
  const totals = {
    purchases: purchases.length,
    amount: money(amount(purchases)),
    net_purchases: money(net(purchases)),
    tax: money(tax(purchases)),
    balance: money(balance(purchases)),
  };
  const group = <T extends { key: string; label: string }>(items: T[], value: (item: T) => number, countKey: 'purchases' | 'payments') => {
    const buckets = new Map<string, { key: string; label: string; count: number; amount: number }>();
    items.forEach((item) => {
      const bucket = buckets.get(item.key) ?? { key: item.key, label: item.label, count: 0, amount: 0 };
      bucket.count += 1;
      bucket.amount += value(item);
      buckets.set(item.key, bucket);
    });
    return [...buckets.values()].sort((a, b) => b.amount - a.amount).map((bucket) => ({ key: bucket.key, label: bucket.label, [countKey]: bucket.count, amount: money(bucket.amount) }));
  };

  if (view === 'payments') {
    const payments = mockPayments.filter((payment) => payment.direction === 'paid'
      && inRange(payment.payment_date)
      && (!paymentMethod || payment.method === paymentMethod));
    const rows = group(payments.map((payment) => ({ key: payment.payment_date.slice(0, 7), label: payment.payment_date.slice(0, 7), amount: Number(payment.amount) })), (row) => row.amount, 'payments');
    return { view, data: rows, totals: { payments: payments.length, amount: money(payments.reduce((sum, payment) => sum + Number(payment.amount), 0)) }, scope: { interval: query.get('interval') ?? 'month', source: 'posted_supplier_payments' } };
  }

  if (view === 'product') {
    const rows = group(purchases.flatMap((purchase) => purchase.lines.map((line) => ({ key: line.description ?? 'manual', label: line.description ?? 'بند وصفي', amount: Number(line.line_total), quantity: line.quantity }))), (row) => row.amount, 'purchases');
    const quantityByProduct = new Map(purchases.flatMap((purchase) => purchase.lines).map((line) => [line.description ?? 'manual', line.quantity]));
    return { view, data: rows.map((row) => ({ ...row, quantity: quantityByProduct.get(row.key) ?? row.purchases })), totals, scope: { interval: query.get('interval') ?? 'month', source: 'posted_purchases' } };
  }

  if (view === 'supplier' || view === 'balances') {
    const rows = group(purchases.map((purchase) => ({ key: purchase.partner_id, label: mockPartners.find((partner) => partner.id === purchase.partner_id)?.name ?? 'غير مسند', amount: Number(purchase.total), balance: Number(purchase.remaining) })), (row) => row.amount, 'purchases');
    if (view === 'balances') {
      const balances = new Map<string, number>();
      purchases.forEach((purchase) => balances.set(purchase.partner_id, (balances.get(purchase.partner_id) ?? 0) + Number(purchase.remaining)));
      return { view, data: rows.map((row) => ({ ...row, balance: money(balances.get(row.key) ?? 0) })), totals, scope: { interval: query.get('interval') ?? 'month', source: 'posted_purchases' } };
    }
    return { view, data: rows, totals, scope: { interval: query.get('interval') ?? 'month', source: 'posted_purchases' } };
  }

  if (view === 'employee') {
    return { view, data: [{ key: 'unassigned', label: 'غير مسند', purchases: purchases.length, amount: money(amount(purchases)) }], totals, scope: { interval: query.get('interval') ?? 'month', source: 'posted_purchases' } };
  }

  const periods = group(purchases.map((purchase) => ({ key: purchase.purchase_date.slice(0, 7), label: purchase.purchase_date.slice(0, 7), amount: Number(purchase.total) })), (row) => row.amount, 'purchases');
  return { view, data: periods, totals, scope: { interval: query.get('interval') ?? 'month', source: 'posted_purchases' } };
}

// تقارير العملاء في وضع العرض: عقود مطابقة للـ API، لا استجابة افتراضية فارغة.
function customersReportFor(path: string) {
  const query = new URLSearchParams(path.split('?')[1] ?? '');
  const view = query.get('view') ?? 'sales';
  const customer = query.get('customer_id') ?? 'p-customer-1';
  const customers = [
    { key: customer, label: 'شركة الروّاد', invoices: 7, amount: '38250.00', balance: '9450.00' },
    { key: 'p-customer-2', label: 'مؤسسة المدى', invoices: 4, amount: '17400.00', balance: '2200.00' },
  ];

  if (view === 'balances') {
    return {
      view,
      data: customers,
      totals: { invoices: 11, amount: '55650.00', balance: '11650.00' },
      scope: { interval: query.get('interval') ?? 'month', source: 'posted_customer_invoices' },
    };
  }
  if (view === 'payments') {
    return {
      view,
      data: [
        { key: '2026-05', label: '2026-05', receipts: 5, amount: '14800.00' },
        { key: '2026-06', label: '2026-06', receipts: 8, amount: '21400.00' },
      ],
      totals: { receipts: 13, amount: '36200.00' },
      scope: { interval: query.get('interval') ?? 'month', source: 'posted_customer_receipts' },
    };
  }
  if (view === 'appointments') {
    return {
      view,
      data: [
        { key: customer, label: 'شركة الروّاد', appointments: 4, scheduled: 2, done: 1, cancelled: 1 },
        { key: 'p-customer-2', label: 'مؤسسة المدى', appointments: 3, scheduled: 1, done: 2, cancelled: 0 },
      ],
      totals: { appointments: 7, scheduled: 3, done: 3, cancelled: 1 },
      scope: { interval: query.get('interval') ?? 'month', source: 'customer_appointments' },
    };
  }

  return {
    view: 'sales',
    data: customers,
    totals: { invoices: 11, amount: '55650.00', net_sales: '48391.30', tax: '7258.70' },
    scope: { interval: query.get('interval') ?? 'month', source: 'posted_customer_invoices' },
  };
}

// تقارير المخزون في وضع العرض: نفس العقود الصادقة لمسارات API الحية.
function inventoryReportFor(path: string) {
  const query = new URLSearchParams(path.split('?')[1] ?? '');
  const view = query.get('view') ?? 'value';
  const snapshot = (source: string) => ({ source, snapshot: true });
  const history = (source: string) => ({ source, snapshot: false });

  if (view === 'warehouses') {
    return {
      view,
      data: [
        { key: 'pr2', warehouse_id: 'wh1', warehouse: 'المخزن الرئيسي', branch: 'الفرع الرئيسي', sku: 'SKU-002', label: 'جهاز قياس رقمي', unit: 'piece', quantity: 22 },
        { key: 'pr3', warehouse_id: 'wh2', warehouse: 'مخزن الخبر', branch: 'فرع الخبر', sku: 'SKU-003', label: 'كرتون ورق A4', unit: 'carton', quantity: 130 },
      ],
      totals: { items: 2, warehouses: 2, quantity: 152 },
      scope: snapshot('warehouse_stock_quantities'),
    };
  }
  if (view === 'movements') {
    return {
      view,
      data: [
        { key: 'mv2', date: '2026-06-24', type: 'out', sku: 'SKU-002', label: 'جهاز قياس رقمي', unit: 'piece', warehouse: 'المخزن الرئيسي', branch: 'الفرع الرئيسي', quantity: 3, unit_cost: '760.00', total_cost: '2280.00', balance_quantity: 22, notes: 'بيع عبر فاتورة INV-2026-0118' },
        { key: 'mv1', date: '2026-06-20', type: 'in', sku: 'SKU-002', label: 'جهاز قياس رقمي', unit: 'piece', warehouse: 'المخزن الرئيسي', branch: 'الفرع الرئيسي', quantity: 25, unit_cost: '760.00', total_cost: '19000.00', balance_quantity: 25, notes: 'استلام مخزون مرحّل' },
      ],
      totals: { movements: 2, in_quantity: 25, out_quantity: 3, in_cost: '19000.00', out_cost: '2280.00', total_cost: '21280.00' },
      scope: history('posted_stock_movements'),
    };
  }
  if (view === 'operations') {
    return {
      view,
      data: [
        { key: 'op2', number: 'ST-2026-00012', date: '2026-06-24', type: 'transfer', warehouse: 'المخزن الرئيسي', target_warehouse: 'مخزن الخبر', branch: 'الفرع الرئيسي', target_branch: 'فرع الخبر', lines: 1, quantity: 3, total_cost: '2280.00' },
        { key: 'op1', number: 'SR-2026-00008', date: '2026-06-20', type: 'receipt', warehouse: 'المخزن الرئيسي', target_warehouse: null, branch: 'الفرع الرئيسي', target_branch: null, lines: 2, quantity: 31, total_cost: '21850.00' },
      ],
      totals: { operations: 2, lines: 3, quantity: 34, total_cost: '24130.00' },
      scope: history('posted_stock_permits'),
    };
  }
  if (view === 'stocktakes') {
    return {
      view,
      data: [
        { key: 'stk1', number: 'STK-2026-00004', date: '2026-06-18', warehouse: 'المخزن الرئيسي', branch: 'الفرع الرئيسي', counted_lines: 4, quantity_difference: -2, difference_value: '-1520.00' },
      ],
      totals: { stocktakes: 1, counted_lines: 4, quantity_difference: -2, difference_value: '-1520.00' },
      scope: history('posted_stocktakes'),
    };
  }

  return {
    view: 'value',
    data: [
      { key: 'pr2', sku: 'SKU-002', label: 'جهاز قياس رقمي', unit: 'piece', quantity: 22, reorder_level: 10, avg_cost: '760.00', stock_value: '16720.00' },
      { key: 'pr3', sku: 'SKU-003', label: 'كرتون ورق A4', unit: 'carton', quantity: 130, reorder_level: 10, avg_cost: '58.00', stock_value: '7540.00' },
    ],
    totals: { products: 2, quantity: 152, stock_value: '24260.00' },
    scope: snapshot('current_tracked_products'),
  };
}

export const mockShifts = [
  { id: 'sh1', branch_id: null, name: 'الوردية الصباحية', start_time: '08:00', end_time: '16:00', break_minutes: 30, work_days: [0, 1, 2, 3, 4], net_minutes: 450, is_active: true },
  { id: 'sh2', branch_id: null, name: 'الوردية المسائية', start_time: '14:00', end_time: '22:00', break_minutes: 30, work_days: [0, 1, 2, 3], net_minutes: 450, is_active: true },
  { id: 'sh3', branch_id: null, name: 'وردية المستودع', start_time: '07:00', end_time: '15:00', break_minutes: 0, work_days: [1, 2, 3, 4, 5], net_minutes: 480, is_active: true },
];

const att = (
  id: string, emp: { id: string; name: string }, date: string,
  checkIn: string | null, checkOut: string | null,
  status: 'present' | 'absent' | 'late' | 'leave',
  shift: { id: string; name: string } | null = null, notes: string | null = null,
) => {
  const toMin = (v: string) => { const [h, m] = v.split(':').map(Number); return (h || 0) * 60 + (m || 0); };
  let worked = 0;
  if (checkIn && checkOut) { worked = toMin(checkOut) - toMin(checkIn); if (worked < 0) worked += 24 * 60; }
  return {
    id, employee_id: emp.id, employee: emp, shift_id: shift?.id ?? null, shift,
    attendance_date: date, check_in: checkIn, check_out: checkOut, status, worked_minutes: worked, notes,
  };
};

const morning = { id: 'sh1', name: 'الوردية الصباحية' };
export const mockAttendance = [
  att('at1', { id: 'em-1', name: 'أحمد العتيبي' }, '2026-08-18', '08:00', '16:30', 'present', morning),
  att('at2', { id: 'em-2', name: 'سارة القحطاني' }, '2026-08-18', '08:45', '16:30', 'late', morning, 'تأخّر ٤٥ دقيقة'),
  att('at3', { id: 'em-3', name: 'خالد الدوسري' }, '2026-08-18', '07:00', '15:00', 'present', { id: 'sh3', name: 'وردية المستودع' }),
  att('at4', { id: 'em-4', name: 'منى الشمري' }, '2026-08-18', null, null, 'leave', null, 'إجازة سنوية'),
  att('at5', { id: 'em-5', name: 'فهد المطيري' }, '2026-08-18', null, null, 'absent'),
];

// كتالوج الصلاحيات القابلة للإسناد — نظير App\Support\Rbac::PERMISSIONS.
export const mockPermissionCatalogue = [
  'partners.view', 'partners.manage', 'products.view', 'products.manage',
  'invoices.view', 'invoices.manage', 'payments.view', 'payments.manage',
  'purchases.view', 'purchases.manage', 'returns.view', 'returns.manage',
  'hr.view', 'hr.manage', 'expenses.view', 'expenses.manage',
  'assets.view', 'assets.manage', 'cost_centers.view', 'cost_centers.manage',
  'accounts.view', 'accounts.manage', 'branches.view', 'branches.manage',
  'company.manage', 'users.view', 'users.manage', 'roles.view', 'roles.manage',
  'reports.view', 'zatca.view',
];

export const mockRoles = [
  { id: 'ro-owner', slug: 'owner', name: 'المالك', permissions: ['*'], is_system: true, is_owner: true, users_count: 1 },
  { id: 'ro-admin', slug: 'admin', name: 'مدير', permissions: ['*'], is_system: true, is_owner: false, users_count: 1 },
  { id: 'ro-acc', slug: 'accountant', name: 'محاسب', permissions: [
    'partners.view', 'partners.manage', 'invoices.view', 'invoices.manage',
    'payments.view', 'payments.manage', 'reports.view', 'accounts.view',
  ], is_system: true, is_owner: false, users_count: 2 },
  { id: 'ro-staff', slug: 'staff', name: 'موظف', permissions: [
    'partners.view', 'products.view', 'invoices.view', 'reports.view',
  ], is_system: true, is_owner: false, users_count: 3 },
  { id: 'ro-cashier', slug: 'role-cashier', name: 'كاشير الفرع', permissions: [
    'invoices.view', 'invoices.manage', 'payments.view', 'payments.manage',
  ], is_system: false, is_owner: false, users_count: 1 },
];

// ── موجّه الطلبات الوهمي ───────────────────────────────────────────────────
// يحاكي عقد الـ REST API: يعيد نفس الأشكال التي تتوقّعها الشاشات. المسارات غير
// المعرّفة تُعيد قائمة فارغة { data: [] } لتظهر الشاشة حالة فارغة نظيفة.

type MockPrintTemplateRevision = {
  id: string;
  version: number;
  status: 'draft' | 'published' | 'superseded';
  document_types: string[];
  definition: Record<string, unknown>;
  created_at: string;
  published_at?: string | null;
};

type MockPrintTemplate = {
  id: string;
  name: string;
  status: 'draft' | 'published' | 'archived';
  source: 'custom';
  document_types: string[];
  draft_revision: MockPrintTemplateRevision | null;
  published_revision: MockPrintTemplateRevision | null;
  revisions: MockPrintTemplateRevision[];
};

type MockPrintTemplateAssignment = {
  id: string;
  branch_id: string | null;
  document_type: string;
  usage: 'print' | 'pdf' | 'thermal';
  print_template_revision_id: string;
  created_at: string;
  updated_at: string;
};

const mockPrintTemplates: MockPrintTemplate[] = [];
const mockPrintTemplateAssignments: MockPrintTemplateAssignment[] = [];

function mockRevisionForAssignment(revisionId: string): MockPrintTemplateRevision | null {
  return mockPrintTemplates
    .flatMap((template) => template.revisions)
    .find((revision) => revision.id === revisionId) ?? null;
}

function mockAssignmentResource(assignment: MockPrintTemplateAssignment) {
  const revision = mockRevisionForAssignment(assignment.print_template_revision_id);
  return {
    ...assignment,
    scope: assignment.branch_id === null ? 'company' as const : 'branch' as const,
    revision,
  };
}

function createMockPrintTemplate(input: { name?: string; document_types?: unknown; definition?: unknown }): MockPrintTemplate {
  const documentTypes = Array.isArray(input.document_types) && input.document_types.length
    ? input.document_types.map(String)
    : ['tax_invoice'];
  const revision = {
    id: `demo-template-r${mockPrintTemplates.length + 1}`,
    version: 1,
    status: 'draft' as const,
    document_types: documentTypes,
    definition: (input.definition && typeof input.definition === 'object' ? input.definition : {}) as Record<string, unknown>,
    created_at: new Date().toISOString(),
  };
  return {
    id: `demo-template-${mockPrintTemplates.length + 1}`,
    name: input.name?.trim() || 'قالب معاينة جديد',
    status: 'draft',
    source: 'custom',
    document_types: documentTypes,
    draft_revision: revision,
    published_revision: null,
    revisions: [revision],
  };
}

/**
 * ─────────────────────────── إدارة التطبيقات ───────────────────────────
 * عيّنة تمثيلية من كتالوج `App\Support\ApplicationCatalog` بمفاتيحه الحقيقية،
 * تغطّي كل حالة تعرضها الشاشة: إلزامية، مفعّلة، معطّلة، معلّقة (قراءة فقط)،
 * «قريباً»، وصولٌ ممنوع، واعتماديةٌ ناقصة — ومعها أنواع الإتاحة التجارية.
 *
 * بياناتٌ للمعاينة فقط: لا تصف قرار مستأجرٍ حقيقي، ولا تُستشار خارج وضع المعاينة.
 */
type MockApplication = {
  group: string;
  maturity: 'built' | 'coming_soon' | 'retired';
  mandatory: boolean;
  dependencies: string[];
  enabled: boolean;
  status: 'enabled' | 'disabled' | 'suspended';
  changed_by: string | null;
  changed_at: string | null;
  reason: string | null;
  commercial: { availability: 'included' | 'addon' | 'trial' | 'not_available'; source_count: number };
  effective_access: 'full' | 'read_only' | 'denied';
  dependency_status: 'satisfied' | 'missing' | 'not_applicable';
};

function mockApplication(
  group: string,
  overrides: Partial<MockApplication> = {}
): MockApplication {
  return {
    group,
    maturity: 'built',
    mandatory: false,
    dependencies: [],
    enabled: true,
    status: 'enabled',
    changed_by: null,
    changed_at: null,
    reason: null,
    commercial: { availability: 'included', source_count: 1 },
    effective_access: 'full',
    dependency_status: 'not_applicable',
    ...overrides,
  };
}

const mockApplications: Record<string, MockApplication> = {
  'sales.invoicing': mockApplication('sales', { mandatory: true }),
  'sales.pos': mockApplication('pos', { dependencies: ['sales.invoicing'], dependency_status: 'satisfied' }),
  'sales.promotions': mockApplication('sales', {
    maturity: 'coming_soon', enabled: false, status: 'disabled',
    dependencies: ['sales.invoicing'], dependency_status: 'satisfied',
    commercial: { availability: 'not_available', source_count: 0 }, effective_access: 'denied',
  }),
  'compliance.zatca': mockApplication('settings', {
    dependencies: ['sales.invoicing', 'accounting.ledger'], dependency_status: 'satisfied',
  }),
  'crm.customers': mockApplication('customers', { mandatory: true }),
  'crm.follow_up': mockApplication('customers', {
    dependencies: ['crm.customers'], dependency_status: 'satisfied',
    commercial: { availability: 'trial', source_count: 1 },
  }),
  'crm.loyalty': mockApplication('customers', {
    maturity: 'coming_soon', enabled: false, status: 'disabled',
    dependencies: ['crm.customers', 'sales.invoicing'], dependency_status: 'satisfied',
    commercial: { availability: 'not_available', source_count: 0 }, effective_access: 'denied',
  }),
  'inventory.core': mockApplication('inventory', {
    enabled: false, status: 'suspended', effective_access: 'read_only',
    reason: 'توجد حركات مخزنية مرحّلة، فالقدرة للقراءة فقط.',
    commercial: { availability: 'addon', source_count: 1 },
  }),
  'purchases.cycle': mockApplication('purchases', {
    enabled: false, status: 'disabled',
    dependencies: ['accounting.ledger'], dependency_status: 'satisfied',
    commercial: { availability: 'addon', source_count: 1 },
  }),
  'accounting.ledger': mockApplication('accounting', { mandatory: true }),
  'finance.operations': mockApplication('finance', { commercial: { availability: 'addon', source_count: 2 } }),
  'hr.employees': mockApplication('hr', { commercial: { availability: 'addon', source_count: 1 } }),
  'hr.payroll': mockApplication('hr', {
    enabled: false, status: 'disabled',
    dependencies: ['hr.employees'], dependency_status: 'satisfied',
    commercial: { availability: 'trial', source_count: 1 },
  }),
  'operations.work_orders': mockApplication('operations', {
    maturity: 'coming_soon', enabled: false, status: 'disabled',
    commercial: { availability: 'not_available', source_count: 0 }, effective_access: 'denied',
  }),
  'logistics.fleet': mockApplication('logistics', {
    maturity: 'coming_soon', enabled: false, status: 'disabled',
    commercial: { availability: 'not_available', source_count: 0 }, effective_access: 'denied',
  }),
  'fuel_stations.core': mockApplication('fuel_stations', { commercial: { availability: 'addon', source_count: 2 } }),
  'fuel_stations.forecourt': mockApplication('fuel_stations', {
    enabled: false, status: 'disabled',
    dependencies: ['fuel_stations.core'], dependency_status: 'missing',
    commercial: { availability: 'addon', source_count: 1 },
  }),
};

/** ─────────────────────────── محطات الوقود ─────────────────────────── */
const mockFuelStations = [
  { id: 'fs-1', branch_id: null, code: 'ST-001', name: 'محطة نبراس الطموح — طريق الملك فهد', status: 'active', timezone: 'Asia/Riyadh', operating_day_starts_at: '06:00' },
  { id: 'fs-2', branch_id: null, code: 'ST-002', name: 'محطة الجبيل الصناعية الثانية', status: 'maintenance', timezone: 'Asia/Riyadh', operating_day_starts_at: '06:00' },
  { id: 'fs-3', branch_id: null, code: 'ST-003', name: 'محطة الظهران الجنوبية', status: 'inactive', timezone: 'Asia/Riyadh', operating_day_starts_at: '06:00' },
];

const mockFuelDashboard = {
  sales_today_minor: 128455075,
  liters_today_milliliters: 84250000,
  gross_margin_minor: 18422050,
  open_shifts: 4,
  open_work_orders: 2,
  active_alerts: 1,
  degraded_devices: 3,
  data_boundary: 'branch',
};

const mockFuelDevices = [
  { id: 'fd-1', fuel_station_id: 'fs-1', health: 'degraded', sync_status: 'ok', last_seen_at: '2026-08-25T06:00:00Z' },
  { id: 'fd-2', fuel_station_id: 'fs-1', health: 'healthy', sync_status: 'ok', last_seen_at: '2026-08-25T06:05:00Z' },
  { id: 'fd-3', fuel_station_id: 'fs-2', health: 'healthy', sync_status: 'ok', last_seen_at: '2026-08-25T05:40:00Z' },
];

const mockFuelShifts = [
  { id: 'fsh-1', fuel_station_id: 'fs-1', opened_at: '2026-08-25T05:00:00Z', status: 'open' },
  { id: 'fsh-2', fuel_station_id: 'fs-2', opened_at: '2026-08-24T05:00:00Z', status: 'closed' },
];

export function mockApi<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const reviewResponse = handleDocumentReviewDemo(path, method.toUpperCase(), body);
  if (reviewResponse.handled) {
    return 'error' in reviewResponse
      ? Promise.reject(reviewResponse.error)
      : resolve(reviewResponse.response as T);
  }

  const clean = path.split('?')[0];
  const m = method.toUpperCase();
  const deliveryMatch = clean.match(/^\/delivery-notes\/([^/]+)$/);
  const deliveryActionMatch = clean.match(/^\/delivery-notes\/([^/]+)\/(confirm|cancel)$/);

  // Fixture سندات التسليم: محلي للواجهة فقط، ولا يكتب فاتورة أو مخزوناً أو دفتراً.
  if (clean === '/number-preview') {
    const entity = new URLSearchParams(path.split('?')[1] ?? '').get('entity');
    if (entity === 'delivery_note') {
      const suffix = String(mockDeliveryNotes.length + 101).padStart(5, '0');
      return resolve({ data: { key: 'delivery_note', series_key: 'default', number: `DN-2026-${suffix}` } } as T);
    }
  }
  if (clean === '/delivery-notes' && m === 'GET') {
    const params = new URLSearchParams(path.split('?')[1] ?? '');
    const search = (params.get('search') ?? '').toLowerCase();
    const filtered = mockDeliveryNotes.filter((note) => {
      const status = params.get('status');
      const customer = params.get('customer_id');
      const warehouse = params.get('warehouse_id');
      const dateFrom = params.get('date_from');
      const dateTo = params.get('date_to');
      return (!status || note.status === status)
        && (!customer || note.customer_id === customer)
        && (!warehouse || note.warehouse_id === warehouse)
        && (!dateFrom || note.delivery_date >= dateFrom)
        && (!dateTo || note.delivery_date <= dateTo)
        && (!search || [note.number, note.external_reference ?? '', note.customer.name].some((value) => value.toLowerCase().includes(search)));
    });
    return resolve({ data: filtered, meta: { current_page: 1, last_page: 1, total: filtered.length } } as T);
  }
  if (deliveryMatch && m === 'GET') {
    return resolve({ data: mockDeliveryNotes.find((note) => note.id === deliveryMatch[1]) ?? mockDeliveryNotes[0] } as T);
  }
  if (clean === '/delivery-notes' && m === 'POST') {
    const input = (body ?? {}) as { customer_id?: string; warehouse_id?: string; delivery_date?: string; external_reference?: string | null; notes?: string | null; items?: Array<{ product_id?: string; unit?: string | null; quantity?: number; description?: string | null }> };
    const customer = mockPartners.find((partner) => partner.id === input.customer_id) ?? mockPartners[0];
    const warehouse = mockWarehouses.find((item) => item.id === input.warehouse_id) ?? mockWarehouses[0];
    const now = new Date().toISOString();
    const id = `dn-demo-${Date.now()}`;
    const note: MockDeliveryNote = {
      id, branch_id: warehouse.branch_id ?? 'br-1', number: `DN-2026-${String(mockDeliveryNotes.length + 101).padStart(5, '0')}`,
      status: 'draft', version: 1, external_reference: input.external_reference ?? null, delivery_date: input.delivery_date ?? '2026-08-26', notes: input.notes ?? null,
      customer_id: customer.id, warehouse_id: warehouse.id, customer: { id: customer.id, name: customer.name, type: customer.type }, warehouse: { id: warehouse.id, name: warehouse.name, code: warehouse.code ?? null },
      lines: (input.items ?? []).map((item, index) => {
        const product = allMockProducts().find((candidate) => candidate.id === item.product_id) ?? allMockProducts()[0];
        return { id: `${id}-line-${index + 1}`, line_number: index + 1, product_id: product.id, product_name: product.name, product_sku: product.sku ?? null, product_barcode: product.barcode ?? null, unit_name: item.unit || product.unit || 'piece', unit_factor: 1, quantity: Number(item.quantity) || 1, quantity_numerator: null, quantity_denominator: null, description: item.description ?? null };
      }),
      events: [{ id: `${id}-event-1`, event: 'created', from_status: null, to_status: 'draft', actor_id: 'demo-user', actor_name: 'مستخدم المعاينة', reason: null, metadata: { line_count: (input.items ?? []).length }, occurred_at: now }],
      confirmed_at: null, cancelled_at: null, cancellation_reason: null, created_by: 'demo-user', confirmed_by: null, cancelled_by: null,
    };
    mockDeliveryNotes.unshift(note);
    return resolve({ data: note } as T);
  }
  if (deliveryMatch && m === 'PUT') {
    const note = mockDeliveryNotes.find((item) => item.id === deliveryMatch[1]);
    if (!note) return resolve({ data: mockDeliveryNotes[0] } as T);
    const input = (body ?? {}) as { delivery_date?: string; external_reference?: string | null; notes?: string | null; customer_id?: string; warehouse_id?: string; items?: Array<{ product_id?: string; unit?: string | null; quantity?: number; description?: string | null }> };
    note.delivery_date = input.delivery_date ?? note.delivery_date;
    note.external_reference = input.external_reference ?? null;
    note.notes = input.notes ?? null;
    note.version += 1;
    if (input.customer_id) { const customer = mockPartners.find((partner) => partner.id === input.customer_id); if (customer) { note.customer_id = customer.id; note.customer = { id: customer.id, name: customer.name, type: customer.type }; } }
    if (input.warehouse_id) { const warehouse = mockWarehouses.find((item) => item.id === input.warehouse_id); if (warehouse) { note.warehouse_id = warehouse.id; note.warehouse = { id: warehouse.id, name: warehouse.name, code: warehouse.code ?? null }; } }
    if (input.items) note.lines = input.items.map((item, index) => { const product = allMockProducts().find((candidate) => candidate.id === item.product_id) ?? allMockProducts()[0]; return { id: `${note.id}-line-${index + 1}`, line_number: index + 1, product_id: product.id, product_name: product.name, product_sku: product.sku ?? null, product_barcode: product.barcode ?? null, unit_name: item.unit || product.unit || 'piece', unit_factor: 1, quantity: Number(item.quantity) || 1, quantity_numerator: null, quantity_denominator: null, description: item.description ?? null }; });
    note.events.push({ id: `${note.id}-event-${note.events.length + 1}`, event: 'updated', from_status: 'draft', to_status: 'draft', actor_id: 'demo-user', actor_name: 'مستخدم المعاينة', reason: null, metadata: { line_count: note.lines.length }, occurred_at: new Date().toISOString() });
    return resolve({ data: note } as T);
  }
  if (deliveryActionMatch && m === 'POST') {
    const note = mockDeliveryNotes.find((item) => item.id === deliveryActionMatch[1]);
    if (!note) return resolve({ data: mockDeliveryNotes[0] } as T);
    const now = new Date().toISOString();
    if (deliveryActionMatch[2] === 'confirm') {
      note.status = 'confirmed'; note.version += 1; note.confirmed_at = now; note.confirmed_by = 'demo-user';
      note.events.push({ id: `${note.id}-event-${note.events.length + 1}`, event: 'confirmed', from_status: 'draft', to_status: 'confirmed', actor_id: 'demo-user', actor_name: 'مستخدم المعاينة', reason: null, metadata: null, occurred_at: now });
    } else {
      const reason = ((body ?? {}) as { reason?: string }).reason ?? 'Fixture cancellation';
      note.status = 'cancelled'; note.version += 1; note.cancelled_at = now; note.cancelled_by = 'demo-user'; note.cancellation_reason = reason;
      note.events.push({ id: `${note.id}-event-${note.events.length + 1}`, event: 'cancelled', from_status: 'draft', to_status: 'cancelled', actor_id: 'demo-user', actor_name: 'مستخدم المعاينة', reason, metadata: null, occurred_at: now });
    }
    return resolve({ data: note } as T);
  }

  // الطفرات (إنشاء/تعديل/حذف/ترحيل) — نجاح صوري دون أي أثر فعلي.
  if (m !== 'GET') {
    if (clean === '/logout') return resolve(null);
    if (clean === '/products' && m === 'POST') {
      const created = productFromDemoInput(body);
      saveDemoProduct(created);
      return resolve({ data: created });
    }
    const productMediaCollection = clean.match(/^\/products\/([^/]+)\/media$/);
    if (productMediaCollection && m === 'POST') {
      const files = body instanceof FormData
        ? [...body.getAll('media[]'), ...body.getAll('media')].filter((item): item is File => typeof item !== 'string')
        : [];
      const current = listDemoProductMedia(productMediaCollection[1]);
      if (current.length + files.length > 8) return Promise.reject(new Error('الحد الأقصى لوسائط المنتج هو 8 صور.'));
      return saveDemoProductMedia(productMediaCollection[1], files).then((data) => ({ data }) as T);
    }
    const productMediaItem = clean.match(/^\/products\/([^/]+)\/media\/([^/]+)$/);
    if (productMediaItem && m === 'DELETE') {
      return deleteDemoProductMedia(productMediaItem[1], productMediaItem[2]).then(() => ({ message: 'تم حذف الوسيط.' }) as T);
    }
    const purchaseAttachmentCollection = clean.match(/^\/purchases\/([^/]+)\/attachments$/);
    if (purchaseAttachmentCollection && m === 'POST') {
      const purchaseId = purchaseAttachmentCollection[1];
      const store = (globalThis as typeof globalThis & { __nebraxPurchaseAttachments?: Record<string, Array<{ id: string; original_name: string; mime_type: string | null; size: number; created_at: string }>> }).__nebraxPurchaseAttachments ?? {};
      (globalThis as typeof globalThis & { __nebraxPurchaseAttachments?: typeof store }).__nebraxPurchaseAttachments = store;
      const form = typeof FormData !== 'undefined' && body instanceof FormData ? body : null;
      const files = form ? form.getAll('attachments[]').filter((item): item is File => typeof File !== 'undefined' && item instanceof File) : [];
      const created = files.map((file, index) => ({
        id: `demo-purchase-attachment-${Date.now()}-${index}`,
        original_name: file.name,
        mime_type: file.type || null,
        size: file.size,
        created_at: new Date().toISOString(),
      }));
      store[purchaseId] = [...(store[purchaseId] ?? []), ...created];
      return resolve({ data: store[purchaseId] });
    }
    const purchaseAttachmentDelete = clean.match(/^\/purchases\/([^/]+)\/attachments\/([^/]+)$/);
    if (purchaseAttachmentDelete && m === 'DELETE') {
      const purchaseId = purchaseAttachmentDelete[1];
      const attachmentId = purchaseAttachmentDelete[2];
      const state = globalThis as typeof globalThis & { __nebraxPurchaseAttachments?: Record<string, Array<{ id: string }>> };
      state.__nebraxPurchaseAttachments ??= {};
      state.__nebraxPurchaseAttachments[purchaseId] = (state.__nebraxPurchaseAttachments[purchaseId] ?? []).filter((attachment) => attachment.id !== attachmentId);
      return resolve({ message: 'deleted' });
    }
    if (clean === '/print-templates') {
      const template = createMockPrintTemplate((body ?? {}) as { name?: string; document_types?: unknown; definition?: unknown });
      mockPrintTemplates.unshift(template);
      return resolve({ data: template });
    }
    const duplicateTemplate = clean.match(/^\/print-templates\/([^/]+)\/duplicate$/);
    if (duplicateTemplate) {
      const source = mockPrintTemplates.find((template) => template.id === duplicateTemplate[1]);
      const template = createMockPrintTemplate({
        name: ((body ?? {}) as { name?: string }).name,
        document_types: source?.document_types,
        definition: source?.draft_revision?.definition ?? source?.published_revision?.definition,
      });
      mockPrintTemplates.unshift(template);
      return resolve({ data: template });
    }
    const draftTemplate = clean.match(/^\/print-templates\/([^/]+)\/draft$/);
    if (draftTemplate) {
      const index = mockPrintTemplates.findIndex((template) => template.id === draftTemplate[1]);
      if (index < 0) return resolve({ data: null });
      const current = mockPrintTemplates[index];
      const input = (body ?? {}) as { name?: string; document_types?: unknown; definition?: unknown };
      const revision: MockPrintTemplateRevision = {
        id: `${current.id}-r${current.revisions.length + 1}`,
        version: current.revisions.length + 1,
        status: 'draft',
        document_types: Array.isArray(input.document_types) && input.document_types.length
          ? input.document_types.map(String)
          : current.document_types,
        definition: (input.definition && typeof input.definition === 'object'
          ? input.definition
          : current.draft_revision?.definition ?? current.published_revision?.definition ?? {}) as Record<string, unknown>,
        created_at: new Date().toISOString(),
      };
      const template: MockPrintTemplate = {
        ...current,
        name: input.name?.trim() || current.name,
        status: 'draft',
        document_types: revision.document_types,
        draft_revision: revision,
        revisions: [...current.revisions, revision],
      };
      mockPrintTemplates[index] = template;
      return resolve({ data: template });
    }
    const publishTemplate = clean.match(/^\/print-templates\/([^/]+)\/publish$/);
    if (publishTemplate) {
      const index = mockPrintTemplates.findIndex((template) => template.id === publishTemplate[1]);
      if (index < 0) return resolve({ data: null });
      const current = mockPrintTemplates[index];
      const draft = current.draft_revision ?? current.published_revision;
      if (!draft) return resolve({ data: current });
      const now = new Date().toISOString();
      const revision: MockPrintTemplateRevision = { ...draft, status: 'published', published_at: now };
      const template: MockPrintTemplate = {
        ...current,
        status: 'published',
        draft_revision: null,
        published_revision: revision,
        revisions: current.revisions.map((item) => item.id === revision.id ? revision : item),
      };
      mockPrintTemplates[index] = template;
      return resolve({ data: template });
    }
    if (clean === '/print-templates/assignments/default') {
      const input = (body ?? {}) as {
        branch_id?: string | null;
        document_type?: string;
        usage?: 'print' | 'pdf' | 'thermal';
        print_template_revision_id?: string;
      };
      const revisionId = input.print_template_revision_id ?? '';
      const revision = mockRevisionForAssignment(revisionId);
      const documentType = input.document_type ?? '';
      const usage = input.usage ?? 'print';
      if (!revision || revision.status !== 'published' || !revision.document_types.includes(documentType)) {
        return resolve({ data: null });
      }
      const branchId = input.branch_id ?? null;
      const now = new Date().toISOString();
      const index = mockPrintTemplateAssignments.findIndex((assignment) => (
        assignment.branch_id === branchId
        && assignment.document_type === documentType
        && assignment.usage === usage
      ));
      const assignment: MockPrintTemplateAssignment = index >= 0
        ? {
          ...mockPrintTemplateAssignments[index],
          print_template_revision_id: revisionId,
          updated_at: now,
        }
        : {
          id: `demo-assignment-${mockPrintTemplateAssignments.length + 1}`,
          branch_id: branchId,
          document_type: documentType,
          usage,
          print_template_revision_id: revisionId,
          created_at: now,
          updated_at: now,
        };
      if (index >= 0) mockPrintTemplateAssignments[index] = assignment;
      else mockPrintTemplateAssignments.push(assignment);
      return resolve({ data: mockAssignmentResource(assignment) });
    }
    // إنشاء فاتورة (نقطة البيع/الفواتير): نُعيد رقماً وإجمالاً محسوباً من السطور.
    if (clean === '/invoices') return resolve({ data: { id: 'demo-inv', number: 'INV-2026-0119', total: invoiceTotalFromBody(body) } });
    if (clean === '/pos/checkout') return resolve({ data: { id: 'demo-inv', number: 'INV-2026-0119', total: invoiceTotalFromBody(body), payment_status: 'paid' } });
    // إنشاء مصروف: نُعيد إجمالاً محسوباً من المبلغ والضريبة (مسودة).
    if (clean === '/expenses') {
      const b = (body ?? {}) as { amount?: number; tax_rate?: number };
      const amt = Number(b.amount ?? 0);
      const total = (amt + Math.round((amt * Number(b.tax_rate ?? 0)) / 100)) / 100;
      return resolve({ data: { id: 'demo-exp', number: 'EXP-2026-00005', status: 'draft', total: total.toFixed(2) } });
    }
    // إنشاء أصل: نُعيد إجمالاً محسوباً من التكلفة والضريبة (مسودة).
    if (clean === '/assets') {
      const b = (body ?? {}) as { cost?: number; tax_rate?: number };
      const c = Number(b.cost ?? 0);
      const total = (c + Math.round((c * Number(b.tax_rate ?? 0)) / 100)) / 100;
      return resolve({ data: { id: 'demo-asset', number: 'FA-2026-00004', status: 'draft', total: total.toFixed(2) } });
    }
    // إجراءات مسيّر الرواتب (ترحيل/صرف): نُعيد المسيّر المطابق ليُحدَّث العرض.
    const runAction = clean.match(/^\/payroll-runs\/([^/]+)\/(post|pay)$/);
    if (runAction) {
      const run = mockPayrollRuns.find((r) => r.id === runAction[1]) ?? mockPayrollRuns[0];
      return resolve({ data: run });
    }
    return resolve({ data: { id: 'demo-new' } });
  }

  if (clean === '/print-templates') return resolve({ data: mockPrintTemplates });
  if (clean === '/print-templates/assignments') {
    return resolve({ data: mockPrintTemplateAssignments.map(mockAssignmentResource) });
  }
  if (clean === '/print-templates/resolve') {
    const query = new URLSearchParams(path.split('?')[1] ?? '');
    const documentType = query.get('document_type') ?? '';
    const usage = query.get('usage') ?? 'print';
    const branchId = query.get('branch_id');
    const matches = mockPrintTemplateAssignments.filter((assignment) => (
      assignment.document_type === documentType && assignment.usage === usage
    ));
    const resolved = (branchId ? matches.find((assignment) => assignment.branch_id === branchId) : null)
      ?? matches.find((assignment) => assignment.branch_id === null)
      ?? null;
    return resolve({ data: resolved ? mockAssignmentResource(resolved) : null });
  }
  const printTemplateMatch = clean.match(/^\/print-templates\/([^/]+)$/);
  if (printTemplateMatch) {
    const template = mockPrintTemplates.find((item) => item.id === printTemplateMatch[1]);
    return resolve({ data: template ?? null });
  }
  if (clean === '/me') return resolve({ user: DEMO_USER, company: mockCompany });
  if (clean === '/applications') return resolve({ data: mockApplications });
  if (clean === '/fuel-stations/workspace') return resolve({ data: { stations: mockFuelStations } });
  if (clean === '/fuel-stations/dashboard') return resolve({ data: mockFuelDashboard });
  if (clean === '/fuel-stations/devices') return resolve({ data: mockFuelDevices });
  if (clean === '/fuel-stations/shifts') return resolve({ data: mockFuelShifts });
  if (clean === '/subscription') return resolve(mockSubscription);
  if (clean === '/sales-settings') return resolve({ data: mockSalesSettings });
  if (clean === '/customer-settings') return resolve({ data: mockCustomerSettings });
  const salesConfigMatch = clean.match(/^\/sales-config\/([^/]+)$/);
  if (salesConfigMatch) return resolve({ data: mockSalesConfig[salesConfigMatch[1]] ?? [] });
  if (clean === '/users') return resolve({ data: mockUsers });
  if (clean === '/pos/products') {
    return resolve({
      data: allMockProducts().filter((product) => product.is_active).map((product) => ({
        id: product.id,
        sku: product.sku,
        barcode: product.barcode,
        name: product.name,
        sale_price: product.sale_price,
        pos_units: [{ name: product.unit, factor: 1, price: product.sale_price }],
        pos_barcodes: product.barcode
          ? [{ code: product.barcode, unit_name: product.unit, default_quantity: 1 }]
          : [],
        pos_image: listDemoProductMedia(product.id)[0] ?? null,
        category_id: null,
        category: product.category,
        tax_rate: product.tax_rate,
        type: product.type,
        track_inventory: product.track_inventory,
        quantity_on_hand: product.quantity_on_hand,
        is_active: product.is_active,
      })),
    });
  }
  if (clean === '/products') return resolve({ data: allMockProducts() });
  const productMediaCollection = clean.match(/^\/products\/([^/]+)\/media$/);
  if (productMediaCollection) return resolve({ data: listDemoProductMedia(productMediaCollection[1]) });
  const productBarcodes = clean.match(/^\/products\/([^/]+)\/barcodes$/);
  if (productBarcodes) return resolve({ data: [] });
  const productActivity = clean.match(/^\/products\/([^/]+)\/activity$/);
  if (productActivity) return resolve({ data: [] });
  const productDetail = clean.match(/^\/products\/([^/]+)$/);
  if (productDetail) return resolve({ data: allMockProducts().find((item) => item.id === productDetail[1]) ?? null });
  if (clean === '/branches') return resolve({ data: mockBranches, main_branch_id: mockBranchSettings.main_branch_id });
  if (clean === '/warehouses') return resolve({ data: mockWarehouses });
  const whStockMatch = clean.match(/^\/warehouses\/([^/]+)\/stock$/);
  if (whStockMatch) {
    return resolve({ data: mockProducts.slice(0, 5).map((p, i) => ({
      product_id: p.id, name: p.name, sku: p.sku, quantity: [42, 18, 7, 130, 55][i] ?? 0,
    })) });
  }
  const whMatch = clean.match(/^\/warehouses\/([^/]+)$/);
  if (whMatch) {
    return resolve({ data: mockWarehouses.find((w) => w.id === whMatch[1]) ?? mockWarehouses[0] });
  }
  if (clean === '/branch-settings') return resolve({ data: mockBranchSettings });
  const branchMatch = clean.match(/^\/branches\/([^/]+)$/);
  if (branchMatch) {
    const b = mockBranches.find((x) => x.id === branchMatch[1]) ?? mockBranches[0];
    return resolve({ data: b });
  }
  if (clean === '/pos-sessions') return resolve({ data: mockPosSessions });
  if (clean === '/pos/recent-invoices') {
    return resolve({
      data: mockInvoices
        .filter((invoice) => invoice.status === 'posted')
        .slice(0, 5)
        .map((invoice) => ({
          id: invoice.id,
          number: invoice.number,
          invoice_date: invoice.invoice_date,
          created_at: `${invoice.invoice_date}T10:00:00`,
          customer_name: mockPartners.find((partner) => partner.id === invoice.partner_id)?.name ?? null,
          total: invoice.total,
          payment_status: invoice.payment_status,
          payment_methods: invoice.payment_type === 'cash' ? ['نقدي'] : [],
          status: invoice.status,
        })),
    });
  }
  const posReportMatch = clean.match(/^\/pos-sessions\/([^/]+)\/report$/);
  if (posReportMatch) {
    const s = mockPosSessions.find((x) => x.id === posReportMatch[1]) ?? mockPosSessions[0];
    return resolve({ session: s, report: { cash_sales: '3880.00', sales_count: 12, average: '323.33', expected: '4380.00' } });
  }
  if (clean === '/appointments') return resolve({ data: mockAppointments });
  if (clean === '/contacts') return resolve({ data: mockContacts });
  if (clean === '/crm-activities') return resolve({ data: mockCrmActivities });
  if (clean === '/accounts') return resolve({ data: mockAccounts });
  if (clean === '/expenses') return resolve({ data: mockExpenses });
  if (clean === '/assets') return resolve({ data: mockAssets });
  if (clean === '/cost-centers') return resolve({ data: mockCostCenters });
  if (clean === '/partners') {
    const role = new URLSearchParams(path.split('?')[1] ?? '').get('type');
    const list = role === 'customer' ? mockPartners.filter((p) => p.type === 'customer' || p.type === 'both')
      : role === 'supplier' ? mockPartners.filter((p) => p.type === 'supplier' || p.type === 'both')
      : mockPartners;
    return resolve({ data: list });
  }
  if (clean === '/invoices') return resolve({ data: mockInvoices });
  if (clean === '/quotes') return resolve({ data: mockQuotes });
  if (clean === '/credit-notes') {
    const nt = new URLSearchParams(path.split('?')[1] ?? '').get('type');
    const list = nt === 'sales' || nt === 'purchase' ? mockCreditNotes.filter((c) => c.type === nt) : mockCreditNotes;
    return resolve({ data: list });
  }
  if (clean === '/purchase-settings') return resolve({ data: mockPurchaseSettings });
  if (clean === '/stock-permits') return resolve({ data: mockStockPermits });
  if (clean === '/stocktakes') return resolve({ data: mockStocktakes });
  if (clean.startsWith('/dashboard/sales-breakdown')) {
    const by = new URLSearchParams(path.split('?')[1] ?? '').get('by') ?? 'day';
    return resolve({ dimension: by, data: mockBreakdown[by] ?? [] });
  }
  if (clean === '/revisions') return resolve({ data: mockFeed });
  if (clean === '/pos-sessions') return resolve({ data: mockSessions });
  if (clean.startsWith('/revisions/')) return resolve({ data: mockRevisions });
  if (clean === '/procurement') {
    const pt = new URLSearchParams(path.split('?')[1] ?? '').get('type');
    return resolve({ data: pt ? mockProcurement.filter((d) => d.type === pt) : mockProcurement });
  }
  if (clean === '/recurring-invoices') return resolve({ data: mockRecurring });
  const purchaseAttachmentCollection = clean.match(/^\/purchases\/([^/]+)\/attachments$/);
  if (purchaseAttachmentCollection) {
    const store = (globalThis as typeof globalThis & { __nebraxPurchaseAttachments?: Record<string, Array<{ id: string; original_name: string; mime_type: string | null; size: number; created_at: string }>> }).__nebraxPurchaseAttachments ?? {};
    (globalThis as typeof globalThis & { __nebraxPurchaseAttachments?: typeof store }).__nebraxPurchaseAttachments = store;
    return resolve({ data: store[purchaseAttachmentCollection[1]] ?? [] });
  }
  if (clean === '/purchases') return resolve({ data: mockPurchases });
  if (clean === '/returns') {
    const rtype = new URLSearchParams(path.split('?')[1] ?? '').get('type');
    const list = rtype === 'sales' || rtype === 'purchase' ? mockReturns.filter((r) => r.type === rtype) : mockReturns;
    return resolve({ data: list });
  }
  if (clean === '/payment-methods') return resolve({ data: mockPaymentMethods });
  if (clean === '/cash-bank-accounts') return resolve({ data: mockCashBankAccounts });
  if (clean === '/payments/collectors') return resolve({ data: mockEmployees.filter((employee) => employee.is_active).map(({ id, name, employee_no }) => ({ id, name, employee_no })) });
  if (clean === '/payments') {
    if ((method ?? 'GET') === 'POST') return resolve({ data: { id: 'pm-demo-draft' } });
    const dir = new URLSearchParams(path.split('?')[1] ?? '').get('direction');
    const list = dir === 'received' || dir === 'paid' ? mockPayments.filter((p) => p.direction === dir) : mockPayments;
    return resolve({ data: list });
  }
  if (clean === '/employees') return resolve({ data: mockEmployees });
  const employeeMatch = clean.match(/^\/employees\/([^/]+)$/);
  if (employeeMatch) {
    const found = mockEmployees.find((e) => e.id === employeeMatch[1]) ?? mockEmployees[0];
    return resolve({ data: found });
  }
  const contractsMatch = clean.match(/^\/employees\/([^/]+)\/contracts$/);
  if (contractsMatch) {
    const found = mockEmployees.find((e) => e.id === contractsMatch[1]) ?? mockEmployees[0];
    return resolve({
      data: [{
        id: `contract-${found.id}`, employee_id: found.id, type: 'permanent', status: 'active',
        start_date: '2025-01-01', end_date: null, probation_end_date: null,
        items: [
          { id: `item-basic-${found.id}`, category: 'basic', name: 'الراتب الأساسي', amount: found.basic_salary },
          { id: `item-allowance-${found.id}`, category: 'allowance', name: 'بدلات', amount: found.allowances },
          { id: `item-gosi-${found.id}`, category: 'gosi', name: 'التأمينات الاجتماعية (GOSI)', amount: found.gosi },
          { id: `item-other-${found.id}`, category: 'other', name: 'استقطاعات أخرى', amount: found.other_deductions },
        ],
        basic_salary: found.basic_salary, gosi: found.gosi,
        other_deductions: found.other_deductions, gross: found.gross, net: found.net,
        notes: null, created_at: '2025-01-01T00:00:00Z',
      }],
    });
  }
  if (clean === '/shifts') return resolve({ data: mockShifts });
  if (clean === '/job-titles') return resolve({ data: mockJobTitles });
  if (clean === '/departments') return resolve({ data: mockDepartments });
  if (clean === '/job-levels') return resolve({ data: mockJobLevels });
  if (clean === '/employment-types') return resolve({ data: mockEmploymentTypes });
  if (clean === '/leave-types') return resolve({ data: mockLeaveTypes });
  if (clean === '/leave-requests') {
    const params = new URLSearchParams(path.split('?')[1] ?? '');
    const status = params.get('status');
    const employeeId = params.get('employee_id');
    let list = mockLeaveRequests;
    if (status) list = list.filter((r) => r.status === status);
    if (employeeId) list = list.filter((r) => r.employee_id === employeeId);
    return resolve({ data: list });
  }
  const leaveRequestsMatch = clean.match(/^\/employees\/([^/]+)\/leave-requests$/);
  if (leaveRequestsMatch) {
    return resolve({ data: mockLeaveRequests.filter((r) => r.employee_id === leaveRequestsMatch[1]) });
  }
  const leaveBalancesMatch = clean.match(/^\/employees\/([^/]+)\/leave-balances$/);
  if (leaveBalancesMatch) {
    const employeeId = leaveBalancesMatch[1];
    return resolve({
      data: mockLeaveTypes.filter((lt) => lt.is_active).map((lt) => {
        const used = mockLeaveRequests
          .filter((r) => r.employee_id === employeeId && r.leave_type_id === lt.id && r.status === 'approved')
          .reduce((sum, r) => sum + r.days_count, 0);
        return {
          leave_type_id: lt.id, leave_type_name: lt.name, is_paid: lt.is_paid,
          entitled: lt.annual_days, used, remaining: Math.max(0, lt.annual_days - used),
        };
      }),
    });
  }
  if (clean === '/request-types') return resolve({ data: mockRequestTypes });
  if (clean === '/requests') {
    const params = new URLSearchParams(path.split('?')[1] ?? '');
    const status = params.get('status');
    const employeeId = params.get('employee_id');
    let list = mockEmployeeRequests;
    if (status) list = list.filter((r) => r.status === status);
    if (employeeId) list = list.filter((r) => r.employee_id === employeeId);
    return resolve({ data: list });
  }
  const employeeRequestsMatch = clean.match(/^\/employees\/([^/]+)\/requests$/);
  if (employeeRequestsMatch) {
    return resolve({ data: mockEmployeeRequests.filter((r) => r.employee_id === employeeRequestsMatch[1]) });
  }
  if (clean === '/attendances') {
    const params = new URLSearchParams(path.split('?')[1] ?? '');
    const date = params.get('date');
    const employeeId = params.get('employee_id');
    let list = mockAttendance;
    if (date) list = list.filter((a) => a.attendance_date === date);
    if (employeeId) list = list.filter((a) => a.employee_id === employeeId);
    return resolve({ data: list });
  }
  if (clean === '/payroll-runs') {
    const employeeId = new URLSearchParams(path.split('?')[1] ?? '').get('employee_id');
    if (employeeId) {
      const list = mockPayrollRuns
        .map((r) => ({ ...r, items: r.items.filter((it) => it.employee.id === employeeId) }))
        .filter((r) => r.items.length > 0);
      return resolve({ data: list });
    }
    return resolve({ data: mockPayrollRuns });
  }
  if (clean === '/roles') return resolve({ data: mockRoles, meta: { permissions: mockPermissionCatalogue } });

  if (clean === '/inventory') return resolve(mockInventory());
  const movementsMatch = clean.match(/^\/inventory\/([^/]+)\/movements$/);
  if (movementsMatch) return resolve(mockMovements(movementsMatch[1]));

  if (clean === '/reports/sales') return resolve(salesReportFor(path));
  if (clean === '/reports/purchases') return resolve(purchasesReportFor(path));
  if (clean === '/reports/customers') return resolve(customersReportFor(path));
  if (clean === '/reports/inventory') return resolve(inventoryReportFor(path));
  if (clean === '/reports/income-statement') return resolve(incomeStatementFor(path));
  if (clean === '/reports/balance-sheet') return resolve(mockBalanceSheet);
  if (clean === '/reports/trial-balance') return resolve(mockTrialBalance);
  if (clean === '/reports/cost-center-profitability') return resolve(mockCostCenterProfit);
  if (clean === '/reports/cash-flow') return resolve(mockCashFlow);
  if (clean === '/reports/tax-report') return resolve(mockTaxReport);
  if (clean === '/reports/journal-entries') return resolve(mockJournalEntries);
  const ledgerMatch = clean.match(/^\/reports\/account-ledger\/([^/]+)$/);
  if (ledgerMatch) return resolve(accountLedgerFor(ledgerMatch[1]));
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

  const creditNoteMatch = clean.match(/^\/credit-notes\/([^/]+)$/);
  if (creditNoteMatch) {
    const found = mockCreditNotes.find((c) => c.id === creditNoteMatch[1]) ?? mockCreditNotes[0];
    return resolve({ data: found });
  }

  const stocktakeMatch = clean.match(/^\/stocktakes\/([^/]+)$/);
  if (stocktakeMatch) {
    const found = mockStocktakes.find((s) => s.id === stocktakeMatch[1]) ?? mockStocktakes[0];
    return resolve({ data: found });
  }

  const permitMatch = clean.match(/^\/stock-permits\/([^/]+)$/);
  if (permitMatch) {
    const found = mockStockPermits.find((p) => p.id === permitMatch[1]) ?? mockStockPermits[0];
    return resolve({ data: found });
  }

  const procurementMatch = clean.match(/^\/procurement\/([^/]+)$/);
  if (procurementMatch) {
    const found = mockProcurement.find((d) => d.id === procurementMatch[1]) ?? mockProcurement[0];
    return resolve({ data: found });
  }

  const recurringMatch = clean.match(/^\/recurring-invoices\/([^/]+)$/);
  if (recurringMatch) {
    const found = mockRecurring.find((r) => r.id === recurringMatch[1]) ?? mockRecurring[0];
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

  const paymentPostMatch = clean.match(/^\/payments\/([^/]+)\/post$/);
  if (paymentPostMatch && (method ?? 'GET') === 'POST') return resolve({ data: { id: paymentPostMatch[1], status: 'posted' } });

  // تفاصيل سند القبض/الصرف: القوائم تشير إلى هذا المسار، لذلك نعيد عقداً كاملاً
  // يطابق API الإنتاج ويمنع ظهور سند فارغ في المعاينة أو التصدير.
  const paymentMatch = clean.match(/^\/payments\/([^/]+)$/);
  if (paymentMatch) {
    const found = mockPayments.find((p) => p.id === paymentMatch[1]) ?? mockPayments[0];
    const allocations = found.id === 'pm-49'
      ? [{ label: 'فاتورة شراء PUR-2026-0043', amount: '6900.00' }]
      : found.id === 'pm-50'
        ? [{ label: 'فاتورة مبيعات INV-2026-0117', amount: found.amount }]
        : [];
    return resolve({
      data: {
        ...found,
        status: 'posted',
        reference: found.method === 'bank' ? `BNK-${found.number.slice(-4)}` : null,
        notes: found.direction === 'paid' ? 'سداد مستحق للمورد' : 'تحصيل من العميل',
        allocations,
      },
    });
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
  const b = body as { items?: { quantity?: number; unit_price?: number; tax_rate?: number; discount?: number }[]; discount?: number; shipping?: number; adjustment?: number; tax_inclusive?: boolean } | undefined;
  const items = b?.items ?? [];
  const inclusive = !!b?.tax_inclusive;
  // المبلغ الخاضع لكل سطر بعد خصمه.
  const lineDiscounted = (it: { quantity?: number; unit_price?: number; discount?: number }) => {
    const gross = (it.quantity ?? 0) * (it.unit_price ?? 0);
    return gross - Math.max(0, Math.min(Number(it.discount ?? 0), gross));
  };
  // في وضع «متضمَّن» تُستخرَج الضريبة من المبلغ؛ وإلا تُضاف فوقه.
  const lineNet = (it: { quantity?: number; unit_price?: number; tax_rate?: number; discount?: number }) => {
    const d = lineDiscounted(it);
    const r = it.tax_rate ?? 0;
    return inclusive ? d - (r > 0 ? Math.round((d * r) / (100 + r)) : 0) : d;
  };
  const lineTax = (it: { quantity?: number; unit_price?: number; tax_rate?: number; discount?: number }) => {
    const d = lineDiscounted(it);
    const r = it.tax_rate ?? 0;
    return inclusive ? (r > 0 ? Math.round((d * r) / (100 + r)) : 0) : Math.round((d * r) / 100);
  };
  const subtotal = items.reduce((s, it) => s + lineNet(it), 0);
  const taxGross = items.reduce((s, it) => s + lineTax(it), 0);
  // الخصم على مستوى الفاتورة (net method) + الشحن الخاضع للضريبة — مطابق للـ backend.
  const discount = Math.max(0, Math.min(Number(b?.discount ?? 0), subtotal));
  const net = subtotal - discount;
  const goodsTax = subtotal > 0 ? Math.floor((taxGross * net) / subtotal) : 0;
  const shipping = Math.max(0, Number(b?.shipping ?? 0));
  const shippingTax = Math.round((shipping * 15) / 100);
  const adjustment = Number(b?.adjustment ?? 0);
  return ((net + shipping + goodsTax + shippingTax + adjustment) / 100).toFixed(2);
}
