/**
 * طابور القرارات الفردية (IMP-PS-A4b) — **صغير ومحدود وبلا ذكاء مالي**: يسلسل `POST …/decisions` واحداً واحداً، ويبقى دون حدّ الخادم (60/د) بنافذة منزلقة
 * (افتراضياً 50 لترك هامش لمراجعين/تبويبات أخرى)، ويمنع التكرار بالمفتاح، ويعيد المحاولة **عند 429 فقط** بتراجع محدود. ثوابت مقصودة:
 *  - **لا إعادة إرسال صامتة لقرار مالي**: أي فشل غير 429 (409/422/403/شبكة/…) يُنهي المهمة بخطأ ظاهر؛ إعادة المحاولة بعده فعلُ مستخدم صريح (`enqueue` جديد).
 *    (الخادم idempotent لقرار مطابق فتكرار 429 آمن؛ أما انقطاع الشبكة فنتيجته مجهولة فلا نعيد تلقائياً.)
 *  - **لا إخفاء للتعارض**: 409 يُرفع كما هو ليُحدَّث الحال من الخادم.
 *  - **لا قرار بلا طلب**: النجاح يُعلَن فقط بعد ردّ الخادم؛ الواجهة لا تُظهر السطر «محسوماً» قبله.
 * الزمن والإرسال محقونان للاختبار (لا مؤقتات حقيقية في الوحدات).
 */
import { ApiError } from '@/lib/api';
import { decisionKey } from './decision-rules';
import type { DecisionRequest, DecisionResponse } from './types';

export type JobStatus = 'queued' | 'sending' | 'backoff' | 'done' | 'failed';

export interface QueueJob {
  key: string;
  lineId: string;
  request: DecisionRequest;
  status: JobStatus;
  attempts: number;
  /** ثوانٍ حتى إعادة المحاولة عند `backoff`. */
  retryInSeconds: number | null;
  error: unknown;
  result: DecisionResponse | null;
}

export interface QueueOptions {
  send: (request: DecisionRequest) => Promise<DecisionResponse>;
  /** نافذة منزلقة: أقصى عدد إرسالات خلال `windowMs`. */
  maxPerWindow?: number;
  windowMs?: number;
  /** تأخيرات إعادة المحاولة عند 429 (طولها = أقصى محاولات إعادة). */
  backoffMs?: readonly number[];
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  onChange?: (jobs: readonly QueueJob[]) => void;
}

export const DEFAULT_BACKOFF_MS = [8_000, 16_000, 32_000] as const;

export class DecisionQueue {
  private readonly jobs = new Map<string, QueueJob>();
  private readonly promises = new Map<string, Promise<QueueJob>>();
  private readonly pending: string[] = [];
  private readonly sentAt: number[] = [];
  private draining = false;

  private readonly send: QueueOptions['send'];
  private readonly maxPerWindow: number;
  private readonly windowMs: number;
  private readonly backoffMs: readonly number[];
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly onChange?: QueueOptions['onChange'];

  constructor(options: QueueOptions) {
    this.send = options.send;
    this.maxPerWindow = options.maxPerWindow ?? 50;
    this.windowMs = options.windowMs ?? 60_000;
    this.backoffMs = options.backoffMs ?? DEFAULT_BACKOFF_MS;
    this.now = options.now ?? (() => Date.now());
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.onChange = options.onChange;
  }

  /**
   * يضيف قراراً. نفس المفتاح قيد الانتظار/الإرسال/الإعادة ⇒ يُعاد وعد المهمة نفسها (لا إرسال ثانٍ). مهمة منتهية (نجاح/فشل) بالمفتاح نفسه تُستبدل بمهمة جديدة:
   * هذا هو «إعادة المحاولة اليدوية» أو قرار جديد بالقيم ذاتها بعد إعادة التحميل.
   */
  enqueue(request: DecisionRequest): Promise<QueueJob> {
    const key = decisionKey(request);
    const existing = this.jobs.get(key);
    if (existing && (existing.status === 'queued' || existing.status === 'sending' || existing.status === 'backoff')) {
      return this.promises.get(key) as Promise<QueueJob>;
    }

    const job: QueueJob = { key, lineId: request.line_id, request, status: 'queued', attempts: 0, retryInSeconds: null, error: null, result: null };
    this.jobs.set(key, job);
    const promise = new Promise<QueueJob>((resolve) => {
      this.resolvers.set(key, resolve);
    });
    this.promises.set(key, promise);
    this.pending.push(key);
    this.emit();
    void this.drain();
    return promise;
  }

  private readonly resolvers = new Map<string, (job: QueueJob) => void>();

  /** حالة سطر: آخر مهمة له (النشطة أولاً). */
  jobFor(lineId: string): QueueJob | null {
    let found: QueueJob | null = null;
    for (const job of this.jobs.values()) {
      if (job.lineId !== lineId) continue;
      if (!found || job.status === 'queued' || job.status === 'sending' || job.status === 'backoff') found = job;
      else if (found.status === 'done' || found.status === 'failed') found = job;
    }
    return found;
  }

  snapshot(): QueueJob[] {
    return Array.from(this.jobs.values()).map((job) => ({ ...job }));
  }

  /** يمسح المهام المنتهية (نجاح/فشل) — بعد أن أُعيد تحميل الحال من الخادم. */
  clearFinished(lineId?: string): void {
    for (const [key, job] of this.jobs) {
      if ((job.status === 'done' || job.status === 'failed') && (lineId === undefined || job.lineId === lineId)) {
        this.jobs.delete(key);
        this.promises.delete(key);
      }
    }
    this.emit();
  }

  get active(): boolean {
    return this.pending.length > 0 || this.draining;
  }

  private emit(): void {
    this.onChange?.(this.snapshot());
  }

  private finish(job: QueueJob, status: 'done' | 'failed'): void {
    job.status = status;
    job.retryInSeconds = null;
    this.emit();
    this.resolvers.get(job.key)?.({ ...job });
    this.resolvers.delete(job.key);
  }

  /** ينتظر حتى تتسع النافذة المنزلقة لإرسال جديد. */
  private async awaitWindow(): Promise<void> {
    for (;;) {
      const cutoff = this.now() - this.windowMs;
      while (this.sentAt.length > 0 && this.sentAt[0] <= cutoff) this.sentAt.shift();
      if (this.sentAt.length < this.maxPerWindow) return;
      await this.sleep(Math.max(50, this.sentAt[0] + this.windowMs - this.now()));
    }
  }

  private async drain(): Promise<void> {
    if (this.draining) return;
    this.draining = true;
    try {
      while (this.pending.length > 0) {
        const key = this.pending.shift() as string;
        const job = this.jobs.get(key);
        if (!job || job.status !== 'queued') continue;
        await this.run(job);
      }
    } finally {
      this.draining = false;
    }
  }

  private async run(job: QueueJob): Promise<void> {
    for (let retry = 0; ; retry += 1) {
      await this.awaitWindow();
      job.status = 'sending';
      job.attempts += 1;
      this.sentAt.push(this.now());
      this.emit();
      try {
        job.result = await this.send(job.request);
        job.error = null;
        this.finish(job, 'done');
        return;
      } catch (error) {
        job.error = error;
        const throttled = error instanceof ApiError && error.status === 429;
        if (!throttled || retry >= this.backoffMs.length) {
          this.finish(job, 'failed');
          return;
        }
        const wait = this.backoffMs[retry];
        job.status = 'backoff';
        job.retryInSeconds = Math.ceil(wait / 1000);
        this.emit();
        await this.sleep(wait);
      }
    }
  }
}
