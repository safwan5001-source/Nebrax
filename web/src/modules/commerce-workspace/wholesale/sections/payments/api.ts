import { api } from '@/lib/api';
import type { OnlineMethod } from '@/modules/payments/methods/contract';

/** Read-only endpoints (permission `payments.view`; partners need `partners.view`). */
export const PAYMENT_METHODS_PATH = '/payment-methods';
export const ONLINE_METHODS_PATH = '/online-payment-methods';
export const PARTNERS_PATH = '/partners';
/** Server cap for `GET /partners?per_page` and size of the credit sample. */
export const CREDIT_SAMPLE_SIZE = 100;

export type PaymentMethodRow = {
  id: string;
  name: string;
  settlementType: string;
  accountName: string | null;
  availableOnline: boolean;
  isActive: boolean;
  isDefault: boolean;
};

type RawMethod = Record<string, unknown>;

export function mapPaymentMethods(payload: unknown): PaymentMethodRow[] {
  const rows = (payload as { data?: unknown } | null)?.data;
  if (!Array.isArray(rows)) return [];
  const out: PaymentMethodRow[] = [];
  for (const raw of rows as RawMethod[]) {
    if (typeof raw?.id !== 'string' || typeof raw.name !== 'string') continue;
    out.push({
      id: raw.id,
      name: raw.name,
      settlementType: typeof raw.settlement_type === 'string' ? raw.settlement_type : '',
      accountName: typeof raw.cash_bank_account_name === 'string' ? raw.cash_bank_account_name : null,
      availableOnline: raw.available_online === true,
      isActive: raw.is_active !== false,
      isDefault: raw.is_default === true,
    });
  }
  return out;
}

export async function fetchPaymentMethods(): Promise<PaymentMethodRow[]> {
  return mapPaymentMethods(await api<unknown>(PAYMENT_METHODS_PATH));
}

export async function fetchOnlineMethods(): Promise<OnlineMethod[]> {
  const response = await api<{ data?: OnlineMethod[] }>(ONLINE_METHODS_PATH);
  return Array.isArray(response.data) ? response.data : [];
}

export type CreditPartner = {
  id: string;
  name: string;
  code: string | null;
  /** Riyal string exactly as the API returns it (`"1500.00"`), or `null` when no limit is set. */
  creditLimit: string | null;
  creditPeriod: number | null;
  isActive: boolean;
};

export type CreditSample = {
  /** Customers inspected (the most recent ones — the API has no credit filter or total). */
  inspected: number;
  /** `true` when the sample hit the API cap, so more customers may exist beyond it. */
  truncated: boolean;
  withTerms: CreditPartner[];
};

export function mapCreditSample(payload: unknown): CreditSample {
  const rows = (payload as { data?: unknown } | null)?.data;
  const list = Array.isArray(rows) ? (rows as RawMethod[]) : [];
  const withTerms: CreditPartner[] = [];
  for (const raw of list) {
    if (typeof raw?.id !== 'string' || typeof raw.name !== 'string') continue;
    const limit = raw.credit_limit === null || raw.credit_limit === undefined ? null : String(raw.credit_limit);
    const period = typeof raw.credit_period === 'number' ? raw.credit_period : null;
    if (limit === null && period === null) continue;
    withTerms.push({
      id: raw.id,
      name: raw.name,
      code: typeof raw.code === 'string' ? raw.code : null,
      creditLimit: limit,
      creditPeriod: period,
      isActive: raw.is_active !== false,
    });
  }
  withTerms.sort((a, b) => Number(b.creditLimit ?? 0) - Number(a.creditLimit ?? 0));
  return { inspected: list.length, truncated: list.length >= CREDIT_SAMPLE_SIZE, withTerms };
}

export async function fetchCreditSample(): Promise<CreditSample> {
  const query = new URLSearchParams({ type: 'customer', per_page: String(CREDIT_SAMPLE_SIZE) });
  return mapCreditSample(await api<unknown>(`${PARTNERS_PATH}?${query.toString()}`));
}
