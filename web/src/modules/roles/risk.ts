/**
 * AC-UX-03B — تصنيف حساسية الصلاحيات (عرضٌ فقط، قرار D-B).
 *
 * خريطة عرضية مفاتيحها هي المفاتيح الكنسية الحرفية من `Rbac::PERMISSIONS`. **لا تُستهلك قيمها في أي
 * قرار تخويل**: لا تمنع ولا تمنح ولا تُرسَل للخادم. مفتاح غير مصنَّف يسقط إلى صفّ عادي محايد
 * (لا يُخفى ولا يُساء إرساله). حارس الانجراف في الاختبارات يضمن ألا يبقى فيها مفتاح لم يعد موجوداً في الخادم.
 */

export type RiskKind = 'access' | 'financial' | 'data' | 'compliance';

export const RISK_KINDS: readonly RiskKind[] = ['access', 'financial', 'compliance', 'data'];

export const PERMISSION_RISK: Readonly<Record<string, RiskKind>> = {
  // يغيّر من يصل إلى النظام أو إعداداته الأمنية
  'users.manage': 'access',
  'roles.manage': 'access',
  'company.manage': 'access',
  'branches.manage': 'access',
  'customer_access.manage': 'access',
  'developer.manage': 'access',
  'apps.manage': 'access',
  'pos.audit.settings.manage': 'access',
  'documents.center.settings': 'access',

  // يحرّك مالاً أو يغيّر سجلاً مالياً أو يتجاوز ضابطاً نقدياً
  'payments.manage': 'financial',
  'supplier_refunds.manage': 'financial',
  'customer_refunds.manage': 'financial',
  'accounts.manage': 'financial',
  'accounting_settings.manage': 'financial',
  'hr.manage': 'financial',
  'sales.minimum_price_override': 'financial',
  'pos.cash_drawer.open': 'financial',
  'pos.variance.approve': 'financial',
  'pos.override.approve': 'financial',
  'fuel.shift.correct': 'financial',
  'fuel.shift.cash_variance_review': 'financial',
  'fuel.sale.collect': 'financial',
  'fuel.sale.price.manage': 'financial',

  // يمسّ الإقفال الضريبي والمحاسبي والامتثال
  'zatca.submit': 'compliance',
  'accounting_period_locks.manage': 'compliance',
  'fiscal_years.close': 'compliance',
  'fiscal_years.reopen': 'compliance',

  // يكشف أو يصدّر بياناتٍ حساسة
  'products.view_cost': 'data',
  'pos.audit.export': 'data',
  'pos.investigations.export': 'data',
  'documents.center.audit_export': 'data',
  // INT-UX-6 / PR-6a (D6): سجل تدقيق إعدادات التكامل يكشف من فعل ماذا ومتى (وأسماء الأشخاص).
  'delivery_connector.audit.view': 'data',
};

export function riskOf(key: string): RiskKind | null {
  return Object.prototype.hasOwnProperty.call(PERMISSION_RISK, key) ? PERMISSION_RISK[key] : null;
}

/** المفاتيح الحساسة ضمن مجموعة، بترتيب إدخالها. */
export function sensitiveKeys(keys: Iterable<string>): string[] {
  return [...keys].filter((key) => riskOf(key) !== null);
}

export function riskCounts(keys: Iterable<string>): Record<RiskKind, number> {
  const counts: Record<RiskKind, number> = { access: 0, financial: 0, compliance: 0, data: 0 };
  for (const key of keys) {
    const kind = riskOf(key);
    if (kind) counts[kind] += 1;
  }
  return counts;
}
