/**
 * استعلام قائمة مقارنات كشوف الأطراف (N1) — حالة الفلاتر ⇄ سلسلة الاستعلام. المفاتيح مطابقة لعقد الخادم حرفياً
 * (`PartnerStatementReconciliationController::index`)، والخادم يرفض المجهول بـ422. **التصفية والفرز والترقيم خادمية كلها**:
 * الواجهة لا تصفّي ولا تعدّ ولا تفرز محلياً (لا بديل أمني عن رؤية الخادم).
 */
import { daysBetween, ROLES, STATUSES, type PartnerRole, type ReconciliationStatus } from './contract';

export const SORT_COLUMNS = ['created_at', 'period_from', 'period_to', 'status', 'line_count', 'original_filename', 'partner_name'] as const;
export type SortColumn = (typeof SORT_COLUMNS)[number];
export const DEFAULT_SORT = '-created_at';
export const DEFAULT_PER_PAGE = 25;
export const MAX_PER_PAGE = 50;
export const PER_PAGE_OPTIONS = [25, 50];
export const MAX_SEARCH_LENGTH = 100;

export interface ListFilters {
  status: ReconciliationStatus[];
  partnerId: string;
  role: '' | PartnerRole;
  periodFrom: string;
  periodTo: string;
  branchId: string;
  q: string;
  sort: string;
  page: number;
  perPage: number;
}

export const EMPTY_FILTERS: ListFilters = {
  status: [],
  partnerId: '',
  role: '',
  periodFrom: '',
  periodTo: '',
  branchId: '',
  q: '',
  sort: DEFAULT_SORT,
  page: 1,
  perPage: DEFAULT_PER_PAGE,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validDate(value: string | null): string {
  return value && daysBetween(value, value) !== null ? value : '';
}

function validSort(value: string | null): string {
  if (!value) return DEFAULT_SORT;
  const column = value.startsWith('-') ? value.slice(1) : value;
  return (SORT_COLUMNS as readonly string[]).includes(column) ? value : DEFAULT_SORT;
}

/** يقرأ حالة الفلاتر من سلسلة استعلام (رابط الصفحة أو مدخل مستخدم): كل قيمة غير صالحة تسقط إلى الافتراضي بدل أن تصل إلى الخادم. */
export function parseListQuery(params: URLSearchParams): ListFilters {
  const statuses = params.getAll('status[]').concat(params.getAll('status'));
  const role = params.get('role');
  const partnerId = params.get('partner_id') ?? '';
  const branchId = params.get('branch_id') ?? '';
  const page = Number(params.get('page'));
  const perPage = Number(params.get('per_page'));

  return {
    status: Array.from(new Set(statuses.filter((value): value is ReconciliationStatus => (STATUSES as readonly string[]).includes(value)))),
    partnerId: UUID.test(partnerId) ? partnerId.toLowerCase() : '',
    role: (ROLES as readonly string[]).includes(role ?? '') ? (role as PartnerRole) : '',
    periodFrom: validDate(params.get('period_from')),
    periodTo: validDate(params.get('period_to')),
    branchId: UUID.test(branchId) ? branchId.toLowerCase() : '',
    q: (params.get('q') ?? '').slice(0, MAX_SEARCH_LENGTH),
    sort: validSort(params.get('sort')),
    page: Number.isInteger(page) && page >= 1 ? Math.min(page, 100_000) : 1,
    perPage: PER_PAGE_OPTIONS.includes(perPage) ? perPage : DEFAULT_PER_PAGE,
  };
}

/** استعلام الخادم: الفراغ والافتراضي لا يُرسَلان. فترة معكوسة (من > إلى) لا تُرسَل أصلاً لأن الخادم يرفضها 422 — الواجهة تعرض تنبيهاً بدلها. */
export function serializeListQuery(filters: ListFilters, options: { includeDefaults?: boolean } = {}): string {
  const params = new URLSearchParams();
  for (const status of filters.status) params.append('status[]', status);
  if (filters.partnerId) params.set('partner_id', filters.partnerId);
  if (filters.role) params.set('role', filters.role);
  const inverted = filters.periodFrom && filters.periodTo && filters.periodTo < filters.periodFrom;
  if (filters.periodFrom && !inverted) params.set('period_from', filters.periodFrom);
  if (filters.periodTo && !inverted) params.set('period_to', filters.periodTo);
  if (filters.branchId) params.set('branch_id', filters.branchId);
  const q = filters.q.trim().slice(0, MAX_SEARCH_LENGTH);
  if (q) params.set('q', q);
  if (filters.sort && (filters.sort !== DEFAULT_SORT || options.includeDefaults)) params.set('sort', filters.sort);
  if (filters.page > 1 || options.includeDefaults) params.set('page', String(filters.page));
  if (filters.perPage !== DEFAULT_PER_PAGE || options.includeDefaults) params.set('per_page', String(Math.min(filters.perPage, MAX_PER_PAGE)));
  return params.toString();
}

export function hasPeriodInversion(filters: Pick<ListFilters, 'periodFrom' | 'periodTo'>): boolean {
  return Boolean(filters.periodFrom && filters.periodTo && filters.periodTo < filters.periodFrom);
}

/** عدد الفلاتر النشطة (للشارة على زر الفلاتر في الجوال) — لا يعدّ الفرز ولا الترقيم. */
export function activeFilterCount(filters: ListFilters): number {
  return [
    filters.status.length > 0,
    filters.partnerId !== '',
    filters.role !== '',
    filters.periodFrom !== '' || filters.periodTo !== '',
    filters.branchId !== '',
    filters.q.trim() !== '',
  ].filter(Boolean).length;
}
