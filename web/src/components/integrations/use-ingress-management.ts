'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { checkStoreId } from '@/lib/ingress-create';
import { classifyIngressFailure, type IngressErrorKey } from '@/lib/ingress-management';
import { IngressRequestInvalid, IngressUnavailableInDemo, createIngressPoint, disableIngress, rotateIngressSecret } from '@/lib/ingress-operations';
import type { IngressPoint } from '@/lib/signed-ingress';
import type { SignedIngressState } from './use-signed-ingress';

export type IngressDialogState = { kind: 'rotate' | 'disable'; point: IngressPoint } | null;

export type IngressNotice =
  | { kind: 'error'; messageKey: IngressErrorKey }
  | { kind: 'rotated' | 'disabled' | 'created' | 'createLost' | 'createAbsent'; storeId: string };

/** السرّ الجديد: يعيش هنا بين نجاح الإنشاء/التدوير وإغلاق حوار الكشف فقط، ثم يصير `null`. */
export interface IngressReveal {
  value: string;
  storeId: string;
  kind: 'created' | 'rotated';
}

export interface CreateIngressRequest {
  /** النص كما كتبه المستخدم؛ يُتحقق منه ويُقصّ هنا قبل الإرسال. */
  storeId: string;
  branchId: string | null;
}

export interface IngressManagement {
  dialog: IngressDialogState;
  busy: boolean;
  reveal: IngressReveal | null;
  notice: IngressNotice | null;
  /** حوار الإنشاء مفتوح؟ وآخر رفض صريح من الخادم (يبقى الحوار مفتوحاً للتصحيح). */
  createOpen: boolean;
  createError: IngressErrorKey | null;
  openCreate: () => void;
  cancelCreate: () => void;
  /** يُنفَّذ مرة واحدة؛ لا إعادة محاولة تلقائية. نتيجة مجهولة تغلق الحوار وتُعاد قراءة القائمة. */
  confirmCreate: (request: CreateIngressRequest) => void;
  /** تُستدعى من اللوحة مع كل حالة قراءة للقائمة: تحفظ المعروف، وتُسوّي إنشاءً مجهولاً بعد إعادة القراءة. */
  observe: (state: SignedIngressState) => void;
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
export function useIngressManagement(reload: () => void, profileId: string | null = null): IngressManagement {
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<IngressErrorKey | null>(null);
  const knownIds = useRef<Set<string>>(new Set());
  const lastState = useRef<SignedIngressState | null>(null);
  const pendingCreate = useRef<{ storeId: string; before: Set<string>; stale: SignedIngressState | null } | null>(null);
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
        setReveal({ value: rotated.value, storeId: point.storeId, kind: 'rotated' });
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
    if (reveal) {
      setNotice({ kind: reveal.kind, storeId: reveal.storeId });
      // الإنشاء: القائمة تُحدَّث **بعد** إغلاق حوار السرّ (لا قبله)، فلا تتحرك الشاشة خلف سرّ لم يُحفظ بعد.
      if (reveal.kind === 'created') reloadRef.current();
    }
    setReveal(null);
  }, [reveal]);

  const openCreate = useCallback(() => {
    if (lock.current) return;
    setNotice(null);
    setCreateError(null);
    setCreateOpen(true);
  }, []);

  const cancelCreate = useCallback(() => {
    if (lock.current) return;
    setCreateOpen(false);
    setCreateError(null);
  }, []);

  const confirmCreate = useCallback((request: CreateIngressRequest) => {
    if (lock.current || !createOpen) return;
    const checked = checkStoreId(request.storeId);
    if (!checked.ok) return;
    if (profileId === null) {
      setCreateError('profileUnavailable');
      return;
    }
    const storeId = checked.value;
    const before = new Set(knownIds.current);
    lock.current = true;
    setBusy(true);
    setCreateError(null);
    (async () => {
      try {
        const created = await createIngressPoint({ profileId, storeId, branchId: request.branchId });
        if (!mounted.current) return;
        setCreateOpen(false);
        setReveal({ value: created.value, storeId, kind: 'created' });
      } catch (error) {
        if (!mounted.current) return;
        if (error instanceof IngressUnavailableInDemo) {
          setCreateOpen(false);
          setNotice({ kind: 'error', messageKey: 'demoUnavailable' });
          return;
        }
        if (error instanceof IngressRequestInvalid) {
          setCreateError('validation');
          return;
        }
        const failure = classifyIngressFailure(error, 'create');
        if (failure.outcomeUnknown) {
          // الإنشاء غير idempotent: لا إعادة محاولة. تُقرأ القائمة لنعرف إن وُلدت النقطة ثم تُسوّى النتيجة في `observe`.
          setCreateOpen(false);
          setNotice({ kind: 'error', messageKey: failure.messageKey });
          pendingCreate.current = { storeId, before, stale: lastState.current };
          reloadRef.current();
          return;
        }
        // رفض صريح (لم يُنشأ شيء): يبقى الحوار مفتوحاً ليصحّح المستخدم ويرسل بقصد جديد.
        setCreateError(failure.messageKey);
      } finally {
        lock.current = false;
        if (mounted.current) setBusy(false);
      }
    })();
  }, [createOpen, profileId]);

  const observe = useCallback((state: SignedIngressState) => {
    lastState.current = state;
    const pending = pendingCreate.current;
    if (pending === null) {
      if (state.status === 'ready') knownIds.current = new Set(state.points.map((point) => point.id));
      return;
    }
    // القائمة المعروضة لحظة الفشل قديمة (الحالة نفسها بالهوية): لا تُسوّى النتيجة إلا بقراءة جديدة. لا نعتمد على رؤية حالة
    // «التحميل» لأن React قد يدمج التحميل والجاهزية في رسم واحد.
    if (state === pending.stale || state.status === 'loading' || state.status === 'idle') return;
    pendingCreate.current = null;
    if (state.status !== 'ready') return; // تعذّرت إعادة القراءة: يبقى إشعار «النتيجة مجهولة» كما هو.
    knownIds.current = new Set(state.points.map((point) => point.id));
    const born = state.points.find((point) => point.storeId === pending.storeId && !pending.before.has(point.id));
    if (born === undefined) {
      setNotice({ kind: 'createAbsent', storeId: pending.storeId });
    } else if (born.status === 'configured' && born.secretVersion === 1) {
      // هوية وحالة النقطة التي ظهرت مطابقتان لإنشاء لم يصل سرّه: الخطوة التالية تدوير سرّها (5b) لا تلقائياً.
      setNotice({ kind: 'createLost', storeId: pending.storeId });
    }
  }, []);

  const dismissNotice = useCallback(() => setNotice(null), []);

  return {
    dialog, busy, reveal, notice, createOpen, createError, openCreate, cancelCreate, confirmCreate, observe,
    openRotate, openDisable, cancel, confirmRotate, confirmDisable, closeReveal, dismissNotice,
  };
}
