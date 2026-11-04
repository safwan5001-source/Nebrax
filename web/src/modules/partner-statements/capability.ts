'use client';

/**
 * حالة قدرة `accounting.partner_statements` للشاشة — **ثلاثة مصادر مرتّبة، والخادم هو الحَكَم دائماً**:
 *  1. `GET /applications` (من يملك `apps.view`): الحالة الصريحة `enabled | suspended | disabled`.
 *  2. `GET /applications/nav-state` (كل الأدوار): `false` ⇒ القدرة غير متاحة فعلياً (معطّلة أو بلا استحقاق).
 *  3. رفض 403 فعلي من نداء الشاشة (`markFromError`): يُقدَّم على ما سبق لأنه ما قاله الخادم الآن.
 * فشل قراءة المصدرين الأولين لا يُخفي الشاشة (نفس سياسة الشريط الجانبي): نفترض `enabled` ونترك الحارس الخادمي يحسم.
 * الظهور في الواجهة ليس تفويضاً: أزرار الكتابة تُشترط فيها الصلاحية **و**الحالة `enabled`.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useCan } from '@/lib/use-can';
import { APP_KEY } from './contract';
import { describeError } from './errors';

export type CapabilityState = 'enabled' | 'suspended' | 'disabled';

export function resolveCapability(input: {
  appStatus?: CapabilityState | null;
  navVisible?: boolean | null;
  observed?: CapabilityState | null;
}): CapabilityState {
  if (input.observed) return input.observed;
  if (input.appStatus) return input.appStatus;
  if (input.navVisible === false) return 'disabled';
  return 'enabled';
}

function readStatus(payload: unknown): CapabilityState | null {
  const data = (payload as { data?: unknown } | null)?.data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const status = (data as Record<string, { status?: unknown }>)[APP_KEY]?.status;
  return status === 'enabled' || status === 'suspended' || status === 'disabled' ? status : null;
}

export interface PartnerStatementsCapability {
  state: CapabilityState;
  /** اكتملت قراءة المصادر (نجاحاً أو فشلاً) — قبلها لا نحكم بمنع. */
  settled: boolean;
  /** يُسجَّل رفض 403 فعلي من نداء الشاشة كحالة ملاحَظة. */
  observe: (error: unknown) => void;
  canView: boolean;
  /** كتابة الاستيراد: صلاحية `reconcile` **و**قدرة `enabled` (الموقوفة قراءة فقط). */
  canImport: boolean;
}

export function usePartnerStatementsCapability(): PartnerStatementsCapability {
  const { can, hydrated } = useCan();
  const canManageApps = can('apps.view');
  const [appStatus, setAppStatus] = useState<CapabilityState | null>(null);
  const [navVisible, setNavVisible] = useState<boolean | null>(null);
  const [observed, setObserved] = useState<CapabilityState | null>(null);
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (!hydrated) return;
    let live = true;
    const requests: Promise<unknown>[] = [
      api<{ data?: Record<string, boolean> }>('/applications/nav-state')
        .then((response) => {
          if (!live || !response?.data || Array.isArray(response.data)) return;
          setNavVisible(response.data[APP_KEY] ?? null);
        })
        .catch(() => {}),
    ];
    if (canManageApps) {
      requests.push(
        api<unknown>('/applications')
          .then((response) => {
            if (live) setAppStatus(readStatus(response));
          })
          .catch(() => {}),
      );
    }
    void Promise.all(requests).finally(() => {
      if (live) setSettled(true);
    });
    return () => {
      live = false;
    };
  }, [hydrated, canManageApps]);

  const observe = useCallback((error: unknown) => {
    const descriptor = describeError(error);
    if (descriptor.kind === 'disabled') setObserved('disabled');
    else if (descriptor.kind === 'suspended') setObserved('suspended');
  }, []);

  const state = resolveCapability({ appStatus, navVisible, observed });

  return {
    state,
    settled,
    observe,
    canView: can('partner_statements.view'),
    canImport: can('partner_statements.reconcile') && state === 'enabled',
  };
}
