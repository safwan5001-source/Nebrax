'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { currentUser } from '@/lib/auth';
import { checkStoreId } from '@/lib/ingress-create';
import { clearUnconfirmedCreate, createGuardScope, findUnconfirmedCreate, listUnconfirmedCreates, recordUnconfirmedCreate } from '@/lib/ingress-create-guard';
import { classifyIngressFailure, type IngressErrorKey } from '@/lib/ingress-management';
import { operatorChoices, operatorName, type OperatorEntry } from '@/lib/ingress-operators';
import { IngressRequestInvalid, IngressUnavailableInDemo, createIngressPoint, disableIngress, reassignIngressOperator, rotateIngressSecret } from '@/lib/ingress-operations';
import type { IngressPoint } from '@/lib/signed-ingress';
import type { OperatorDirectoryState, SignedIngressState } from './use-signed-ingress';

export type IngressDialogState = { kind: 'rotate' | 'disable'; point: IngressPoint } | null;

export type IngressNotice =
  | { kind: 'error'; messageKey: IngressErrorKey }
  | { kind: 'rotated' | 'disabled' | 'created' | 'createLost' | 'createUnconfirmed'; storeId: string }
  /** `operatorName`: اسم المشغّل الجديد فقط (لا بريد ولا معرّف). */
  | { kind: 'reassigned'; storeId: string; operatorName: string };

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
  /** معرّفات متاجر هذه المنصة التي نتيجة إنشائها السابق لم تتأكد: لا يُعاد إرسالها (الحارس في ذاكرة الصفحة فقط، يزول بإعادة التحميل). */
  blockedStoreIds: string[];
  /** هل المعرّف المكتوب (بعد القصّ) محظور؟ */
  isCreateBlocked: (storeId: string) => boolean;
  /** دليل المشغّلين (reassign + users.view فقط) وإعادة قراءته. */
  operators: OperatorDirectoryState;
  retryOperators: () => void;
  /** المرشّحون القابلون للاختيار لنقطة (مؤهلون، دون المشغّل الحالي، **واسمهم غير ملتبس**) — فارغة إن لم يجهز الدليل. */
  eligibleFor: (point: IngressPoint) => OperatorEntry[];
  /** أسماء المؤهلين الذين استُبعدوا لتطابق الاسم (للتنبيه فقط؛ لا معرّفات). */
  ambiguousFor: (point: IngressPoint) => string[];
  /** اسم المشغّل الحالي لنقطة، أو `null` إن لم يُعرف. */
  currentOperatorName: (point: IngressPoint) => string | null;
  /** نقطة حوار إعادة الإسناد المفتوح، وآخر رفض صريح (يبقى الحوار مفتوحاً للتصحيح). */
  reassignPoint: IngressPoint | null;
  reassignError: IngressErrorKey | null;
  openReassign: (point: IngressPoint) => void;
  cancelReassign: () => void;
  /** يُنفَّذ مرة واحدة؛ لا إعادة محاولة تلقائية. `userId` يجب أن يكون من المرشّحين المؤهلين. */
  confirmReassign: (userId: string) => void;
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
export function useIngressManagement(
  reload: () => void,
  profileId: string | null = null,
  platformKey = '',
  operators: OperatorDirectoryState = { status: 'idle' },
  retryOperators: () => void = () => {},
): IngressManagement {
  const [reassignPoint, setReassignPoint] = useState<IngressPoint | null>(null);
  const [reassignError, setReassignError] = useState<IngressErrorKey | null>(null);
  const operatorsRef = useRef(operators);
  operatorsRef.current = operators;
  const retryOperatorsRef = useRef(retryOperators);
  retryOperatorsRef.current = retryOperators;
  const [guardTick, setGuardTick] = useState(0);
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

  const blockedStoreIds = useMemo(
    () => listUnconfirmedCreates(createGuardScope(currentUser()), platformKey).map((entry) => entry.storeId),
    // `guardTick` يعلن تغيّر الحارس الخارجي (ذاكرة الوحدة).
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [guardTick, platformKey],
  );
  const isCreateBlocked = useCallback(
    (storeId: string) => findUnconfirmedCreate(createGuardScope(currentUser()), platformKey, storeId) !== null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [platformKey, guardTick],
  );

  const eligibleFor = useCallback(
    (point: IngressPoint) => (operators.status === 'ready' ? operatorChoices(operators.entries, point, point.operatedBy).selectable : []),
    [operators],
  );
  const ambiguousFor = useCallback(
    (point: IngressPoint) => (operators.status === 'ready' ? operatorChoices(operators.entries, point, point.operatedBy).ambiguousNames : []),
    [operators],
  );
  const currentOperatorName = useCallback(
    (point: IngressPoint) => (operators.status === 'ready' ? operatorName(operators.entries, point.operatedBy) : null),
    [operators],
  );

  const openReassign = useCallback((point: IngressPoint) => {
    if (lock.current) return;
    setNotice(null);
    setReassignError(null);
    setReassignPoint(point);
  }, []);

  const cancelReassign = useCallback(() => {
    if (lock.current) return;
    setReassignPoint(null);
    setReassignError(null);
  }, []);

  const confirmReassign = useCallback((userId: string) => {
    if (lock.current || reassignPoint === null) return;
    const point = reassignPoint;
    // المرشّح يجب أن يكون من القابلين للاختيار المعروضين (الدليل جاهز): معرّف خارجهم — غير مؤهل أو **مستبعد لتطابق الاسم** — لا يُرسل أبداً
    // مهما كان مصدر الاستدعاء. الخادم يبقى المرجع النهائي.
    const current = operatorsRef.current;
    const candidate = current.status === 'ready' ? operatorChoices(current.entries, point, point.operatedBy).selectable.find((entry) => entry.id === userId) : undefined;
    if (candidate === undefined) return;
    lock.current = true;
    setBusy(true);
    setReassignError(null);
    (async () => {
      try {
        await reassignIngressOperator(point.id, candidate.id);
        if (!mounted.current) return;
        setReassignPoint(null);
        setNotice({ kind: 'reassigned', storeId: point.storeId, operatorName: candidate.name });
        reloadRef.current();
      } catch (error) {
        if (!mounted.current) return;
        if (error instanceof IngressUnavailableInDemo) {
          setReassignPoint(null);
          setNotice({ kind: 'error', messageKey: 'demoUnavailable' });
          return;
        }
        if (error instanceof IngressRequestInvalid) {
          setReassignError('validation');
          return;
        }
        const failure = classifyIngressFailure(error, 'reassign');
        if (failure.outcomeUnknown) {
          // لا إعادة محاولة تلقائية: تُعاد قراءة القائمة ويقرّر المستخدم من المشغّل المعروض.
          setReassignPoint(null);
          setNotice({ kind: 'error', messageKey: 'reassignOutcomeUnknown' });
          reloadRef.current();
          return;
        }
        if (failure.messageKey === 'forbidden' || failure.messageKey === 'notFound' || failure.messageKey === 'connectorUnavailable') {
          // الصلاحية/النقطة تغيّرت: لا جدوى من إبقاء الحوار.
          setReassignPoint(null);
          setNotice({ kind: 'error', messageKey: failure.messageKey });
          reloadRef.current();
          return;
        }
        // رفض صريح (غير مؤهل/تحقق/تعارض): يبقى الحوار للتصحيح، ويُحدَّث دليل المشغّلين لأن الأهلية قد تغيّرت.
        setReassignError(failure.messageKey);
        if (failure.messageKey === 'operatorIneligible') retryOperatorsRef.current();
      } finally {
        lock.current = false;
        if (mounted.current) setBusy(false);
      }
    })();
  }, [reassignPoint]);

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
    // حماية من إعادة إرسال معرّف نتيجة إنشائه السابق لم تتأكد (الخادم قد يكون أنشأه ولو لم يظهر في القائمة): لا طلب أبداً.
    if (findUnconfirmedCreate(createGuardScope(currentUser()), platformKey, storeId) !== null) {
      setCreateError('createBlocked');
      return;
    }
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
          recordUnconfirmedCreate(createGuardScope(currentUser()), { platformKey, profileId, storeId, at: Date.now() });
          setGuardTick((value) => value + 1);
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
  }, [createOpen, platformKey, profileId]);

  const observe = useCallback((state: SignedIngressState) => {
    lastState.current = state;
    // ظهور نقطة بمعرّف محظور في قائمة جديدة (من أي قراءة) يرفع حظر ذلك المعرّف: النقطة صارت مرئية ومعروفة (وإعادة الإنشاء ترُدّ 409).
    // **غيابها لا يرفع شيئاً** (قد تحجبها الفروع).
    if (state.status === 'ready') {
      const scope = createGuardScope(currentUser());
      let lifted = false;
      for (const entry of listUnconfirmedCreates(scope, platformKey)) {
        if (state !== pendingCreate.current?.stale && state.points.some((point) => point.storeId === entry.storeId)) {
          clearUnconfirmedCreate(scope, platformKey, entry.storeId);
          lifted = true;
        }
      }
      if (lifted) setGuardTick((value) => value + 1);
    }
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
    if (born !== undefined && born.status === 'configured' && born.secretVersion === 1) {
      // هوية وحالة النقطة التي ظهرت مطابقتان لإنشاء لم يصل سرّه: الخطوة التالية تدوير سرّها (5b) يدوياً لا تلقائياً. ظهورها المتحقَّق وحده
      // يرفع حظر إعادة الإنشاء (فالنقطة معروفة وإعادة الإنشاء ترُدّ 409)؛ غيابها أو ظهورها بحالة غير متوقعة لا يرفعانه أبداً.
      setNotice({ kind: 'createLost', storeId: pending.storeId });
      return;
    }
    // **غياب النقطة عن القائمة لا يثبت أنها لم تُنشأ**: القائمة مقيّدة بنطاق فروع المستخدم، والخادم قد يكون أتمّ الإنشاء. فلا
    // يُستنتج فشل ولا يُشجَّع على إعادة الإنشاء؛ تُعرض رسالة محايدة بأن النتيجة لم تتأكد. (نقطة ظهرت بحالة/إصدار غير متوقعين: الحكم نفسه.)
    setNotice({ kind: 'createUnconfirmed', storeId: pending.storeId });
  }, [platformKey]);

  const dismissNotice = useCallback(() => setNotice(null), []);

  return {
    dialog, busy, reveal, notice, operators, retryOperators, eligibleFor, ambiguousFor, currentOperatorName, reassignPoint, reassignError, openReassign, cancelReassign, confirmReassign, blockedStoreIds, isCreateBlocked, createOpen, createError, openCreate, cancelCreate, confirmCreate, observe,
    openRotate, openDisable, cancel, confirmRotate, confirmDisable, closeReveal, dismissNotice,
  };
}
