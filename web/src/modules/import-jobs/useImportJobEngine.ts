/**
 * محرّك تشغيلة الاستيراد الدائم — طبقة واحدة تستهلكها شاشات الثلاثة مجالات
 * (كتالوج المنتجات، مصنّف Products/Barcodes/Unit Prices، الرصيد الافتتاحي).
 *
 * **الخادم مصدر الحقيقة الوحيد.** هذا الخيط لا يحسب مؤشّر استئناف ولا يفترض
 * تقدّماً — يقرأ `processed_rows`/`row_count`/`status` من كل استجابة ويعيد
 * عرضها فقط. عند شكٍّ في نتيجة شبكة (انقطاعٌ أثناء `/apply`)، يُعاد جلب
 * التشغيلة من الخادم قبل أي قرار — لا افتراض فشلٍ من مجرّد خطأ شبكة.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from '@/lib/api';
import {
  APPLICABLE_STATUSES,
  TERMINAL_STATUSES,
  applyImportJobChunk,
  cancelImportJob,
  createImportJob,
  getImportJob,
  type ApplyOptions,
  type ImportJob,
  type ImportJobDomain,
} from './client';

export type EngineBusy = 'uploading' | 'resuming' | 'applying' | 'cancelling' | null;

export interface ImportJobEngineState {
  job: ImportJob | null;
  busy: EngineBusy;
  /** خطأٌ نهائي (فشل تشغيلة أو رفض طلب) — يميَّز عن انقطاع شبكة غير محسوم. */
  error: string | null;
  /** شبكةٌ انقطعت أثناء نداء — الحالة الفعلية غير معروفة بعد، يُعاد الجلب قبل أي عرض جازم. */
  networkUncertain: boolean;
}

/** يميّز خطأ الشبكة (لا استجابة أصلاً) عن رفضٍ صريح من الخادم (`ApiError`). */
function isNetworkFailure(err: unknown): boolean {
  return !(err instanceof ApiError);
}

export function useImportJobEngine(domain: ImportJobDomain) {
  const [state, setState] = useState<ImportJobEngineState>({
    job: null,
    busy: null,
    error: null,
    networkUncertain: false,
  });

  // قفلٌ في الذاكرة لا في الحالة: يمنع نقرتين متسارعتين من إطلاق طلبين
  // متزامنين لنفس التشغيلة قبل أن يُعاد رسم الزر معطَّلاً.
  const inFlight = useRef(false);

  const setJob = useCallback((job: ImportJob) => {
    setState((current) => {
      // حالةٌ نهائية سابقة لا يجوز أن تُستبدَل بحالة عميل قديمة متأخرة —
      // لكن هذا التحديث نفسه دائماً من استجابة خادمٍ جديدة فلا تعارض هنا؛
      // الحارس الفعلي في `applyLoop`/`resume` أدناه (لا نداء بعد حالة نهائية).
      void current;
      return { job, busy: null, error: null, networkUncertain: false };
    });
  }, []);

  const resume = useCallback(async (jobId: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState((current) => ({ ...current, busy: 'resuming', error: null }));
    try {
      const job = await getImportJob(jobId);
      setJob(job);
    } catch (err) {
      setState((current) => ({
        ...current,
        busy: null,
        error: err instanceof ApiError ? err.message : null,
      }));
    } finally {
      inFlight.current = false;
    }
  }, [setJob]);

  const upload = useCallback(async (file: File, idempotencyKey?: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState({ job: null, busy: 'uploading', error: null, networkUncertain: false });
    try {
      const job = await createImportJob(domain, file, idempotencyKey);
      setJob(job);
      return job;
    } catch (err) {
      setState({
        job: null,
        busy: null,
        error: err instanceof ApiError ? err.message : String((err as Error)?.message ?? err),
        networkUncertain: false,
      });
      return null;
    } finally {
      inFlight.current = false;
    }
  }, [domain, setJob]);

  /**
   * قطعةٌ واحدة، ثم — لمجال الكتالوج المجزّأ فقط — استمرارٌ تلقائي حتى
   * `completed`/`failed`. المصنّف والرصيد الافتتاحي ذرّيان: أول استدعاء
   * يُنجز التشغيلة أو يفشلها، فلا حلقة فعلية تُنفَّذ لهما (نفس الشيفرة، دورة
   * واحدة فقط لأن `status` يصبح نهائياً من أول استجابة).
   */
  const applyLoop = useCallback(async (jobId: string, options: ApplyOptions) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState((current) => ({ ...current, busy: 'applying', error: null, networkUncertain: false }));

    let currentId = jobId;
    // سقفٌ احترازيٌّ صرف: التوقّف الطبيعي حالةٌ نهائية من الخادم بعد قطعةٍ
    // واحدة (مصنّف/افتتاحي) أو عشرات القطع (كتالوج). عدد أكبر بكثير يعني
    // استجابةً غير متوقَّعة (لا تحمل حالةً معروفة) — إيقافٌ آمن بدل حلقةٍ
    // بلا نهاية قد تجمّد التبويب.
    const MAX_ITERATIONS = 5000;
    let iterations = 0;
    try {
      // eslint-disable-next-line no-constant-condition
      while (true) {
        iterations += 1;
        if (iterations > MAX_ITERATIONS) {
          setState((current) => ({
            ...current,
            busy: null,
            error: 'تعذّر إحراز تقدّم في ترحيل التشغيلة — استجابةٌ غير متوقَّعة من الخادم.',
          }));
          return;
        }

        let job: ImportJob;
        try {
          job = await applyImportJobChunk(currentId, options);
        } catch (err) {
          if (isNetworkFailure(err)) {
            // انقطاعٌ غير محسوم: لا نفترض فشل التطبيق — نعيد قراءة التشغيلة
            // من الخادم لنعرف ما حدث فعلاً قبل أي قرار.
            setState((current) => ({ ...current, networkUncertain: true }));
            const reFetched = await getImportJob(currentId);
            if (TERMINAL_STATUSES.has(reFetched.status)) {
              setJob(reFetched);
              return;
            }
            // لا تزال قابلة للتطبيق (لم يلتزم شيء بعد، أو التزم واستؤنف
            // بأمان) — أعِد المحاولة من نفس المؤشّر الذي يملكه الخادم.
            setState((current) => ({ ...current, networkUncertain: false }));
            continue;
          }

          const message = err instanceof ApiError ? err.message : String((err as Error)?.message ?? err);
          setState((current) => ({ ...current, busy: null, error: message }));
          // نداءٌ رُفض صراحةً (422 مثلاً) يترك التشغيلة `failed` على الخادم
          // غالباً — أعِد جلبها كي تُعرَض حالتها النهائية الحقيقية لا تخميناً.
          try {
            const reFetched = await getImportJob(currentId);
            setState((current) => ({ ...current, job: reFetched }));
          } catch {
            /* تجاهل: الخطأ الأصلي أهمّ من فشل إعادة الجلب. */
          }
          return;
        }

        setState((current) => ({ ...current, job }));

        if (TERMINAL_STATUSES.has(job.status)) {
          setState((current) => ({ ...current, busy: null }));
          return;
        }

        // القطعة نجحت وما زالت `processing` — القادر الوحيد على معرفة إن
        // كان هناك مزيدٌ ليُطبَّق هو الخادم نفسه (`processed_rows < row_count`).
        if (job.row_count !== null && job.processed_rows >= job.row_count) {
          // احترازٌ فقط: عملياً `applyNextChunk` يعيد `completed` هنا أصلاً.
          setState((current) => ({ ...current, busy: null }));
          return;
        }
      }
    } finally {
      inFlight.current = false;
    }
  }, [setJob]);

  const cancel = useCallback(async (jobId: string) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setState((current) => ({ ...current, busy: 'cancelling', error: null }));
    try {
      const job = await cancelImportJob(jobId);
      setJob(job);
    } catch (err) {
      setState((current) => ({
        ...current,
        busy: null,
        error: err instanceof ApiError ? err.message : null,
      }));
    } finally {
      inFlight.current = false;
    }
  }, [setJob]);

  const reset = useCallback(() => {
    setState({ job: null, busy: null, error: null, networkUncertain: false });
  }, []);

  return {
    ...state,
    canApply: state.job !== null && APPLICABLE_STATUSES.has(state.job.status) && state.job.status !== 'completed',
    isTerminal: state.job !== null && TERMINAL_STATUSES.has(state.job.status),
    upload,
    resume,
    applyLoop,
    cancel,
    reset,
  };
}

/** يُبقي هوية التشغيلة في رابط الصفحة (`?job=<id>`) فتنجو من تحديث الصفحة. */
export function useImportJobUrlParam(paramName = 'job') {
  const getParam = useCallback((): string | null => {
    if (typeof window === 'undefined') return null;
    return new URLSearchParams(window.location.search).get(paramName);
  }, [paramName]);

  const setParam = useCallback((jobId: string | null) => {
    if (typeof window === 'undefined') return;
    const url = new URL(window.location.href);
    if (jobId) {
      url.searchParams.set(paramName, jobId);
    } else {
      url.searchParams.delete(paramName);
    }
    window.history.replaceState({}, '', url.toString());
  }, [paramName]);

  return { getParam, setParam };
}

/** يستدعي `resume` مرّةً عند التركيب إن وُجد معرّف تشغيلة في الرابط. */
export function useResumeFromUrl(
  resume: (jobId: string) => void,
  paramName = 'job'
): void {
  const { getParam } = useImportJobUrlParam(paramName);
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    const jobId = getParam();
    if (jobId) resume(jobId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
