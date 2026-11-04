/**
 * عميل REST لمقارنات كشوف الأطراف (IMP-PS-A4a): قراءة القائمة/الرأس (N1/N2) + فحص ومعاينة الاستيراد + المنتقيات المساندة. **لا كتابة هنا**:
 * التنفيذ يمرّ عبر محرّك تشغيلات الاستيراد الدائم (`/import-jobs`) المشترك. كل نداء يمرّ بـ`api()` (Bearer + فرع نشط + معالجة 401).
 */
import { api, downloadFile, type DownloadOutcome } from '@/lib/api';
import type {
  AmountDirection,
  ColumnMapping,
  InspectResult,
  PartnerRole,
  PreviewResult,
  ReconciliationPage,
  ReconciliationRow,
} from './contract';
import { serializeListQuery, type ListFilters } from './list-query';

export async function fetchReconciliations(filters: ListFilters): Promise<ReconciliationPage> {
  const query = serializeListQuery(filters, { includeDefaults: true });
  const response = await api<Partial<ReconciliationPage>>(`/partner-statement-reconciliations?${query}`);
  return {
    data: Array.isArray(response?.data) ? response.data : [],
    meta: response?.meta ?? { current_page: 1, last_page: 1, per_page: filters.perPage, total: 0 },
  };
}

export async function fetchReconciliation(id: string): Promise<ReconciliationRow> {
  const response = await api<{ data: ReconciliationRow }>(`/partner-statement-reconciliations/${encodeURIComponent(id)}`);
  return response.data;
}

export interface PartnerOption {
  id: string;
  name: string;
  code?: string | null;
  type?: string;
}

/** الطرف يُختار ضمن الدور (عميل/مورّد)؛ الخادم يعيد التحقق من رؤية الطرف والدور عند المعاينة، فلا نثق بالقائمة. */
export async function fetchPartners(role: PartnerRole | '', search: string): Promise<PartnerOption[]> {
  const params = new URLSearchParams({ per_page: '50' });
  if (role) params.set('type', role);
  if (search.trim()) params.set('search', search.trim().slice(0, 100));
  const response = await api<{ data?: PartnerOption[] }>(`/partners?${params.toString()}`);
  return Array.isArray(response?.data) ? response.data : [];
}

export interface BranchOption {
  id: string;
  name: string;
  is_active?: boolean;
}

export async function fetchBranches(): Promise<BranchOption[]> {
  const response = await api<{ data?: BranchOption[] }>('/branches');
  return Array.isArray(response?.data) ? response.data.filter((branch) => branch.is_active !== false) : [];
}

export interface PreviewOptions {
  partnerId: string;
  role: PartnerRole;
  periodFrom: string;
  periodTo: string;
  branchId: string | null;
  dateToleranceDays: number;
  amountToleranceMinor: number;
  amountDirection: AmountDirection | null;
  mapping?: ColumnMapping;
}

/**
 * جسم الفحص: الملف وحده. جسم المعاينة: الملف + الخيارات القانونية المجمَّدة. المطابقة تُرسل `index → field|ignore` كما يتوقع الخادم
 * (`mapping.*` ∈ حقول العقد أو `ignore`)؛ العملة SAR ثابتة فلا تُرسَل.
 */
export function inspectFormData(file: File): FormData {
  const form = new FormData();
  form.append('file', file);
  return form;
}

export function previewFormData(file: File, options: PreviewOptions): FormData {
  const form = new FormData();
  form.append('file', file);
  form.append('partner_id', options.partnerId);
  form.append('role', options.role);
  form.append('period_from', options.periodFrom);
  form.append('period_to', options.periodTo);
  form.append('date_tolerance_days', String(options.dateToleranceDays));
  form.append('amount_tolerance_minor', String(options.amountToleranceMinor));
  if (options.branchId) form.append('branch_id', options.branchId);
  if (options.amountDirection) form.append('amount_direction', options.amountDirection);
  for (const [index, field] of Object.entries(options.mapping ?? {})) {
    form.append(`mapping[${index}]`, field ?? 'ignore');
  }
  return form;
}

export async function inspectStatement(file: File): Promise<InspectResult> {
  const response = await api<{ data: InspectResult }>('/partner-statements/import/inspect', { method: 'POST', body: inspectFormData(file) });
  return response.data;
}

export async function previewStatement(file: File, options: PreviewOptions): Promise<PreviewResult> {
  const response = await api<{ data: PreviewResult }>('/partner-statements/import/preview', { method: 'POST', body: previewFormData(file, options) });
  return response.data;
}

export function downloadTemplate(): Promise<DownloadOutcome> {
  return downloadFile('/partner-statements/import/template', 'nebrax-partner-statement-import-template.csv');
}
