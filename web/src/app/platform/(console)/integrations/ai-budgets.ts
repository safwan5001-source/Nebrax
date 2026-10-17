/**
 * ميزانيات الذكاء الاصطناعي في منصة التشغيل (AI-07). منطق نقي بلا واجهة: تحويل الدولار ↔ micro-USD بحساب صحيح
 * على النصوص (ممنوع float في المال) وبناء حمولة التحديث.
 */

export type BudgetRow = {
  cap_tokens: number;
  used_tokens: number;
  reserved_tokens: number;
  cap_cost_micro_usd: number;
  used_cost_micro_usd: number;
  reserved_cost_micro_usd: number;
  cap_cost_usd: string;
  used_cost_usd: string;
  remaining_tokens: number;
  remaining_cost_micro_usd: number;
};

export type TenantBudgetRow = BudgetRow & { tenant_id: string; tenant_name: string | null };

export type AiBudgetOverview = {
  period: string;
  current_period: string;
  global: BudgetRow | null;
  tenants: TenantBudgetRow[];
  over_allocated: boolean;
  by_feature: { feature: string; requests: number; failed: number; tokens: number; cost_micro_usd: number; cost_usd: string }[];
  policy: { meter_document_extraction: boolean; failure_charge: string; assistant_provider: string; assistant_external_network_enabled: boolean };
  limits: { max_tokens: number; max_cost_micro_usd: number };
};

export type BudgetForm = { scope: 'global' | 'tenant'; tenantId: string; period: string; tokens: string; usd: string; password: string };

const MICRO = 1_000_000;

/** «50» أو «12.5» أو «0.000001» ← micro-USD صحيح، أو `null` إن لم يكن مبلغاً صالحاً (حتى ست خانات عشرية). */
export function usdToMicro(input: string): number | null {
  const text = input.trim();
  const match = /^(\d{1,7})(?:\.(\d{1,6}))?$/.exec(text);
  if (!match) return null;
  const micro = Number(match[1]) * MICRO + Number((match[2] ?? '').padEnd(6, '0'));

  return Number.isSafeInteger(micro) ? micro : null;
}

/** micro-USD ← نص دولار بخانتين (للعرض فقط)، تقريب لأعلى كي لا يُعرض أقل من الحقيقة. */
export function microToUsd(micro: number): string {
  const cents = Math.ceil(micro / 10_000);

  return `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
}

export function parseTokens(input: string): number | null {
  const text = input.trim();
  if (!/^\d{1,13}$/.test(text)) return null;
  const value = Number(text);

  return Number.isSafeInteger(value) ? value : null;
}

export type BudgetValidation = { ok: true; payload: Record<string, unknown> } | { ok: false; error: 'tokens' | 'usd' | 'period' | 'tenant' | 'password' | 'limits' };

export function buildBudgetPayload(form: BudgetForm, limits: { max_tokens: number; max_cost_micro_usd: number }, currentPeriod: string): BudgetValidation {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(form.period) || form.period < currentPeriod) return { ok: false, error: 'period' };
  if (form.scope === 'tenant' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(form.tenantId)) return { ok: false, error: 'tenant' };
  const tokens = parseTokens(form.tokens);
  if (tokens === null) return { ok: false, error: 'tokens' };
  const micro = usdToMicro(form.usd);
  if (micro === null) return { ok: false, error: 'usd' };
  if (tokens > limits.max_tokens || micro > limits.max_cost_micro_usd) return { ok: false, error: 'limits' };
  if (form.password === '') return { ok: false, error: 'password' };

  return {
    ok: true,
    payload: {
      scope: form.scope,
      ...(form.scope === 'tenant' ? { tenant_id: form.tenantId } : {}),
      period: form.period,
      cap_tokens: tokens,
      cap_cost_micro_usd: micro,
      current_password: form.password,
    },
  };
}

/** نسبة الاستهلاك (مستهلك + محجوز) من السقف، 0..100 للعرض. */
export function usagePercent(row: BudgetRow): number {
  if (row.cap_tokens <= 0 && row.cap_cost_micro_usd <= 0) return 100;
  const tokens = row.cap_tokens > 0 ? (row.used_tokens + row.reserved_tokens) / row.cap_tokens : 0;
  const cost = row.cap_cost_micro_usd > 0 ? (row.used_cost_micro_usd + row.reserved_cost_micro_usd) / row.cap_cost_micro_usd : 0;

  return Math.min(100, Math.round(Math.max(tokens, cost) * 100));
}
