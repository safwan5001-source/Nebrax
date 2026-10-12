/**
 * CUST-H5-2 — يستنتج «نية» التعديل لتجميع الرشقات المتتالية في خطوة تراجع واحدة (§3.4: كتابة عبارة ≠ خطوة لكل حرف).
 *
 * القاعدة محافظة عمداً: يُرجع مفتاحاً **فقط** حين يكون الفرق بين المستندين ورقةً (leaf) واحدة نصّية أو رقمية بالبنية نفسها
 * تماماً (لا مفتاح أُضيف/حُذف، لا عنصر مصفوفة أُضيف/حُذف/أُعيد ترتيبه). عندها يكون تعديل «الحقل نفسه» مرتين خلال
 * نافذة التجميع هو الكتابة في الحقل أو سحب منزلق أو إدخال لون سداسي — لا شيء غير ذلك.
 *
 * ما لا يُجمَّع أبداً (يُرجع `undefined`): البنى (إضافة/حذف/نقل/تكرار قسم)، المنطقيات (تبديل إظهار)، تغيّر عدة أوراق معاً
 * (تطبيق نمط جاهز)، أو أي اختلاف في الشكل. نقرتان متتاليتان على «انقل لأسفل» تبقيان خطوتين لأنهما تغيّران بنية المصفوفة.
 */

type Json = unknown;

/**
 * مصدر الحدث شرط ثانٍ للتجميع (مراجعة Codex): نوع الورقة وحده لا يميّز الكتابة عن **اختيار منفصل** — تغيير قائمة منسدلة أو
 * صورة مرتين خلال ثانية لا يجوز أن يُدمج فيُفقد الاختيار الأوسط. لذا لا يُجمَّع إلا ما نشأ من حدث `input` لعنصر إدخال
 * مستمر: نص/رقم/منزلق/لون/منطقة نصية. القوائم المنسدلة والأزرار والمنتقيات تبقى خطوات مستقلة دائماً.
 */
const CONTINUOUS_INPUT_TYPES = new Set(["text", "search", "email", "url", "tel", "password", "number", "range", "color"]);

export function isContinuousInputTarget(target: EventTarget | null): boolean {
  const element = target as HTMLElement | null;
  if (!element || typeof element.tagName !== "string") return false;
  const tag = element.tagName.toLowerCase();
  if (tag === "textarea") return true;
  if (tag !== "input") return false;
  return CONTINUOUS_INPUT_TYPES.has(((element as HTMLInputElement).type || "text").toLowerCase());
}

/** نافذة ربط التعديل بحدث `input` المستمر: المعالج يعمل متزامناً داخل الحدث؛ ما يتأخر عن ذلك (debounce) لا يُجمَّع. */
export const CONTINUOUS_INPUT_WINDOW_MS = 100;

const MAX_DIFFS = 2;

function isPlainObject(value: Json): value is Record<string, Json> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isGroupableLeaf(value: Json): value is string | number {
  return typeof value === "string" || (typeof value === "number" && Number.isFinite(value));
}

interface DiffState {
  paths: string[];
  /** رُصد اختلاف غير ورقي (شكل/نوع/مفتاح/طول) — لا تجميع. */
  structural: boolean;
}

function walk(prev: Json, next: Json, path: string, state: DiffState): void {
  if (state.structural || state.paths.length >= MAX_DIFFS) return;
  if (prev === next) return;

  if (isPlainObject(prev) && isPlainObject(next)) {
    const prevKeys = Object.keys(prev);
    const nextKeys = Object.keys(next);
    if (prevKeys.length !== nextKeys.length) {
      state.structural = true;
      return;
    }
    for (const key of prevKeys) {
      if (!Object.prototype.hasOwnProperty.call(next, key)) {
        state.structural = true;
        return;
      }
      walk(prev[key], next[key], `${path}/${key}`, state);
      if (state.structural || state.paths.length >= MAX_DIFFS) return;
    }
    return;
  }

  if (Array.isArray(prev) && Array.isArray(next)) {
    if (prev.length !== next.length) {
      state.structural = true;
      return;
    }
    for (let i = 0; i < prev.length; i += 1) {
      walk(prev[i], next[i], `${path}[${i}]`, state);
      if (state.structural || state.paths.length >= MAX_DIFFS) return;
    }
    return;
  }

  if (isGroupableLeaf(prev) && isGroupableLeaf(next) && typeof prev === typeof next) {
    state.paths.push(path);
    return;
  }
  state.structural = true;
}

/** مفتاح مجموعة للتعديل من `prev` إلى `next`، أو `undefined` إن لم يكن تعديل حقل واحد. */
export function intentGroupKey(prev: Json, next: Json): string | undefined {
  const state: DiffState = { paths: [], structural: false };
  walk(prev, next, "", state);
  if (state.structural || state.paths.length !== 1) return undefined;
  return `leaf:${state.paths[0]}`;
}
