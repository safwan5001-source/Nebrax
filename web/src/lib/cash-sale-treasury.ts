/**
 * TREASURY-T4 — خزينة البيع النقدي المباشر (`payment_type=cash`) في نموذج الفاتورة.
 *
 * المصدر الوحيد للسياسة هو `GET /sales-settings` (`cash_sale_treasury_policy_effective`): تبقى `legacy` ما دامت
 * بوابة التفعيل في الخادم مغلقة، فلا يظهر محدِّد الخزينة ولا يتغيّر ما يُرسَل. لا نخمّن الخزينة من رمز الحساب.
 */

export type CashSalePolicy = 'legacy' | 'main' | 'explicit_required';

export interface CashSaleSettings {
  effective: CashSalePolicy;
  defaultPaymentType: string;
}

export interface CashTreasuryOption {
  /** معرّف حساب الأستاذ — القيمة التي يخزّنها `invoices.cash_account_id`. */
  accountId: string;
  label: string;
}

const POLICIES: CashSalePolicy[] = ['legacy', 'main', 'explicit_required'];

/** استجابة غير متوقَّعة (مصفوفة، حقل ناقص، قيمة مجهولة) ⇒ `legacy`: الأمان أولاً. */
export function parseCashSaleSettings(data: unknown): CashSaleSettings {
  const d = (data && typeof data === 'object' && !Array.isArray(data) ? data : {}) as Record<string, unknown>;
  const eff = d.cash_sale_treasury_policy_effective;
  return {
    effective: POLICIES.includes(eff as CashSalePolicy) ? (eff as CashSalePolicy) : 'legacy',
    defaultPaymentType: typeof d.default_payment_type === 'string' ? d.default_payment_type : 'credit',
  };
}

/** نوع الدفع الذي سيحمله المستند: المحفوظ عند التعديل، وإلا تفضيل المستأجر (الشاشة لا ترسل النوع). */
export function cashSaleSelectorVisible(args: {
  settings: CashSaleSettings;
  isPaid: boolean;
  documentPaymentType?: string | null;
}): boolean {
  const { settings, isPaid, documentPaymentType } = args;
  if (settings.effective === 'legacy' || isPaid) return false;
  return (documentPaymentType ?? settings.defaultPaymentType) === 'cash';
}

/** قيمة `cash_account_id` المرسَلة: «المدفوع بالفعل» كما كان، والنقدي المباشر من المحدِّد الجديد فقط، وإلا `null`. */
export function cashAccountIdPayload(args: {
  isPaid: boolean;
  receiptAccountId: string;
  selectorVisible: boolean;
  cashSaleAccountId: string;
}): string | null {
  if (args.isPaid) return args.receiptAccountId || null;
  return args.selectorVisible ? args.cashSaleAccountId || null : null;
}

interface RawTreasury {
  account_id?: unknown;
  type?: unknown;
  name?: unknown;
  account_code?: unknown;
  is_active?: unknown;
}

/** خزائن نقدية نشطة فقط (لا بنوك) — النوع الذي يقبله الخادم للبيع النقدي. */
export function toCashTreasuryOptions(rows: unknown): CashTreasuryOption[] {
  if (!Array.isArray(rows)) return [];
  return (rows as RawTreasury[])
    .filter((r) => r && r.type === 'cash' && r.is_active !== false && typeof r.account_id === 'string')
    .map((r) => ({
      accountId: r.account_id as string,
      label: [r.name, r.account_code].filter((x) => typeof x === 'string' && x).join(' — '),
    }));
}
