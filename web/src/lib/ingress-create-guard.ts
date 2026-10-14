/**
 * حارس إعادة الإنشاء بعد نتيجة مجهولة (INT-UX-5c) — **ذاكرة الصفحة فقط**، بلا أي تخزين.
 *
 * `POST /delivery-connectors` غير idempotent: بعد استجابة ضائعة قد يكون الخادم أنشأ النقطة (وقد تكون مخفية عن المستخدم بنطاق
 * الفروع)، فإعادة إرسال المعرّف نفسه خطرة. هذا الملف يحفظ «معرّف متجر + منصة» لعملية نتيجتها مجهولة ويمنع إعادة إرسالها، حتى لو أُغلق
 * الإشعار أو فُتح نموذج جديد أو غادر المستخدم الصفحة وعاد (تنقّل SPA). **حدّه المعلن:** تحديث الصفحة (إعادة تحميل كاملة) أو إغلاق
 * التبويب يمحو الحارس لأنه في ذاكرة الوحدة فقط. فجوة معروفة ومؤقتة مؤجَّلة عمداً: قرّر المالك (2026-10-14) أن الحل النهائي **Idempotency في الـBackend** (متابعة مستقلة)،
 * فلا تخزين متصفح هنا ولا تغيير عقد API. لا تُضف `sessionStorage`/`localStorage` لسدّ الفجوة.
 *
 * لا سرّ هنا ولا قيمة حسّاسة: منصة، ومعرّف ملف الإسناد، ومعرّف المتجر الذي أدخله المستخدم، ووقت المحاولة. لا `localStorage` ولا
 * `sessionStorage` ولا IndexedDB ولا كوكي ولا شبكة. النطاق مفتاحه المستأجر + المستخدم، فلا يتسرّب الحظر بين حسابين في الجلسة نفسها.
 *
 * يُرفع الحظر **فقط** عند ظهور النقطة نفسها في قائمة جديدة بهوية متحقَّقة (فعندها يعرف المستخدم النتيجة ويردّ الخادم 409 على إعادة
 * الإنشاء). **اختفاء النقطة أو غيابها عن القائمة لا يرفعه أبداً** (قد تكون مخفية بنطاق الفروع).
 */

export interface UnconfirmedCreate {
  platformKey: string;
  profileId: string;
  storeId: string;
  /** وقت المحاولة (ms)، للعرض والتشخيص فقط. */
  at: number;
}

const attempts = new Map<string, UnconfirmedCreate>();

/** نطاق الحارس: المستأجر + المستخدم من جلسة الواجهة. */
export function createGuardScope(user: { id?: string; tenant_id?: string } | null | undefined): string {
  return `${user?.tenant_id ?? ''}:${user?.id ?? ''}`;
}

const keyOf = (scope: string, platformKey: string, storeId: string) => `${scope}\u0000${platformKey}\u0000${storeId}`;

/** المقارنة حرفية على المعرّف المقصوص (كما يرسله النموذج ويقصّه الخادم). */
export function recordUnconfirmedCreate(scope: string, entry: UnconfirmedCreate): void {
  attempts.set(keyOf(scope, entry.platformKey, entry.storeId), entry);
}

export function findUnconfirmedCreate(scope: string, platformKey: string, storeId: string): UnconfirmedCreate | null {
  return attempts.get(keyOf(scope, platformKey, storeId.trim())) ?? null;
}

export function listUnconfirmedCreates(scope: string, platformKey: string): UnconfirmedCreate[] {
  return [...attempts.entries()]
    .filter(([key, entry]) => entry.platformKey === platformKey && key.startsWith(`${scope}\u0000`))
    .map(([, entry]) => entry)
    .sort((a, b) => a.at - b.at);
}

/** يُستدعى فقط عند ظهور النقطة بهوية متحقَّقة في قائمة جديدة. */
export function clearUnconfirmedCreate(scope: string, platformKey: string, storeId: string): void {
  attempts.delete(keyOf(scope, platformKey, storeId));
}

/** للاختبارات فقط: يحاكي «ذاكرة جديدة» كما بعد إعادة تحميل كاملة. */
export function resetUnconfirmedCreatesForTests(): void {
  attempts.clear();
}
