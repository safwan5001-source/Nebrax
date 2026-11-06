'use client';

import { useStationOps } from '../context';
import { StationOpsError } from '../read-client';
import type { Station } from '../schemas';
import { useScopedQuery, type QueryState, type ScopedQuery } from '../use-scoped-query';
import { tanksAccess, type TanksAccess } from './access';
import { isValidTankId, levelsGet } from './levels-client';
import { historyResponse, tankLevelsResponse, type HistoryPage, type ReadingKind, type TankLevel } from './schemas';

/**
 * FUEL-B6 — خطّافات القراءة. المفتاح يحمل (مستأجر|مستخدم|فرع|محطة|…) فلا تسرّب ولا سباق ولا cache عابر (`useScopedQuery`)؛ بلا صلاحية العرض
 * لا يُرسل طلب (حالة «ممنوع» صريحة). الخادم يبقى السلطة (404 موحّد خارج نطاق المحطة/الفرع/المخزن).
 */

const FORBIDDEN: QueryState<never> = { status: 'error', error: new StationOpsError('forbidden', 403) };
export const HISTORY_PAGE_SIZE = 10;

export function useTanksAccess(): TanksAccess {
  const { can } = useStationOps();
  return tanksAccess(can);
}

export function useTankLevels(station: Station | null): ScopedQuery<TankLevel[]> & { allowed: boolean } {
  const { scopeKey } = useStationOps();
  const access = useTanksAccess();
  const stationId = station?.id ?? null;
  const key = access.view && stationId ? `${scopeKey}|tanks|levels|${stationId}` : null;
  const query = useScopedQuery<TankLevel[]>(key, async (signal) => {
    const result = await levelsGet('/fuel-stations/tank-levels', tankLevelsResponse, { signal, branchId: station?.branch_id, query: { station_id: stationId as string } });
    // دفاعاً: لا نعرض خزاناً لمحطة أخرى لو أعاده الخادم خطأً.
    return result.data.filter((row) => row.station.id === stationId);
  });
  return { allowed: access.view, state: access.view ? query.state : FORBIDDEN, reload: query.reload };
}

export function useTankHistory(station: Station | null, tankId: string, page: number, type: ReadingKind | 'all'): ScopedQuery<HistoryPage> & { allowed: boolean } {
  const { scopeKey } = useStationOps();
  const access = useTanksAccess();
  const valid = isValidTankId(tankId);
  const key = access.view && station && valid ? `${scopeKey}|tanks|history|${station.id}|${tankId}|${type}|${page}` : null;
  const query = useScopedQuery<HistoryPage>(key, async (signal) => {
    const result = await levelsGet('/fuel-stations/readings', historyResponse, {
      signal,
      branchId: station?.branch_id,
      query: { fuel_station_id: station?.id, fuel_tank_id: tankId, reading_type: type === 'all' ? undefined : type, per_page: HISTORY_PAGE_SIZE, page },
    });
    return {
      rows: result.data.filter((row) => row.fuel_tank_id === tankId),
      page: result.meta?.current_page ?? page,
      lastPage: result.meta?.last_page ?? 1,
      total: result.meta?.total ?? result.data.length,
    };
  });
  return {
    allowed: access.view,
    state: !access.view ? FORBIDDEN : !valid ? { status: 'error', error: new StationOpsError('not_found', 404) } : query.state,
    reload: query.reload,
  };
}
