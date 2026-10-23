/**
 * عميل رابط الدفع العام (PAY-H2-03a) — `GET /pay/v1/{token}` · `POST …/attempts` · `GET …/status` (H2-02e).
 *
 * **بلا مصادقة عمداً ولا يمرّ بـ`api()`**: لا Bearer ولا فرع ولا توجيه إلى `/login` عند 401 ولا وضع معاينة — الرمز في المسار هو القدرة الوحيدة.
 * الطلبات `credentials: 'omit'` و`cache: 'no-store'` و`referrerPolicy: 'no-referrer'`. المبالغ هللات (عدد صحيح) في العقد؛ التحويل إلى ريال للعرض فقط.
 * أخطاء الخادم تصل برمز ثابت (`error.code`) تترجمه الواجهة، لا بنصّ الخادم.
 */
import { resolveApiUrl } from './api';
import { SAUDI_RIYAL_SYMBOL } from './money';

export type PayLinkStatus = 'open' | 'completed' | 'cancelled' | 'expired' | 'unavailable';

export interface PayLinkView {
  status: PayLinkStatus;
  /** حاضرة فقط حين `status === 'open'`. */
  merchant?: string;
  invoice_number?: string;
  currency?: string;
  amount_due_minor?: number;
  allow_partial?: boolean;
  expires_at?: string | null;
}

export type PayLinkPayment = 'none' | 'pending' | 'partially_paid' | 'paid' | 'not_completed';

export interface PayLinkStatusView {
  request_status: string;
  payment: PayLinkPayment;
}

export interface PayLinkAttempt {
  capture_status: string;
  amount_minor: number;
  currency: string;
  checkout_url: string | null;
  expires_at: string | null;
}

export class PayLinkError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
  }
}

async function call<T>(token: string, suffix: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(resolveApiUrl(`pay/v1/${encodeURIComponent(token)}${suffix}`), {
      ...init,
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json', ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(init.headers as Record<string, string> | undefined) },
    });
  } catch {
    throw new PayLinkError(0, 'network');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = typeof body?.error?.code === 'string' ? body.error.code : res.status === 429 ? 'too_many_requests' : 'unknown';
    throw new PayLinkError(res.status, code);
  }
  return (body as { data: T }).data;
}

export const fetchPayLink = (token: string) => call<PayLinkView>(token, '');
export const fetchPayLinkStatus = (token: string) => call<PayLinkStatusView>(token, '/status');
export const startPayAttempt = (token: string, idempotencyKey: string, amountMinor?: number) =>
  call<PayLinkAttempt>(token, '/attempts', {
    method: 'POST',
    headers: { 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify(amountMinor === undefined ? {} : { amount_minor: amountMinor }),
  });

/** هللات → نص ريال للعرض («1150.00») بلا عائم: القسمة صحيحة والباقي منزلتان. */
export function minorToRiyalText(minor: number): string {
  const sign = minor < 0 ? '-' : '';
  const abs = Math.abs(Math.trunc(minor));
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}

/** مبلغ للعرض مع رمز العملة: الريال بالرمز الرسمي، وغيره بالرمز الثلاثي بعد الرقم. */
export function formatPayAmount(minor: number, currency: string): string {
  const text = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(minorToRiyalText(minor)));
  return currency.toUpperCase() === 'SAR' ? `${text} ${SAUDI_RIYAL_SYMBOL}` : `${text} ${currency.toUpperCase()}`;
}

/**
 * مدخل مبلغ المستخدم (ريال، حتى منزلتين، يقبل أرقاماً عربية-هندية وفاصلة عشرية عربية) → هللات صحيحة، أو `null` إن لم يكن صالحاً. بلا `Number`/عائم.
 */
export function parseRiyalToMinor(input: string): number | null {
  const normalized = input
    .trim()
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٫,]/g, '.');
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(normalized);
  if (!m) return null;
  const minor = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
  return minor > 0 ? minor : null;
}

/** وجهة التحويل المقبولة: https فقط (الدفع مستضاف لدى المزوّد؛ لا `javascript:`/`http:`/`data:`). */
export function isSafeCheckoutUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    return new URL(url).protocol === 'https:';
  } catch {
    return false;
  }
}

/** مفتاح منع التكرار لكل (رمز، مبلغ) ثابت داخل الجلسة: تحديث الصفحة/الرجوع يعيد المحاولة نفسها لا محاولة جديدة. صيغته تطابق عقد الخادم. */
export function idempotencyKeyFor(token: string, amountMinor: number | undefined, storage: Pick<Storage, 'getItem' | 'setItem'> | null): string {
  const slot = `awj.pay.idem.${token.slice(0, 12)}.${amountMinor ?? 'full'}`;
  try {
    const existing = storage?.getItem(slot);
    if (existing && /^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(existing)) return existing;
  } catch {
    // التخزين قد يكون محجوباً (نافذة خاصة): نكمل بمفتاح جديد.
  }
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now()}${Math.random().toString(36).slice(2)}`;
  const key = `pay-${random}`;
  try {
    storage?.setItem(slot, key);
  } catch {
    // لا شيء
  }
  return key;
}
