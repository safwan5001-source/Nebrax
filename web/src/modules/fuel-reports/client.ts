import { api, downloadFile, fetchPrivateFileUrl } from '@/lib/api';
import { catalogSchema, payloadSchema, type Catalog, type ReportPayload } from './schemas';

/**
 * HORIZON-REPORTS — عميل محرك تقارير الوقود. **مساران فقط** لكل الواجهات: القراءة والتصدير (+ تدقيق الطباعة/PDF/المشاركة).
 * التفويض والنطاق وحذف الأعمدة الحسّاسة كلها في الخادم؛ هنا لا قرار صلاحية ولا حساب مالي. الاستجابة المخالفة للعقد تُرفض كاملةً.
 */

export type ReportFilters = Record<string, string | undefined>;
export const BASE = '/fuel-stations/report-center';
export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export class ReportContractError extends Error {
  constructor() {
    super('Unexpected report response shape');
    this.name = 'ReportContractError';
  }
}

export function toQuery(filters: ReportFilters, extra: Record<string, string> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...filters, ...extra })) {
    if (value !== undefined && value !== '') params.set(key, value);
  }
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

export async function fetchCatalog(): Promise<Catalog> {
  const parsed = catalogSchema.safeParse(await api<unknown>(`${BASE}/catalog`));
  if (!parsed.success) throw new ReportContractError();
  return parsed.data.data;
}

export async function fetchReport(key: string, filters: ReportFilters): Promise<ReportPayload> {
  const parsed = payloadSchema.safeParse(await api<unknown>(`${BASE}/${encodeURIComponent(key)}${toQuery(filters)}`));
  if (!parsed.success) throw new ReportContractError();
  return parsed.data.data;
}

export const exportPath = (key: string, filters: ReportFilters, format: 'xlsx' | 'csv', lang: 'ar' | 'en', table?: string): string =>
  `${BASE}/${encodeURIComponent(key)}/export${toQuery(filters, { format, lang, ...(table ? { table } : {}) })}`;

export function downloadExport(key: string, filters: ReportFilters, format: 'xlsx' | 'csv', lang: 'ar' | 'en', fallbackName: string, table?: string) {
  return downloadFile(exportPath(key, filters, format, lang, table), fallbackName);
}

/** رابط blob للملف المصدَّر (للمشاركة). المستدعي يلغي الرابط. */
export function exportBlobUrl(key: string, filters: ReportFilters, format: 'xlsx' | 'csv', lang: 'ar' | 'en', table?: string): Promise<string> {
  return fetchPrivateFileUrl(exportPath(key, filters, format, lang, table), format === 'xlsx' ? XLSX_MIME : 'text/csv');
}

/** تدقيق طباعة/PDF/مشاركة نُفِّذت في المتصفح. فشله لا يمنع المستخدم (يُبلَغ عنه فقط). */
export async function auditAction(key: string, action: 'print' | 'pdf' | 'share', filters: ReportFilters): Promise<boolean> {
  try {
    await api(`${BASE}/${encodeURIComponent(key)}/audit`, { method: 'POST', body: { action, filters } });
    return true;
  } catch {
    return false;
  }
}
