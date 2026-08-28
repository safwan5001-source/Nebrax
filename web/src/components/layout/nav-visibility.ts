import { hasPermission } from '@/lib/permissions';

/**
 * قرار ظهور عنصر أو مجموعة في الشريط الجانبي — منطق نقيّ معزول عن العرض.
 *
 * بوابتان مستقلّتان لا تُغني إحداهما عن الأخرى:
 *
 *  1. **حالة القدرة الفعلية** (`appKey`): يحسبها الخادم كاملةً في
 *     `GET /applications/nav-state` — قرار المستأجر التشغيلي **و** الاستحقاق
 *     التجاري للقدرات التي تُحرَس مساراتها تجارياً. الواجهة تستهلك النتيجة ولا
 *     تحسب استحقاقاً بنفسها.
 *  2. **صلاحية RBAC** (`permission`): تُفحَص بمرآة `Rbac::allows` نفسها.
 *
 * فشل جلب حالة القدرات لا يُخفي شيئاً (مجموعة فارغة) — أسلم من إخفاء الشريط
 * كلّه بخطأ شبكة عابر، والمسارات محروسة في الخادم على أي حال.
 */

export interface NavVisibilityEntry {
  appKey?: string;
  permission?: string;
}

export interface NavViewer {
  permissions?: string[];
  role?: string;
}

/** مفاتيح القدرات غير المرئية اليوم، من خريطة `data` في عقد `nav-state`. */
export function hiddenApplicationKeys(navState: Record<string, boolean>): Set<string> {
  return new Set(
    Object.entries(navState)
      .filter(([, visible]) => !visible)
      .map(([key]) => key),
  );
}

export function isNavEntryVisible(
  entry: NavVisibilityEntry,
  hiddenAppKeys: Set<string>,
  viewer: NavViewer | null | undefined,
): boolean {
  if (entry.appKey !== undefined && hiddenAppKeys.has(entry.appKey)) return false;
  if (entry.permission === undefined) return true;

  return hasPermission(viewer?.permissions, viewer?.role, entry.permission);
}
