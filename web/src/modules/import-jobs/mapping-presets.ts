/**
 * عميل مطابقات الأعمدة المحفوظة (IMP-H8-S2b) فوق `import-mapping-presets` (IMP-H8-S2a). المطابقة تُحفظ بنصّ **عنوان العمود** لا بفهرسه، ويُطابقها الخادم بالعنوان المطبَّع
 * (`match`) فلا تُعاد كتابة المُطبِّع هنا. **لا سياسات تشغيل فيها**: عناوين ومفاتيح حقول فقط. الدالتان النقيّتان تحكمان ما يصل إلى حالة المعالج: لا مفتاحٌ لا يعرفه المجال
 * (كي لا يرفضه الخادم عند المعاينة)، ولا حقلٌ على عمودين.
 */
import { api } from '@/lib/api';
import type { ImportJobDomain } from './client';

export interface MappingPresetColumn {
  header: string;
  field: string | null;
}

export interface MappingPreset {
  id: string;
  domain: ImportJobDomain;
  name: string;
  columns: MappingPresetColumn[];
  created_at: string | null;
}

export interface MappingMatch {
  mapping: Record<number, string | null>;
  matched: number;
  unmatched: number[];
}

export type ColumnMapping = Record<number, string | null>;

export async function listMappingPresets(domain: ImportJobDomain): Promise<MappingPreset[]> {
  const response = await api<{ data: MappingPreset[] }>(`/import-mapping-presets?domain=${encodeURIComponent(domain)}`);
  // عقدٌ غير متوقع (أو ردٌّ فارغ) يُعامل كقائمة فارغة لا كخطأ عرض: الميزة مساعدة.
  return Array.isArray(response?.data) ? response.data : [];
}

export async function saveMappingPreset(domain: ImportJobDomain, name: string, columns: MappingPresetColumn[]): Promise<MappingPreset> {
  const response = await api<{ data: MappingPreset }>('/import-mapping-presets', { method: 'POST', body: { domain, name, columns } });
  return response.data;
}

export async function deleteMappingPreset(id: string): Promise<void> {
  await api(`/import-mapping-presets/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function matchMappingPreset(id: string, headers: string[]): Promise<MappingMatch> {
  const response = await api<{ data: MappingMatch }>(`/import-mapping-presets/${encodeURIComponent(id)}/match`, { method: 'POST', body: { headers } });
  return response.data;
}

/** مطابقة المعالج الحالية كأعمدة محفوظة بترتيب أعمدة الملف: العمود المتجاهَل/غير المربوط يُحفظ بلا حقل. */
export function presetColumnsFromMapping(columns: { index: number; header: string }[], mapping: ColumnMapping): MappingPresetColumn[] {
  return columns.map((column) => ({ header: column.header ?? '', field: mapping[column.index] || null }));
}

/** هل في المطابقة الحالية حقلٌ واحد مربوط على الأقل؟ (مطابقة بلا أي ربط لا تستحق الحفظ). */
export function hasMappedField(mapping: ColumnMapping): boolean {
  return Object.values(mapping).some(Boolean);
}

/**
 * يدمج نتيجة `match` في المطابقة الحالية: عمودٌ طابق عنواناً محفوظاً **يأخذ حقله** (المحفوظ يتقدّم على الاقتراح التلقائي)، وغير المطابق يبقى كما هو. حقلٌ لا يعرفه المجال في الملف
 * الحالي يُسقَط (ويُعدّ في `dropped`) ويعود العمود إلى `null`. وإن أخذ عمودٌ مطابق حقلاً مربوطاً أصلاً بعمودٍ **غير مطابق** (اقتراح تلقائي) أُفرغ الأخير، فلا يُربَط حقلٌ بعمودين.
 */
export function mergePresetMapping(
  current: ColumnMapping,
  match: MappingMatch,
  allowedFields: ReadonlySet<string>
): { mapping: ColumnMapping; applied: number; dropped: number } {
  const unmatched = new Set(match.unmatched);
  const next: ColumnMapping = { ...current };
  const claimed = new Set<string>();
  let applied = 0;
  let dropped = 0;

  for (const [rawIndex, field] of Object.entries(match.mapping)) {
    const index = Number(rawIndex);
    if (unmatched.has(index)) continue;
    if (field !== null && !allowedFields.has(field)) {
      next[index] = null;
      dropped += 1;
      continue;
    }
    next[index] = field;
    if (field !== null) {
      claimed.add(field);
      applied += 1;
    }
  }
  for (const index of unmatched) {
    const field = next[index];
    if (field && claimed.has(field)) next[index] = null;
  }

  return { mapping: next, applied, dropped };
}
