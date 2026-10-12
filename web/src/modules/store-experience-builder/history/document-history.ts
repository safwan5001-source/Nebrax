/**
 * CUST-H5-1 — محرّك سجلّ التراجع/الإعادة المحلي (Undo/Redo) للمستند الكامل.
 *
 * دوال نقيّة فقط: لا React ولا شبكة ولا تخزين متصفح ولا ساعة ضمنية (الزمن يُمرَّر). يُدير سجلّاً **مؤقتاً** لجلسة
 * تحرير واحدة لنسخة (Version) واحدة، ولا يملك أي سلطة على الحفظ أو النشر أو مراجعة الخادم.
 *
 * العقود المجمَّدة (CUST-H5 §3):
 *  - النطاق = معرّف النسخة (`scopeKey`). أي عملية بنطاق مغاير تُتجاهل كلياً (ردّ متأخر من نسخة سابقة لا يلوّث الحالية).
 *  - حدّ الحفظ صلب: `markSaved` يُفرغ الخلف والأمام؛ فشل الحفظ لا يلمس السجلّ أصلاً (لا دالة له هنا).
 *  - تعديل جديد بعد تراجع يُسقط فرع الإعادة.
 *  - التجميع (coalescing) يحوّل رشقة تعديلات متتالية بمفتاح مجموعة واحد إلى خطوة واحدة (نية التاجر، لا ضغطة مفتاح).
 *  - الحجم محدود بعدد الخطوات؛ الأقدم يسقط أولاً.
 *  - المستندات تُعامَل **كقيم غير قابلة للتعديل**: يخزّن السجلّ مراجع لا نسخاً عميقة. يضمن ذلك طبقة التحرير
 *    (`updateDraft` يُنتج دائماً كائناً جديداً) — لا تُعدِّل مستنداً بعد تمريره إلى هنا.
 */

/** نافذة التجميع الافتراضية بين تعديلين متتاليين بمفتاح مجموعة واحد. */
export const DEFAULT_COALESCE_WINDOW_MS = 1000;

/** أقصى عدد خطوات تراجع محفوظة. محدود عمداً: كل خطوة لقطة مستند كاملة. */
export const DEFAULT_MAX_HISTORY_ENTRIES = 100;

export interface HistoryOptions<T> {
  /** مقارنة بنيوية للمستندين؛ الافتراضي مقارنة JSON (يطابق `presentationConfigsEqual`). */
  equals?: (a: T, b: T) => boolean;
  maxEntries?: number;
  coalesceWindowMs?: number;
}

export interface DocumentHistory<T> {
  /** معرّف النسخة المالكة للجلسة. `null` = لا جلسة (لا نسخة مفتوحة) — كل العمليات تُتجاهل. */
  readonly scopeKey: string | null;
  readonly present: T;
  /** الأقدم أولاً؛ الأخير = الحالة السابقة مباشرة للحالية. */
  readonly past: readonly T[];
  /** الأقرب أولاً؛ الأول = ما تعيده `redo` الآن. */
  readonly future: readonly T[];
  /** آخر تعديل مُجمَّع قابل للاستمرار، أو `null` حين يبدأ التعديل التالي خطوة جديدة. */
  readonly lastGroup: { readonly key: string; readonly at: number } | null;
}

export interface RecordOptions {
  /** مفتاح تجميع (مثلاً `text:headline`). غيابه = كل تعديل خطوة مستقلة. */
  group?: string;
  /** الوقت بالميلي ثانية. إلزامي: المحرّك لا يقرأ الساعة بنفسه فيبقى حتمياً. */
  now: number;
}

function jsonEquals<T>(a: T, b: T): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function equalsOf<T>(options?: HistoryOptions<T>): (a: T, b: T) => boolean {
  return options?.equals ?? jsonEquals;
}

/** جلسة جديدة (أو حدّ إعادة ضبط): لا خلف ولا أمام. */
export function createHistory<T>(scopeKey: string | null, present: T): DocumentHistory<T> {
  return { scopeKey, present, past: [], future: [], lastGroup: null };
}

/**
 * حدّ إعادة ضبط صريح: حفظ ناجح، تبديل نسخة/متجر، تجاهل صريح، أو انتقال النسخة إلى منشورة غير قابلة للتعديل.
 * يستبدل الجلسة كلها (بما فيها النطاق).
 */
export function resetHistory<T>(scopeKey: string | null, present: T): DocumentHistory<T> {
  return createHistory(scopeKey, present);
}

/**
 * حفظ ناجح: الوثيقة المُعادة من الخادم (المُطبَّعة) هي خط الأساس الجديد، وحدّ التراجع **صلب دائماً** (§3.5): يُفرغ الخلف
 * والأمام في كل حفظ ناجح بلا استثناء.
 *
 * `editedSincePersist`: التاجر عدّل المسودة أثناء طيران طلب الحفظ، فحالته الحالية أحدث مما حُفظ. تبقى الحالية كما هي
 * (لا تُفقد ولا تُستبدل بوثيقة الخادم)، لكن السجلّ يبدأ فارغاً منها — لا يعبر التراجع حدّ الحفظ ولا يعود حتى إلى المحفوظ.
 * وإلا تصير الوثيقة المحفوظة هي الحالية.
 */
export function markSaved<T>(
  state: DocumentHistory<T>,
  scopeKey: string,
  saved: T,
  editedSincePersist: boolean,
): DocumentHistory<T> {
  if (state.scopeKey !== scopeKey) return state;
  return createHistory(scopeKey, editedSincePersist ? state.present : saved);
}

/**
 * يسجّل تعديل تاجر. يعيد الحالة نفسها (بالمرجع) إن لم يتغيّر المستند أو كان النطاق مغايراً.
 */
export function recordEdit<T>(
  state: DocumentHistory<T>,
  scopeKey: string,
  next: T,
  record: RecordOptions,
  options?: HistoryOptions<T>,
): DocumentHistory<T> {
  if (state.scopeKey !== scopeKey) return state;
  const equals = equalsOf(options);
  if (equals(state.present, next)) return state;

  const windowMs = options?.coalesceWindowMs ?? DEFAULT_COALESCE_WINDOW_MS;
  const group = record.group;
  const continues =
    group !== undefined &&
    state.lastGroup !== null &&
    state.lastGroup.key === group &&
    record.now - state.lastGroup.at >= 0 &&
    record.now - state.lastGroup.at <= windowMs &&
    state.past.length > 0;

  if (continues) {
    const origin = state.past[state.past.length - 1];
    // رشقة عادت إلى نقطة بدايتها (كتب ثم محا): لا خطوة متبقية تستحق التراجع.
    if (equals(origin, next)) {
      return { ...state, present: next, past: state.past.slice(0, -1), future: [], lastGroup: null };
    }
    return { ...state, present: next, future: [], lastGroup: { key: group, at: record.now } };
  }

  const max = Math.max(1, options?.maxEntries ?? DEFAULT_MAX_HISTORY_ENTRIES);
  const past = [...state.past, state.present];
  if (past.length > max) past.splice(0, past.length - max);
  return {
    ...state,
    present: next,
    past,
    future: [],
    lastGroup: group === undefined ? null : { key: group, at: record.now },
  };
}

export function canUndo<T>(state: DocumentHistory<T>): boolean {
  return state.scopeKey !== null && state.past.length > 0;
}

export function canRedo<T>(state: DocumentHistory<T>): boolean {
  return state.scopeKey !== null && state.future.length > 0;
}

/** تراجع خطوة واحدة. بلا خطوة أو بنطاق مغاير: الحالة نفسها. بعد أي تراجع يبدأ التعديل التالي خطوة جديدة. */
export function undo<T>(state: DocumentHistory<T>, scopeKey: string): DocumentHistory<T> {
  if (state.scopeKey !== scopeKey || state.past.length === 0) return state;
  const previous = state.past[state.past.length - 1];
  return {
    ...state,
    present: previous,
    past: state.past.slice(0, -1),
    future: [state.present, ...state.future],
    lastGroup: null,
  };
}

export function redo<T>(state: DocumentHistory<T>, scopeKey: string): DocumentHistory<T> {
  if (state.scopeKey !== scopeKey || state.future.length === 0) return state;
  const [next, ...rest] = state.future;
  return {
    ...state,
    present: next,
    past: [...state.past, state.present],
    future: rest,
    lastGroup: null,
  };
}
