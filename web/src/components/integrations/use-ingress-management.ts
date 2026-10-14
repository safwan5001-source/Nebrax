'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { classifyIngressFailure, type IngressErrorKey } from '@/lib/ingress-management';
import { IngressUnavailableInDemo, disableIngress, rotateIngressSecret } from '@/lib/ingress-operations';
import type { IngressPoint } from '@/lib/signed-ingress';

export type IngressDialogState = { kind: 'rotate' | 'disable'; point: IngressPoint } | null;

export type IngressNotice =
  | { kind: 'error'; messageKey: IngressErrorKey }
  | { kind: 'rotated' | 'disabled'; storeId: string };

/** السرّ الجديد: يعيش هنا بين نجاح التدوير وإغلاق حوار الكشف فقط، ثم يصير `null`. */
export interface IngressReveal {
  value: string;
  storeId: string;
}

export interface IngressManagement {
  dialog: IngressDialogState;
  busy: boolean;
  reveal: IngressReveal | null;
  notice: IngressNotice | null;
  openRotate: (point: IngressPoint) => void;
  openDisable: (point: IngressPoint) => void;
  /** يغلق حوار التأكيد؛ لا أثر أثناء تنفيذ الطلب. */
  cancel: () => void;
  confirmRotate: () => void;
  /** `typed` = ما كتبه المستخدم؛ لا ينفّذ إلا إن طابق معرّف المتجر حرفياً. */
  confirmDisable: (typed: string) => void;
  closeReveal: () => void;
  dismissNotice: () => void;
}

/**
 * إدارة نقطة الاستقبال الموقّعة (INT-UX-5b): تدوير السر وتعطيل النقطة فقط. `reload` يعيد قراءة قائمة النقاط.
 *
 * - **لا إرسال مزدوج:** قفل `useRef` يُرفع قبل أي `await`، فنقرتان متتاليتان قبل إعادة الرسم تُنتجان طلباً واحداً.
 * - **نتيجة مجهولة** (انقطاع/5xx/استجابة نجاح غير مفهومة): لا إعادة محاولة تلقائية ولا زرّ إعادة محاولة. يُعاد جلب
 *   القائمة فوراً؛ تختفي أزرار الصفوف أثناء إعادة الجلب (حالة تحميل) وتعود بالحالة الحقيقية فقط، فلا محاولة جديدة قبل رؤيتها.
 * - **السرّ:** لا يُكتب إلى أي تخزين ولا سجلّ، ويُمسح عند إغلاق حوار الكشف أو إلغاء تركيب الحوار الأم.
 */
export function useIngressManagement(reload: () => void): IngressManagement {
  const [dialog, setDialog] = useState<IngressDialogState>(null);
  const [busy, setBusy] = useState(false);
  const [reveal, setReveal] = useState<IngressReveal | null>(null);
  const [notice, setNotice] = useState<IngressNotice | null>(null);
  const lock = useRef(false);
  const mounted = useRef(true);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const openRotate = useCallback((point: IngressPoint) => {
    if (lock.current) return;
    setNotice(null);
    setDialog({ kind: 'rotate', point });
  }, []);

  const openDisable = useCallback((point: IngressPoint) => {
    if (lock.current) return;
    setNotice(null);
    setDialog({ kind: 'disable', point });
  }, []);

  const cancel = useCallback(() => {
    if (lock.current) return;
    setDialog(null);
  }, []);

  const fail = useCallback((error: unknown, operation: 'rotate' | 'disable') => {
    if (error instanceof IngressUnavailableInDemo) {
      setNotice({ kind: 'error', messageKey: 'demoUnavailable' });
      return;
    }
    const failure = classifyIngressFailure(error, operation);
    // التعطيل idempotent لكن النتيجة المجهولة لا تُعرض كـ«يمكنك إعادة المحاولة»: الحالة الحقيقية تُقرأ أولاً (D8).
    const messageKey = operation === 'disable' && failure.outcomeUnknown ? 'disableOutcomeUnknown' : failure.messageKey;
    setNotice({ kind: 'error', messageKey });
    // نتيجة مجهولة أو عنصر لم يعد متاحاً أو تعارض: الحالة الحقيقية تُقرأ من الخادم قبل أي إجراء تالٍ.
    if (failure.outcomeUnknown || failure.messageKey === 'notFound' || failure.messageKey === 'conflict' || failure.messageKey === 'connectorUnavailable') {
      reloadRef.current();
    }
  }, []);

  const confirmRotate = useCallback(() => {
    if (lock.current || dialog === null || dialog.kind !== 'rotate') return;
    const { point } = dialog;
    lock.current = true;
    setBusy(true);
    (async () => {
      try {
        const rotated = await rotateIngressSecret(point.id);
        if (!mounted.current) return;
        setDialog(null);
        setReveal({ value: rotated.value, storeId: point.storeId });
        reloadRef.current();
      } catch (error) {
        if (!mounted.current) return;
        setDialog(null);
        fail(error, 'rotate');
      } finally {
        lock.current = false;
        if (mounted.current) setBusy(false);
      }
    })();
  }, [dialog, fail]);

  const confirmDisable = useCallback((typed: string) => {
    if (lock.current || dialog === null || dialog.kind !== 'disable') return;
    const { point } = dialog;
    if (typed !== point.storeId) return;
    lock.current = true;
    setBusy(true);
    (async () => {
      try {
        await disableIngress(point.id);
        if (!mounted.current) return;
        setDialog(null);
        setNotice({ kind: 'disabled', storeId: point.storeId });
        reloadRef.current();
      } catch (error) {
        if (!mounted.current) return;
        setDialog(null);
        fail(error, 'disable');
      } finally {
        lock.current = false;
        if (mounted.current) setBusy(false);
      }
    })();
  }, [dialog, fail]);

  const closeReveal = useCallback(() => {
    if (reveal) setNotice({ kind: 'rotated', storeId: reveal.storeId });
    setReveal(null);
  }, [reveal]);

  const dismissNotice = useCallback(() => setNotice(null), []);

  return { dialog, busy, reveal, notice, openRotate, openDisable, cancel, confirmRotate, confirmDisable, closeReveal, dismissNotice };
}
