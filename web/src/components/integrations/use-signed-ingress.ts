'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import { readBranchOptions, type BranchOption } from '@/lib/ingress-create';
import { hasPermission } from '@/lib/permissions';
import {
  BRANCHES_VIEW_PERMISSION,
  SIGNED_INGRESS_VIEW_PERMISSION,
  readBranchNames,
  readIngressPoints,
  type IngressPoint,
} from '@/lib/signed-ingress';

export type SignedIngressState =
  /** لا قراءة: الصفحة لم تُتح بعد، أو لا صلاحية `delivery_connector.view` (اللوحة غائبة، لا معطّلة). */
  | { status: 'idle' }
  | { status: 'loading' }
  /** `branchNames === null` = لا `branches.view` أو تعذّرت قراءة الفروع؛ الوصف المحايد/«غير متاح» يتكفّل به `branchLabel`. */
  | { status: 'ready'; points: IngressPoint[]; canViewBranches: boolean; branchNames: Map<string, string> | null }
  /** رفض الخادم (صلاحية أو قدرة POS): ليس «لا توجد نقاط». */
  | { status: 'forbidden' }
  /** فشل شبكة/خادم أو حمولة لا تُقرأ: ليس «لا توجد نقاط». */
  | { status: 'error' };

/**
 * قراءة نقاط الاستقبال الموقّعة لمنصة واحدة (INT-UX-4) — **قراءتان بـGET فقط**:
 * `GET /delivery-connectors` (`delivery_connector.view` + قدرة `sales.pos`)، ثم `GET /branches` فقط إن وُجدت
 * نقطة موجّهة إلى فرع **و** كانت `branches.view` ممنوحة. بلا الصلاحية الأولى صفر طلبات.
 * الصلاحيات من قائمة الخادم (`hasPermission`) لا من اسم الدور. الخادم يبقى السلطة (يصفّي المؤسسة والفروع
 * المسموحة)، ورفضه 403 يظهر «رفض» لا «فراغ». `reloadKey` يعيد القراءة مع إعادة محاولة الصفحة الأم.
 */
export function useSignedIngress(platformKey: string, enabled: boolean, reloadKey = 0) {
  const [state, setState] = useState<SignedIngressState>({ status: 'idle' });
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'idle' });
      return;
    }
    const user = currentUser();
    if (!hasPermission(user?.permissions, user?.role, SIGNED_INGRESS_VIEW_PERMISSION)) {
      setState({ status: 'idle' });
      return;
    }
    const canViewBranches = hasPermission(user?.permissions, user?.role, BRANCHES_VIEW_PERMISSION);

    let cancelled = false;
    setState({ status: 'loading' });
    (async () => {
      let points: IngressPoint[] | null;
      try {
        points = readIngressPoints(await api<unknown>('/delivery-connectors'), platformKey);
      } catch (error) {
        if (cancelled) return;
        setState({ status: (error as { status?: unknown } | null)?.status === 403 ? 'forbidden' : 'error' });
        return;
      }
      if (cancelled) return;
      if (points === null) {
        setState({ status: 'error' });
        return;
      }

      let branchNames: Map<string, string> | null = null;
      if (canViewBranches && points.some((point) => point.branchId !== null)) {
        branchNames = await api<unknown>('/branches').then(readBranchNames, () => null);
        if (cancelled) return;
      }
      setState({ status: 'ready', points, canViewBranches, branchNames });
    })();

    return () => {
      cancelled = true;
    };
  }, [platformKey, enabled, attempt, reloadKey]);

  return { state, retry };
}

export type BranchOptionsState =
  /** لا `branches.view` أو الحوار مغلق: لا قراءة، ولا حقل فرع. */
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; options: BranchOption[] }
  /** تعذّرت القراءة: ليس «لا فروع». */
  | { status: 'error' };

/**
 * خيارات الفرع لنموذج إنشاء نقطة الاستقبال (INT-UX-5c): قراءة `GET /branches` **عند فتح النموذج فقط** وبـ`branches.view` وحدها.
 * الخادم يصفّي القائمة بنطاق المستخدم، لكنها للراحة لا للحكم: قبول الفرع أو رفضه عند الإنشاء من اختصاص الخادم. `reloadKey`
 * يعيد القراءة (زرّ إعادة المحاولة في النموذج: قراءة لا كتابة).
 */
export function useBranchOptions(enabled: boolean, reloadKey = 0): BranchOptionsState {
  const [state, setState] = useState<BranchOptionsState>({ status: 'idle' });

  useEffect(() => {
    if (!enabled) {
      setState({ status: 'idle' });
      return;
    }
    const user = currentUser();
    if (!hasPermission(user?.permissions, user?.role, BRANCHES_VIEW_PERMISSION)) {
      setState({ status: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ status: 'loading' });
    api<unknown>('/branches').then(
      (payload) => {
        if (cancelled) return;
        const options = readBranchOptions(payload);
        setState(options === null ? { status: 'error' } : { status: 'ready', options });
      },
      () => {
        if (!cancelled) setState({ status: 'error' });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, reloadKey]);

  return state;
}
