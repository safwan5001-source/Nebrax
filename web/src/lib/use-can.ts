'use client';

import { useEffect, useMemo, useSyncExternalStore } from 'react';
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

/**
 * يعيد قراءة `/me` عند تركيب الغلاف وعند عودة التركيز/الظهور للتبويب، ويحدّث الدور والصلاحيات المخزَّنة
 * إن تغيّرت فقط. فشل الشبكة أو استجابة غير صالحة تُتجاهل بصمت — لا يُمسّ المخزَّن ولا يُسجَّل الخروج
 * من هنا (ذلك شأن طبقة `api` عند 401).
 */
export function usePermissionRefresh(enabled: boolean): void {
  useEffect(() => {
    if (!enabled || isDemo()) return;
    let inFlight = false;
    let lastStartedAt = 0;
    let disposed = false;

    const refresh = (force: boolean) => {
      const now = Date.now();
      if (inFlight || (!force && now - lastStartedAt < PERMISSION_REFRESH_MIN_INTERVAL_MS)) return;
      inFlight = true;
      lastStartedAt = now;
      api<{ user?: Partial<AuthUser> }>('/me')
        .then((response) => {
          if (disposed) return;
          const next = mergeRefreshedAccess(currentUser(), response?.user);
          if (next) persistUser(next, { applyDisplayPreferences: false });
        })
        .catch(() => {})
        .finally(() => {
          inFlight = false;
        });
    };

    const onFocus = () => refresh(false);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh(false);
    };

    refresh(true);
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled]);
}
