/**
 * كتالوج مركز الاستيراد (IMP-H8-S1) — **خريطة تنقّل لا أكثر**: لا يكرّر أي حارس. كل كيان يعلن صلاحية الكتابة التي تحكم شاشة استيراده (مرآة `ImportJobDomain::AUTHORIZATION`)
 * وقدرته إن وُجدت، فيُخفى من لا يملك أيّاً منهما بالقاعدة نفسها التي تحكم الشريط الجانبي (`isNavEntryVisible`)؛ والخادم يحرس المسارات على أي حال.
 * **الاستيراد بمساعد أَوْج** يُعلَن لكيان واحد فقط اليوم (المنتجات)؛ لا مسار مساعد لغيره فلا يُصطنع رابط.
 */
import type { ImportJob, ImportJobDomain, ImportJobStatus } from '@/modules/import-jobs/client';

export type HubSection = 'catalog' | 'stock' | 'partners' | 'transactions';

export interface HubEntity {
  key: string;
  section: HubSection;
  /** مسار الاستيراد العادي. كيان الجرد يمرّ عبر قائمة الجرد لأن الاستيراد يخص جرداً بعينه. */
  standardHref: string;
  /** مسار ثانوي للكيان نفسه (المنتجات: المصنّف متعدد الأوراق). */
  secondary?: { key: string; href: string };
  /** مسار الاستيراد بمساعد أَوْج — حيث يوجد فقط. */
  aiHref?: string;
  permission: string;
  appKey?: string;
}

export const HUB_SECTIONS: HubSection[] = ['catalog', 'stock', 'partners', 'transactions'];

export const HUB_ENTITIES: HubEntity[] = [
  { key: 'products', section: 'catalog', standardHref: '/products/import', secondary: { key: 'workbook', href: '/products/workbook-import' }, aiHref: '/products/ai-import', permission: 'products.manage' },
  { key: 'categories', section: 'catalog', standardHref: '/inventory-settings/categories/import', permission: 'products.manage' },
  { key: 'brands', section: 'catalog', standardHref: '/inventory-settings/brands/import', permission: 'products.manage' },
  { key: 'unit_templates', section: 'catalog', standardHref: '/inventory-settings/units/import', permission: 'products.manage' },
  { key: 'price_list_items', section: 'catalog', standardHref: '/sales-settings/pricelists/import', permission: 'company.manage' },
  { key: 'inventory_openings', section: 'stock', standardHref: '/inventory-openings/import', permission: 'products.manage', appKey: 'inventory.core' },
  { key: 'stock_permits', section: 'stock', standardHref: '/stock-permits/import', permission: 'products.manage', appKey: 'inventory.core' },
  { key: 'stocktake_counts', section: 'stock', standardHref: '/stocktaking', permission: 'products.manage', appKey: 'inventory.core' },
  { key: 'customers', section: 'partners', standardHref: '/partners/import', permission: 'partners.manage' },
  { key: 'suppliers', section: 'partners', standardHref: '/suppliers/import', permission: 'partners.manage' },
  { key: 'purchases', section: 'transactions', standardHref: '/purchases/import', permission: 'purchases.manage', appKey: 'purchases.cycle' },
  { key: 'expenses', section: 'transactions', standardHref: '/expenses/import', permission: 'expenses.manage', appKey: 'finance.operations' },
];

export const HUB_JOB_DOMAINS: ImportJobDomain[] = [
  'product_catalog',
  'product_workbook',
  'product_taxonomy',
  'unit_templates',
  'price_list_items',
  'inventory_opening',
  'stock_permit_import',
  'stocktake_count',
  'partner_master',
  'purchase_import',
  'expense_import',
];

export const HUB_JOB_STATUSES: ImportJobStatus[] = ['uploaded', 'ready', 'processing', 'completed', 'failed', 'cancelled'];

const RESUME_ROUTES: Partial<Record<ImportJobDomain, string>> = {
  product_catalog: '/products/import',
  product_workbook: '/products/workbook-import',
  price_list_items: '/sales-settings/pricelists/import',
  unit_templates: '/inventory-settings/units/import',
  inventory_opening: '/inventory-openings/import',
  stock_permit_import: '/stock-permits/import',
  purchase_import: '/purchases/import',
  expense_import: '/expenses/import',
};

/** الحالات التي يصحّ فيها استئناف التشغيلة من معالجها (ما عداها نهائيٌّ لا يُنفَّذ ثانيةً). */
const RESUMABLE: ReadonlySet<ImportJobStatus> = new Set(['ready', 'processing']);

/**
 * رابط استئناف تشغيلة من معالجها، أو `null` حين لا يُعرف المعالج من بيانات التشغيلة وحدها: العملاء والموردون يشتركان في مجال واحد، والتصنيفات والماركات في مجال
 * واحد، ولا يعرض الخادم النوع في القائمة — فلا نخمّن معالجاً قد يعرض التشغيلة بعنوان خاطئ. (الجرد يحمل هدفه المجمَّد فيُعرف.)
 */
export function resumeHref(job: Pick<ImportJob, 'id' | 'domain' | 'status' | 'target_id'>): string | null {
  if (!RESUMABLE.has(job.status)) return null;
  const query = `?job=${encodeURIComponent(job.id)}`;
  if (job.domain === 'stocktake_count') return job.target_id ? `/stocktaking/${encodeURIComponent(job.target_id)}/import${query}` : null;
  const route = RESUME_ROUTES[job.domain];

  return route ? `${route}${query}` : null;
}
