'use client';

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { api } from './api';
import { currentUser, persistUser, type AuthUser } from './auth';
import { createCapabilities, type Capabilities } from './capabilities';
import { isDemo } from './demo';
import { mergeRefreshedAccess } from './permission-refresh';
import { AUTH_SESSION_CHANGED_EVENT, USER_CHANGED_EVENT } from './user-events';

function subscribeUser(onChange: () => void): () => void {
  window.addEventListener(USER_CHANGED_EVENT, onChange);
  window.addEventListener(AUTH_SESSION_CHANGED_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(USER_CHANGED_EVENT, onChange);
    window.removeEventListener(AUTH_SESSION_CHANGED_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

const subscribeNothing = () => () => {};

/** `false` أثناء العرض على الخادم وأول تصيير للترطيب، ثم `true` — يمنع اختلاف الترطيب (localStorage غائب خادمياً). */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribeNothing, () => true, () => false);
}

/** المستخدم المخزَّن تفاعلياً: يتحدّث عند الدخول/الخروج وعند تحديث الصلاحيات. `null` قبل الترطيب أو بلا جلسة. */
export function useCurrentUser(): AuthUser | null {
  return useSyncExternalStore(subscribeUser, currentUser, () => null);
}

export interface UseCan extends Capabilities<AuthUser> {
  /** اكتمل الترطيب: `viewer === null` بعدها تعني «لا جلسة» لا «لم يُقرأ بعد». */
  hydrated: boolean;
}

/**
 * مصدر القدرات الوحيد للشاشات: `const { can } = useCan()`.
 * المرجع ثابت ما دام المستخدم المخزَّن نفسه لم يتغيّر، فيصحّ وضعه في مصفوفات الاعتماد.
 */
export function useCan(): UseCan {
  const user = useCurrentUser();
  const hydrated = useHydrated();
  const capabilities = useMemo(() => createCapabilities<AuthUser>(user), [user]);
  return useMemo(() => ({ ...capabilities, hydrated }), [capabilities, hydrated]);
}

/** أقل فاصل بين قراءتين لـ`/me` من أحداث التركيز (الأولى عند التركيب غير مقيَّدة). */
export const PERMISSION_REFRESH_MIN_INTERVAL_MS = 30_000;

let refreshInFlight: Promise<void> | null = null;

/**
 * قراءة `/me` واحدة تُحدِّث الدور والصلاحيات **والنطاق** المخزَّنة إن تغيّرت فقط. طلبٌ واحد قيد التنفيذ يُشارَك بين كل
 * مستدعٍ (غلاف التطبيق و`useActorScope`)، فلا طلبان متزامنان. الفشل أو استجابة غير صالحة تُتجاهل بصمت — لا يُمسّ
 * المخزَّن ولا يُسجَّل الخروج من هنا (ذلك شأن طبقة `api` عند 401).
 */
export function refreshAccessFromMe(): Promise<void> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = api<{ user?: Partial<AuthUser> }>('/me')
    .then((response) => {
      const next = mergeRefreshedAccess(currentUser(), response?.user);
      if (next) persistUser(next, { applyDisplayPreferences: false });
    })
    .catch(() => {})
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

/** يعيد قراءة `/me` عند تركيب الغلاف وعند عودة التركيز/الظهور للتبويب (مع تقييد زمني للأحداث). */
export function usePermissionRefresh(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || isDemo()) return;
    let lastStartedAt = 0;

    const refresh = (force: boolean) => {
      const now = Date.now();
      if (refreshInFlight || (!force && now - lastStartedAt < PERMISSION_REFRESH_MIN_INTERVAL_MS)) return;
      lastStartedAt = now;
      void refreshAccessFromMe();
    };

    const onFocus = () => refresh(false);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh(false);
    };

    refresh(true);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled]);
}

export interface ActorScope {
  /** **الفراغ = غير مقيَّد** (كل الفروع)، لا «لا شيء». */
  branches: string[];
  warehouses: string[];
}

/**
 * نطاق المستخدم الحالي نفسه من `/me` (AC-UX-11) — بلا استنتاج من `GET /users` وبلا حاجة إلى `users.view`.
 *
 * - `undefined` = ما زال يُقرأ (أو لم يُرطَّب بعد)؛
 * - `null` = انتهت القراءة ولم يُعرف النطاق (فشل `/me` أو خادم لا يرسله) — يعامله المستدعي بحذر؛
 * - كائنٌ = معروف.
 *
 * يقرأ المخزَّن أولاً (يُملأ من تحديث الغلاف)، وإن لم يوجد يطلب `/me` بنفسه عبر الطلب المشترك — إلا إن مُرِّر `enabled: false`
 * (شاشةٌ لا تحتاج النطاق، كمشاهد قراءة فقط) فلا طلب إضافي. وضع المعاينة (demo)
 * مالكٌ غير مقيَّد. المرجع المُعاد ثابتٌ ما دامت المصفوفتان نفسيهما لم تتغيّرا. للعرض وحده — الخادم هو السلطة.
 */
export function useActorScope({ enabled = true }: { enabled?: boolean } = {}): ActorScope | null | undefined {
  const user = useCurrentUser();
  const hydrated = useHydrated();
  const [settled, setSettled] = useState(false);
  const demo = hydrated && isDemo();
  const branches = user?.branch_ids;
  const warehouses = user?.warehouse_ids;
  const known = Array.isArray(branches) && Array.isArray(warehouses);
  const userId = user?.id ?? null;

  useEffect(() => {
    if (!enabled || !hydrated || userId === null || known || demo) return;
    let live = true;
    void refreshAccessFromMe().finally(() => {
      if (live) setSettled(true);
    });
    return () => {
      live = false;
    };
  }, [enabled, hydrated, userId, known, demo]);

  const previous = useRef<ActorScope | null | undefined>(undefined);
  const next = useMemo<ActorScope | null | undefined>(() => {
    if (!hydrated) return undefined;
    if (demo) return { branches: [], warehouses: [] };
    if (userId === null) return null;
    if (Array.isArray(branches) && Array.isArray(warehouses)) return { branches, warehouses };
    return settled ? null : undefined;
  }, [hydrated, demo, userId, branches, warehouses, settled]);

  // ثبات بالقيمة: مصفوفاتٌ جديدة بالمحتوى نفسه (مثلاً بعد إعادة قراءة التخزين) لا تُنتج مرجعاً جديداً يُعيد تشغيل المستهلكين.
  const prior = previous.current;
  if (prior && next && prior.branches.join('\u0000') === next.branches.join('\u0000') && prior.warehouses.join('\u0000') === next.warehouses.join('\u0000')) {
    return prior;
  }
  previous.current = next;
  return next;
}
