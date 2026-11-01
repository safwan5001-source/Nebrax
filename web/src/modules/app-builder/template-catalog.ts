import { api } from '@/lib/api';

/**
 * AD-11 / S22b — قوالب التطبيق من سجل الخادم (`GET app-builder/templates`، مصدر الحقيقة الوحيد).
 * الويب لا يحمل مخططات قوالب: يعرض الاسم/الوصف/الحد الأدنى للتشغيل ويرسل `template_key` عند الإنشاء،
 * فيزرع الخادم المسودة ذرّياً مع التطبيق (لا بذر عميلي يُبتلع فشله).
 */
export interface AppTemplateMeta {
  key: string;
  version: number;
  vertical: string | null;
  name: { ar: string; en: string };
  description: { ar: string; en: string };
  /** أدنى جيل Runtime يرندر القالب، أو null إن لم يرندره أي جيل معروف. */
  min_runtime: string | null;
}

export async function fetchAppTemplates(): Promise<AppTemplateMeta[]> {
  const response = await api<{ data: AppTemplateMeta[] }>('/app-builder/templates');
  return Array.isArray(response.data) ? response.data : [];
}

/** نص بلغة الواجهة مع سقوط إلى الأخرى إن غاب. */
export function localizedText(text: { ar: string; en: string }, locale: string): string {
  const preferred = locale.startsWith('ar') ? text.ar : text.en;
  return preferred || text.ar || text.en || '';
}
