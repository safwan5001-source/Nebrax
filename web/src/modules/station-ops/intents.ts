/**
 * UI-2 — نيّات الكتابة: مفاتيح idempotency ثابتة لكل نية.
 *
 * منع النقر المزدوج في الواجهة **ليس كافياً** (مهلة بعد الإرسال ثم إعادة المحاولة بعد إعادة تحميل الصفحة). لذلك:
 *  1. **قراءات العدادات/الخزانات**: مفتاح الدليل حتمي من (وردية، أصل، مرحلة) — `evidenceKey`. السجل فريد لهذا الثلاثي في الخادم، فإعادة
 *     الإرسال بعد أي انقطاع تعيد السجل نفسه إن تطابقت القيمة، وترفض إن اختلفت — دون أي حالة جانبية في الذاكرة.
 *  2. **فتح الوردية وحركة النقد**: مفتاح عشوائي واحد لكل نية يُحفظ في `sessionStorage` (يموت بإغلاق التبويب) ببصمة الحمولة ومهلة
 *     قصيرة، ويُمسح عند حسم الناتج. تغيّر أي حقل من الحمولة = نية جديدة = مفتاح جديد؛ لأن الخادم يعيد **الأثر الأول** لأي مفتاح موجود
 *     (حتى لو اختلف المبلغ أو كانت الوردية قد أُغلقت) فلا يجوز أبداً إعادة استعمال مفتاح لحمولة مختلفة.
 *  3. **الإغلاق**: بلا مفتاح؛ محروس بحالة الوردية في الخادم (الإغلاق الثاني يُرفض) ويُتحقق بإعادة الجلب لا بإعادة الإرسال.
 * لا يُخزَّن هنا رمز أو بيانات شخصية: معرّفات وأرقام تشغيلية فقط، وتسقط بعد `INTENT_TTL_MS`.
 */

export const INTENT_TTL_MS = 30 * 60_000;
const PREFIX = 'awj:fuel-ops:intent:';

interface StoredIntent { key: string; fingerprint: string; at: number; /** محاولة سابقة انتهت غير مؤكدة: المفتاح يبقى ثابتاً (لا TTL) حتى تُحسم النية. */ uncertain?: boolean }

export interface IntentStore {
  /** المفتاح الحالي للنية `name` إن بقيت الحمولة نفسها وصالحة زمنياً، وإلا مفتاح جديد. */
  keyFor(name: string, payload: unknown): string;
  /** يُعلِّم النية «غير مؤكدة» (قد تكون التزمت في الخادم): يبقى مفتاحها ثابتاً مهما طال الزمن وعبر إعادة التحميل، ولا يمسحه إلا `clear` بعد الحسم. */
  markUncertain(name: string): void;
  isUncertain(name: string): boolean;
  /** يُستدعى عند حسم الناتج (نجاح مؤكد أو رفض نهائي). لا يُستدعى عند «غير مؤكد» — فالإعادة تحتاج المفتاح نفسه. */
  clear(name: string): void;
}

function defaultGenerate(): string {
  return crypto.randomUUID();
}

export function createIntentStore(scope: string, options: { storage?: Storage | null; now?: () => number; generate?: () => string } = {}): IntentStore {
  const now = options.now ?? Date.now;
  const generate = options.generate ?? defaultGenerate;
  const memory = new Map<string, StoredIntent>();
  let storage: Storage | null;
  try {
    storage = options.storage === undefined ? (typeof window === 'undefined' ? null : window.sessionStorage) : options.storage;
  } catch {
    storage = null;
  }
  const slot = (name: string) => `${PREFIX}${scope}:${name}`;

  function read(name: string): StoredIntent | null {
    const fromMemory = memory.get(name);
    if (fromMemory) return fromMemory;
    try {
      const raw = storage?.getItem(slot(name));
      if (!raw) return null;
      const parsed = JSON.parse(raw) as Partial<StoredIntent>;
      if (typeof parsed.key === 'string' && typeof parsed.fingerprint === 'string' && typeof parsed.at === 'number') return parsed as StoredIntent;
    } catch {
      // تخزين محجوب/تالف ⇒ كأنه غير موجود.
    }
    return null;
  }

  return {
    keyFor(name, payload) {
      const fingerprint = JSON.stringify(payload);
      const current = read(name);
      // TTL للنية المحسومة/غير المستخدمة فقط؛ غير المؤكدة لا ينتهي مفتاحها بمرور الوقت (الزمن ليس دليلاً على أن الكتابة لم تحدث).
      if (current && current.fingerprint === fingerprint && (current.uncertain === true || now() - current.at < INTENT_TTL_MS)) return current.key;
      const next: StoredIntent = { key: `awj-ops-${generate()}`, fingerprint, at: now() };
      memory.set(name, next);
      try {
        storage?.setItem(slot(name), JSON.stringify(next));
      } catch {
        // لا مساحة/محجوب: يبقى المفتاح في الذاكرة لهذه الصفحة.
      }
      return next.key;
    },
    markUncertain(name) {
      const current = read(name);
      if (!current) return;
      const next = { ...current, uncertain: true };
      memory.set(name, next);
      try {
        storage?.setItem(slot(name), JSON.stringify(next));
      } catch {
        // يبقى في الذاكرة
      }
    },
    isUncertain(name) {
      return read(name)?.uncertain === true;
    },
    clear(name) {
      memory.delete(name);
      try {
        storage?.removeItem(slot(name));
      } catch {
        // لا شيء
      }
    },
  };
}

export type ReadingKind = 'meter' | 'tank';
export type ReadingStage = 'opening' | 'closing';

/** مفتاح دليل حتمي (≤ 128 حرفاً حدّ الخادم). الثلاثي (وردية، أصل، مرحلة) فريد في الخادم فلا حاجة لعشوائية. */
export function evidenceKey(kind: ReadingKind, shiftId: string, assetId: string, stage: ReadingStage): string {
  const key = `awj-ops:${kind === 'meter' ? 'm' : 't'}:${shiftId}:${assetId}:${stage}`;
  if (key.length > 128) throw new Error('evidence key exceeds the server limit');
  return key;
}
