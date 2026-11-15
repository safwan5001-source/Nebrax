/** TANKER-PR6B-6: مسارات واجهات تقارير الرقابة والمطابقة لسندات التعبئة (تستعملها الشاشات والتنقل). */
export const REPORTS_HREF = '/fuel-stations/tanker-fill-reports';
/** صلاحية الاطلاع الدنيا على التقارير الأربعة (الخادم هو السلطة؛ المبالغ والحسابات لها صلاحياتها المستقلة). */
export const REPORTS_PERMISSION = 'fuel.tanker.fill.inventory.view';
export const COST_PERMISSION = 'products.view_cost';
export const ACCOUNTS_PERMISSION = 'accounts.view';

export const REPORT_KEYS = ['fills', 'inventory-reconciliation', 'clearing-account', 'accounting-control'] as const;
export type ReportKey = (typeof REPORT_KEYS)[number];
export const isReportKey = (value: unknown): value is ReportKey => typeof value === 'string' && (REPORT_KEYS as readonly string[]).includes(value);

export const reportHref = (key: ReportKey) => (key === 'fills' ? REPORTS_HREF : `${REPORTS_HREF}/${key}`);
