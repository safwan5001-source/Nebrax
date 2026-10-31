import type { AppSchemaComponent } from '@/lib/app-builder';

export type EditorMode = 'easy' | 'advanced';

const key = (userId: string, appId: string) => `awj.appBuilder.editorMode.v1.${userId}.${appId}`;

/**
 * تفضيل الوضع (سهل/متقدم) لكل مستخدم وتطبيق — راحة عرض فقط في المتصفح (لا تخزين خادمي، فلا عقد API ولا هجرة؛ تفضيل الوضع
 * على الخادم قرار مفتوح للمالك). التبديل لا يمسّ المسودة أبداً: الوضعان يعرضان المخطط نفسه. الافتراضي سهل.
 */
export function readEditorMode(userId: string, appId: string): EditorMode {
  try {
    return window.localStorage.getItem(key(userId, appId)) === 'advanced' ? 'advanced' : 'easy';
  } catch {
    return 'easy';
  }
}

export function writeEditorMode(userId: string, appId: string, mode: EditorMode): void {
  try {
    window.localStorage.setItem(key(userId, appId), mode);
  } catch {
    // التخزين غير متاح: يبقى التفضيل للجلسة الحالية فقط
  }
}

const DATA_LISTS = new Set(['ProductList', 'CartList']);

/** العقدة التي يفتحها المفتش عند اختيار قسم من القائمة: محتوى القسم الوحيد، إلا قوائم البيانات فيبقى القسم (عنوانه). */
export function selectionTargetFor(section: AppSchemaComponent): string {
  const only = section.type === 'Section' && section.children?.length === 1 ? section.children[0] : null;
  return only && !DATA_LISTS.has(only.type) ? only.id : section.id;
}

/** هل `id` هو القسم نفسه أو أحد أبنائه (لتمييز القسم المحدد في القائمة)؟ */
export function sectionContains(section: AppSchemaComponent, id: string | null): boolean {
  if (!id) return false;
  if (section.id === id) return true;
  return (section.children ?? []).some((child) => sectionContains(child, id));
}
