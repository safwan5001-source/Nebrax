'use client';

import { createContext, useCallback, useContext, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { BRANCH_CHANGED_EVENT, getActiveBranchId } from '@/lib/branch';
import type { AuthUser } from '@/lib/auth';
import { useCan, usePermissionRefresh } from '@/lib/use-can';
import { StationOpsError, opsGet } from './read-client';
import { stationsResponse, type Station } from './schemas';
import { useScopedQuery, type QueryState } from './use-scoped-query';

/**
 * UI-0 — سياق «تشغيل المحطات»: الهوية والنطاق والمحطة المختارة.
 *
 * مفتاح النطاق = (المستأجر، المستخدم، الفرع النشط). عند تغيّر أيٍّ منها يُعاد تركيب الشجرة الداخلية كلها
 * (`key`)، فتسقط حالة الاستعلامات والمحطة المختارة معاً ولا يبقى شيء من النطاق السابق في الذاكرة.
 * الصلاحيات والهوية من جلسة أَوْج (`useCan`) ويُعاد تحديثها من `/me` — لا منطق صلاحيات مستقل هنا.
 */

export const VIEW_PERMISSION = 'fuel_stations.view';

export interface StationOpsContextValue {
  scopeKey: string;
  viewer: AuthUser;
  can: (permission: string) => boolean;
  /** يملك المستخدم قراءة وحدة المحطات أصلاً؛ بدونها لا يُرسل أي طلب. */
  canViewStations: boolean;
  stations: QueryState<Station[]>;
  reloadStations: () => void;
  selectedStation: Station | null;
  selectStation: (id: string) => void;
}

const StationOpsContext = createContext<StationOpsContextValue | null>(null);

export function useStationOps(): StationOpsContextValue {
  const value = useContext(StationOpsContext);
  if (!value) throw new Error('useStationOps must be used inside <StationOpsProvider>');
  return value;
}

function subscribeBranch(onChange: () => void): () => void {
  window.addEventListener(BRANCH_CHANGED_EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(BRANCH_CHANGED_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

export function stationPreferenceKey(tenantId: string, userId: string): string {
  return `awj:fuel-ops:station:${tenantId}:${userId}`;
}

function readPreferredStation(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** تفضيل عرض فقط — لا يُقبل إلا إن وُجدت المحطة ضمن ما أعاده الخادم لهذا المستخدم الآن. */
export function resolveSelectedStation(stations: Station[], preferredId: string | null): Station | null {
  if (stations.length === 0) return null;
  return stations.find((station) => station.id === preferredId)
    ?? stations.find((station) => station.status === 'active')
    ?? stations[0];
}

const NO_VIEW_STATE: QueryState<Station[]> = { status: 'error', error: new StationOpsError('forbidden', 403) };

export function StationOpsProvider({ children }: { children: ReactNode }) {
  const { viewer, hydrated } = useCan();
  const branchId = useSyncExternalStore(subscribeBranch, getActiveBranchId, () => null);
  usePermissionRefresh(viewer !== null);

  if (!hydrated || viewer === null) return null;
  // نطاق الوصول المحدَّث من `/me` (فروع/مخازن) جزء من حدّ الإبطال: تغييره يُسقط قائمة المحطات والمحطة المختارة وكل ما حُمِّل لها.
  // غياب الحقل (`undefined`) ≠ القائمة الفارغة (غير مقيَّد).
  const access = (ids: string[] | undefined) => (ids === undefined ? 'unknown' : [...ids].sort().join(','));
  const scopeKey = `${viewer.tenant_id}|${viewer.id}|${branchId ?? 'default'}|${access(viewer.branch_ids)}|${access(viewer.warehouse_ids)}`;

  return (
    <ScopedProvider key={scopeKey} scopeKey={scopeKey}>
      {children}
    </ScopedProvider>
  );
}

function ScopedProvider({ scopeKey, children }: { scopeKey: string; children: ReactNode }) {
  const { viewer, can } = useCan();
  const user = viewer as AuthUser;
  const canViewStations = can(VIEW_PERMISSION);
  const preferenceKey = stationPreferenceKey(user.tenant_id, user.id);
  const [preferredId, setPreferredId] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : readPreferredStation(preferenceKey),
  );

  const query = useScopedQuery(
    canViewStations ? `${scopeKey}|stations` : null,
    async (signal) => (await opsGet('/fuel-stations/stations', stationsResponse, { signal })).data,
  );

  // بلا صلاحية القراءة لا يُرسل طلب أصلاً؛ الحالة الصريحة «ممنوع» أصدق من تحميل لا ينتهي.
  const stations = canViewStations ? query.state : NO_VIEW_STATE;
  const selectedStation = stations.status === 'success' ? resolveSelectedStation(stations.data, preferredId) : null;

  const selectStation = useCallback(
    (id: string) => {
      setPreferredId(id);
      try {
        window.localStorage.setItem(preferenceKey, id);
      } catch {
        // تخزين محجوب: يبقى الاختيار في الذاكرة لهذه الجلسة فقط.
      }
    },
    [preferenceKey],
  );

  const value = useMemo<StationOpsContextValue>(
    () => ({
      scopeKey,
      viewer: user,
      can,
      canViewStations,
      stations,
      reloadStations: query.reload,
      selectedStation,
      selectStation,
    }),
    [scopeKey, user, can, canViewStations, stations, query.reload, selectedStation, selectStation],
  );

  return <StationOpsContext.Provider value={value}>{children}</StationOpsContext.Provider>;
}
