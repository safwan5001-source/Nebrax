/**
 * إسكات محلي لكل جهاز (COPS-H3-3): «إقرار الجهاز» قبل الإقرار الخادمي لكل طلب (H3-4). يعيش في `localStorage` المشترك بين تبويبات الأصل نفسه، ويُنظَّف بعد 48 ساعة
 * (نافذة الانتباه). لا يغيّر حالة الطلب ولا يخرجه من قوائم العمل — يستبعده من «ما يستدعي التنبيه» على هذا الجهاز فقط.
 */
export interface SilenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const SILENCE_TTL_MS = 48 * 60 * 60 * 1000;

export class SilencedStore {
  constructor(
    private readonly storage: SilenceStorage | null,
    private readonly scope: string,
    private readonly now: () => number = () => Date.now(),
  ) {}

  /**
   * نسخة الذاكرة (احتياط حين يفشل التخزين: حصة ممتلئة/محجوب). تُدمج مع المخزَّن عند القراءة فيعمل الإسكات
   * في هذا التبويب ولو تعذّر الحفظ، وتستقبل معرّفات البث من التبويبات الأخرى.
   */
  private readonly memory = new Map<string, number>();

  private key(): string {
    return `awj:commerce-alerts:silenced:${this.scope}`;
  }

  private read(): Record<string, number> {
    try {
      const raw = this.storage?.getItem(this.key());
      const parsed = raw ? (JSON.parse(raw) as unknown) : {};
      if (typeof parsed !== 'object' || parsed === null) return {};
      const out: Record<string, number> = {};
      const cutoff = this.now() - SILENCE_TTL_MS;
      for (const [id, ts] of Object.entries(parsed as Record<string, unknown>)) {
        if (typeof ts === 'number' && ts >= cutoff) out[id] = ts;
      }

      return out;
    } catch {
      return {};
    }
  }

  ids(): ReadonlySet<string> {
    const out = this.read();
    const cutoff = this.now() - SILENCE_TTL_MS;
    for (const [id, ts] of this.memory) {
      if (ts < cutoff) this.memory.delete(id);
      else if (!(id in out)) out[id] = ts;
    }

    return new Set(Object.keys(out));
  }

  /** معرّفات وصلت عبر البث من تبويب آخر (قد لا يصلنا مخزّنها): تُحفظ في الذاكرة. */
  absorb(ids: string[]): void {
    const stamp = this.now();
    for (const id of ids) this.memory.set(id, stamp);
  }

  add(ids: string[]): void {
    if (ids.length === 0) return;
    const current = this.read();
    const stamp = this.now();
    for (const id of ids) {
      current[id] = stamp;
      this.memory.set(id, stamp);
    }
    try {
      this.storage?.setItem(this.key(), JSON.stringify(current));
    } catch {
      // تخزين ممتلئ/محجوب: الإسكات يبقى في ذاكرة التبويب (memory) ويصل غيرَه بالبث.
    }
  }
}

/** مؤشّر التغذية المحفوظ لكل (مستأجر، مستخدم) — بلا مؤشّر ⇒ الرأس (D-H3-02). */
export function cursorStore(storage: SilenceStorage | null, scope: string): { load: () => number | null; save: (seq: number) => void } {
  const key = `awj:commerce-alerts:cursor:${scope}`;

  return {
    load: () => {
      try {
        const raw = storage?.getItem(key);
        const n = raw === null || raw === undefined ? NaN : Number(raw);

        return Number.isInteger(n) && n >= 0 ? n : null;
      } catch {
        return null;
      }
    },
    save: (seq) => {
      try {
        storage?.setItem(key, String(seq));
      } catch {
        // لا يمنع الاستطلاع؛ الجهاز يبدأ من الرأس عند فقد المؤشّر.
      }
    },
  };
}
