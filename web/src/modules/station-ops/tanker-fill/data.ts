'use client';

import { useMemo } from 'react';
import { useStationOps } from '../context';
import { StationOpsError, isAbort, opsGet, stationSettingsPath } from '../read-client';
import type { Station } from '../schemas';
import { useScopedQuery, type QueryState } from '../use-scoped-query';
import { tankerFillAccess, type TankerFillAccess } from './access';
import { getFill, listFills, listOwners, listTankers, type Listing } from './client';
import { toTankerPolicy, type TankerPolicy } from './logic';
import { tankerPolicyResponse, type Owner, type Tanker, type TankerFill } from './schemas';

/** خطّافات قراءة تعبئة الصهاريج (قراءة فقط). كل مفتاح يبدأ بـ`scopeKey` (مستأجر|مستخدم|فرع) ثم المحطة: لا تتشارك محطتان ولا مستأجران حالة. */

export function useTankerFillAccess(): TankerFillAccess {
  const { can } = useStationOps();
  return tankerFillAccess(can);
}

export type FeatureState = 'checking' | 'open' | 'closed' | 'forbidden' | 'unavailable';

/**
 * هل الميزة متاحة لهذا الحساب؟ **الخادم المصدر الوحيد** (لا قراءة بوابة من المتصفح): قراءة خفيفة لقائمة السندات — 404 ⇒ بوابة النشر مغلقة، 403 ⇒ لا صلاحية، غير ذلك ⇒ تعذّر.
 * بلا صلاحية القراءة لا يُرسل طلب أصلاً.
 */
export function useTankerFillFeature(station: Station | null): { state: FeatureState; reload: () => void } {
  const { scopeKey } = useStationOps();
  const access = useTankerFillAccess();
  const stationId = station?.id ?? null;
  const key = access.view && stationId ? `${scopeKey}|${stationId}|tanker-fill-probe` : null;
  const query = useScopedQuery<true>(key, async (signal) => {
    await listFills({ stationId: stationId as string, perPage: 1 }, { branchId: station?.branch_id, signal });
    return true;
  });
  if (!access.view) return { state: 'forbidden', reload: query.reload };
  if (key === null || query.state.status === 'loading') return { state: 'checking', reload: query.reload };
  if (query.state.status === 'success') return { state: 'open', reload: query.reload };
  const kind = query.state.error.kind;
  return { state: kind === 'not_found' ? 'closed' : kind === 'forbidden' ? 'forbidden' : 'unavailable', reload: query.reload };
}

/** سياسة التعبئة الفعّالة للمحطة (إرشاد فقط). تعذّر القراءة ⇒ سياسة غير معروفة (لا حجب بتخمين؛ الخادم يفرض). */
export function useTankerPolicy(station: Station | null): { policy: TankerPolicy; loading: boolean } {
  const { scopeKey, canViewStations } = useStationOps();
  const stationId = station?.id ?? null;
  const key = canViewStations && stationId ? `${scopeKey}|${stationId}|tanker-policy` : null;
  const query = useScopedQuery<TankerPolicy>(key, async (signal) => {
    try {
      const response = await opsGet(stationSettingsPath(stationId as string), tankerPolicyResponse, { signal, branchId: station?.branch_id });
      return toTankerPolicy(response.data);
    } catch (error) {
      if (isAbort(error)) throw error;
      return toTankerPolicy(null);
    }
  });
  const unknown = useMemo(() => toTankerPolicy(null), []);
  if (key === null) return { policy: unknown, loading: false };
  return { policy: query.state.status === 'success' ? query.state.data : unknown, loading: query.state.status === 'loading' };
}

export function useOwners(station: Station | null, search: string): { state: QueryState<Listing<Owner>>; reload: () => void } {
  const { scopeKey } = useStationOps();
  const access = useTankerFillAccess();
  const stationId = station?.id ?? null;
  const q = search.trim();
  const key = access.pick && stationId ? `${scopeKey}|${stationId}|tanker-owners|${q}` : null;
  const query = useScopedQuery(key, (signal) => listOwners({ q, branchId: station?.branch_id, signal }));
  const denied: QueryState<Listing<Owner>> = useMemo(() => ({ status: 'error', error: new StationOpsError('forbidden', 403) }), []);
  return { state: key === null ? denied : query.state, reload: query.reload };
}

export function useOwnerTankers(station: Station | null, ownerId: string | null): { state: QueryState<Listing<Tanker>>; reload: () => void } {
  const { scopeKey } = useStationOps();
  const stationId = station?.id ?? null;
  const key = ownerId && stationId ? `${scopeKey}|${stationId}|tankers|${ownerId}` : null;
  const query = useScopedQuery(key, (signal) => listTankers(ownerId as string, { branchId: station?.branch_id, signal }));
  const idle: QueryState<Listing<Tanker>> = useMemo(() => ({ status: 'success', data: { rows: [], truncated: false } }), []);
  return { state: key === null ? idle : query.state, reload: query.reload };
}

export function useShiftFills(station: Station | null, shiftId: string | null): { state: QueryState<Listing<TankerFill>>; reload: () => void } {
  const { scopeKey } = useStationOps();
  const access = useTankerFillAccess();
  const stationId = station?.id ?? null;
  const key = access.view && stationId && shiftId ? `${scopeKey}|${stationId}|tanker-fills|${shiftId}` : null;
  const query = useScopedQuery(key, (signal) => listFills({ stationId: stationId as string, shiftId: shiftId as string }, { branchId: station?.branch_id, signal }));
  const denied: QueryState<Listing<TankerFill>> = useMemo(() => ({ status: 'error', error: new StationOpsError('forbidden', 403) }), []);
  return { state: key === null ? denied : query.state, reload: query.reload };
}

export function useFill(station: Station | null, id: string): { state: QueryState<TankerFill>; reload: () => void } {
  const { scopeKey } = useStationOps();
  const access = useTankerFillAccess();
  const stationId = station?.id ?? null;
  const key = access.view && stationId ? `${scopeKey}|${stationId}|tanker-fill|${id}` : null;
  const query = useScopedQuery<TankerFill>(key, async (signal) => {
    const fill = await getFill(id, { branchId: station?.branch_id, signal });
    // محطة أخرى (حتى لو أعادها الخادم) تُعامل «غير موجودة»: لا نعرض سند محطة غير المختارة.
    if (fill.fuel_station_id !== stationId) throw new StationOpsError('not_found', 404);
    return fill;
  });
  const denied: QueryState<TankerFill> = useMemo(() => ({ status: 'error', error: new StationOpsError('forbidden', 403) }), []);
  return { state: key === null ? denied : query.state, reload: query.reload };
}
