import type { ToolName } from './contract';

/**
 * سياق الصفحة للمساعد — **بيانات وصفية معتمدة فقط** (نوع الصفحة + معرّف الكيان إن كان UUID صالحاً في مسار معروف).
 *
 * لا يُقرأ DOM ولا محتوى الصفحة ولا يُرسَل شيء منه للخادم: عقد الخادم المغلق لا يقبل حقل سياق أصلاً. يُستعمل
 * محلياً فقط لعنوان «الشاشة الحالية» ولترتيب الاقتراحات. وجوده في المتصفح لا يمنح المساعد وصولاً — كل طلب فعلي
 * يعيد التفويض كاملاً في الخادم.
 */

export type AssistantContextKind =
  | 'dashboard'
  | 'invoices'
  | 'invoice_detail'
  | 'payments'
  | 'purchases'
  | 'partners'
  | 'reports'
  | 'income_statement_report'
  | 'receivables_aging_report'
  | 'payables_aging_report'
  | 'intelligence'
  | 'other';

export interface AssistantContext {
  kind: AssistantContextKind;
  /** UUID فقط، ومن مسارات معروفة؛ للعرض المحلي. لا يُرسَل. */
  entityId: string | null;
  /** أدوات يقترحها نوع الصفحة (ترتيب فقط — لا تشغيل تلقائي). */
  suggestedTools: ToolName[];
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const ALL_TOOLS: ToolName[] = ['finance.income_statement', 'finance.receivables_aging', 'finance.payables_aging'];

export function resolveAssistantContext(pathname: string | null | undefined): AssistantContext {
  const path = (pathname ?? '').split('?')[0].replace(/\/+$/, '') || '/';
  const segments = path.split('/').filter(Boolean);
  const first = segments[0] ?? '';
  const second = segments[1] ?? '';
  const id = (value: string | undefined): string | null => (value !== undefined && UUID.test(value) ? value.toLowerCase() : null);

  if (path === '/dashboard') return { kind: 'dashboard', entityId: null, suggestedTools: ALL_TOOLS };
  if (first === 'invoices') {
    const entityId = id(second);
    return { kind: entityId ? 'invoice_detail' : 'invoices', entityId, suggestedTools: ['finance.receivables_aging'] };
  }
  if (first === 'payments') return { kind: 'payments', entityId: id(second), suggestedTools: ['finance.receivables_aging'] };
  if (first === 'purchases') return { kind: 'purchases', entityId: id(second), suggestedTools: ['finance.payables_aging'] };
  if (first === 'partners') return { kind: 'partners', entityId: id(second), suggestedTools: ['finance.receivables_aging', 'finance.payables_aging'] };
  if (path === '/reports/general/income-statement') return { kind: 'income_statement_report', entityId: null, suggestedTools: ['finance.income_statement'] };
  if (path === '/reports/customers/aging') return { kind: 'receivables_aging_report', entityId: null, suggestedTools: ['finance.receivables_aging'] };
  if (path === '/reports/purchases/aging') return { kind: 'payables_aging_report', entityId: null, suggestedTools: ['finance.payables_aging'] };
  if (first === 'reports') return { kind: 'reports', entityId: null, suggestedTools: ALL_TOOLS };
  if (first === 'intelligence') return { kind: 'intelligence', entityId: null, suggestedTools: ALL_TOOLS };

  return { kind: 'other', entityId: null, suggestedTools: ALL_TOOLS };
}
