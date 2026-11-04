'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildStationCatalog, type StationCatalog } from './catalog';
import { useStationOps } from './context';
import { resolveProductPrice, type PriceResult } from './prices';
import { isAbort, opsGet } from './read-client';
import {
  fuelProductsResponse,
  nozzlesResponse,
  pricesResponse,
  pumpsResponse,
  shiftsResponse,
  tanksResponse,
  type FuelProduct,
  type Nozzle,
  type Pump,
  type Shift,
  type Station,
  type Tank,
} from './schemas';
import { useScopedQuery, type QueryState } from './use-scoped-query';

/**
 * UI-0 — خطّاف بيانات المحطة المختارة (قراءة فقط).
 *
 * كل مفتاح استعلام يبدأ بـ`scopeKey` (مستأجر|مستخدم|فرع) ثم معرّف المحطة، فلا يتشارك محطتان ولا مستأجران حالة.
 * الصلاحية تُفحص قبل الطلب (لا نرسل ما نعلم أنه سيُرفض)، لكن 403 من الخادم يبقى مُعالَجاً كحالة صادقة.
 */

export interface StationAssets {
  products: FuelProduct[];
  pumps: Pump[];
  nozzles: Nozzle[];
  tanks: Tank[];
}

export interface StationAssetsResult {
  state: QueryState<StationAssets>;
  catalog: StationCatalog | null;
  reload: () => void;
}

export function useStationAssets(station: Station | null): StationAssetsResult {
  const { scopeKey, canViewStations } = useStationOps();
  const stationId = station?.id ?? null;
  const key = canViewStations && stationId ? `${scopeKey}|${stationId}|assets` : null;

  const query = useScopedQuery<StationAssets>(key, async (signal) => {
    const [products, pumps, nozzles, tanks] = await Promise.all([
      opsGet('/fuel-stations/products', fuelProductsResponse, { signal }),
      opsGet('/fuel-stations/pumps', pumpsResponse, { signal }),
      opsGet('/fuel-stations/nozzles', nozzlesResponse, { signal }),
      opsGet('/fuel-stations/tanks', tanksResponse, { signal }),
    ]);
    return { products: products.data, pumps: pumps.data, nozzles: nozzles.data, tanks: tanks.data };
  });

  const state = query.state;
  const catalog = useMemo(
    () => (state.status === 'success' && station ? buildStationCatalog({ station, ...state.data }) : null),
    [state, station],
  );
  return { state, catalog, reload: query.reload };
}

export interface StationPricesResult {
  /** `false` = لا صلاحية `fuel.sale.view` (لا طلب أُرسل) — تُعرض «غير متاح لصلاحياتك» لا صفراً. */
  allowed: boolean;
  state: QueryState<Record<string, PriceResult>>;
}

export function useStationPrices(station: Station | null, productIds: readonly string[]): StationPricesResult {
  const { scopeKey, can } = useStationOps();
  const allowed = can('fuel.sale.view');
  const ids = useMemo(() => [...new Set(productIds)].sort(), [productIds]);
  const stationId = station?.id ?? null;
  const key = allowed && stationId && ids.length > 0 ? `${scopeKey}|${stationId}|prices|${ids.join(',')}` : null;

  const query = useScopedQuery<Record<string, PriceResult>>(key, async (signal) => {
    const results = await Promise.all(
      ids.map((productId) =>
        resolveProductPrice(
          (q) => opsGet('/fuel-stations/prices', pricesResponse, { signal, query: q }),
          stationId as string,
          productId,
        ),
      ),
    );
    return Object.fromEntries(ids.map((productId, index) => [productId, results[index]]));
  });

  // مرجع الحالة محفوظ: لا استعلام ولا صلاحية = حالة `success` فارغة صريحة بدل «جارٍ التحميل» دائم.
  const idle: QueryState<Record<string, PriceResult>> = useMemo(() => ({ status: 'success', data: {} }), []);
  return { allowed, state: key === null ? idle : query.state };
}

export interface CurrentShiftResult {
  allowed: boolean;
  state: QueryState<{ shift: Shift | null; multiple: boolean }>;
  reload: () => void;
}

export function useCurrentShift(station: Station | null): CurrentShiftResult {
  const { scopeKey, can } = useStationOps();
  const allowed = can('fuel.shift.view');
  const stationId = station?.id ?? null;
  const key = allowed && stationId ? `${scopeKey}|${stationId}|current-shift` : null;

  const query = useScopedQuery(key, async (signal) => {
    const page = await opsGet('/fuel-stations/shifts', shiftsResponse, {
      signal,
      query: { station_id: stationId as string, status: 'open' },
    });
    // الخادم يصفّي بالمحطة؛ نتحقق مرة ثانية قبل العرض (دفاع بالعمق).
    const open = page.data.filter((shift) => shift.station_id === stationId && shift.status === 'open');
    const sorted = [...open].sort((a, b) => Date.parse(b.opened_at ?? '') - Date.parse(a.opened_at ?? ''));
    return { shift: sorted[0] ?? null, multiple: open.length > 1 };
  });

  const idle: QueryState<{ shift: Shift | null; multiple: boolean }> = useMemo(
    () => ({ status: 'success', data: { shift: null, multiple: false } }),
    [],
  );
  return { allowed, state: key === null ? idle : query.state, reload: query.reload };
}

export type ShiftFilter = 'all' | 'open' | 'closed' | 'approved';

export interface ShiftHistoryResult {
  allowed: boolean;
  state: QueryState<{ shifts: Shift[]; hasMore: boolean }>;
  loadingMore: boolean;
  loadMoreFailed: boolean;
  loadMore: () => void;
  reload: () => void;
}

interface MoreState {
  base: unknown;
  rows: Shift[];
  lastLoaded: number;
  lastPage: number | null;
  loading: boolean;
  failed: boolean;
}

/** صفحات الورديات (50 لكل صفحة): «تحميل المزيد» صريح، ولا يُعرض أي مجموع كأنه كل التاريخ. */
export function useShiftHistory(station: Station | null, filter: ShiftFilter): ShiftHistoryResult {
  const { scopeKey, can } = useStationOps();
  const allowed = can('fuel.shift.view');
  const stationId = station?.id ?? null;
  const key = allowed && stationId ? `${scopeKey}|${stationId}|shifts|${filter}` : null;

  const first = useScopedQuery(key, async (signal) => {
    const page = await opsGet('/fuel-stations/shifts', shiftsResponse, {
      signal,
      query: { station_id: stationId as string, status: filter === 'all' ? undefined : filter, page: 1 },
    });
    return { rows: page.data.filter((shift) => shift.station_id === stationId), lastPage: page.meta?.last_page ?? 1 };
  });

  const [more, setMore] = useState<(MoreState & { key: string | null }) | null>(null);
  const keyRef = useRef(key);
  keyRef.current = key;
  const firstData = first.state.status === 'success' ? first.state.data : null;
  const activeMore = more !== null && more.key === key && more.base === firstData ? more : null;

  const loadMore = useCallback(() => {
    if (!key || !firstData || !stationId) return;
    const current = activeMore;
    const nextPage = (current?.lastLoaded ?? 1) + 1;
    const lastPage = current?.lastPage ?? firstData.lastPage;
    if (nextPage > lastPage || current?.loading) return;
    const requestKey = key;
    const seed: MoreState = { base: firstData, rows: current?.rows ?? [], lastLoaded: current?.lastLoaded ?? 1, lastPage, loading: true, failed: false };
    setMore({ ...seed, key: requestKey });
    opsGet('/fuel-stations/shifts', shiftsResponse, {
      query: { station_id: stationId, status: filter === 'all' ? undefined : filter, page: nextPage },
    }).then(
      (page) => {
        if (keyRef.current !== requestKey) return; // تبدّل النطاق أثناء الطلب: ردّ متأخر يُهمل
        const known = new Set([...firstData.rows, ...seed.rows].map((shift) => shift.id));
        const fresh = page.data.filter((shift) => shift.station_id === stationId && !known.has(shift.id));
        setMore({ ...seed, key: requestKey, rows: [...seed.rows, ...fresh], lastLoaded: nextPage, lastPage: page.meta?.last_page ?? lastPage, loading: false });
      },
      (error: unknown) => {
        if (keyRef.current !== requestKey || isAbort(error)) return;
        setMore({ ...seed, key: requestKey, loading: false, failed: true });
      },
    );
  }, [key, firstData, stationId, filter, activeMore]);

  // تبدّل المفتاح يُسقط الصفحات الإضافية فور تغيّر `key`؛ الحالة القديمة لا تُعرض (انظر activeMore) وتُمسح هنا.
  useEffect(() => {
    setMore(null);
  }, [key]);

  const state: QueryState<{ shifts: Shift[]; hasMore: boolean }> = useMemo(() => {
    if (key === null) return { status: 'success', data: { shifts: [], hasMore: false } };
    if (first.state.status !== 'success') return first.state;
    const rows = [...first.state.data.rows, ...(activeMore?.rows ?? [])];
    const lastLoaded = activeMore?.lastLoaded ?? 1;
    const lastPage = activeMore?.lastPage ?? first.state.data.lastPage;
    return { status: 'success', data: { shifts: rows, hasMore: lastLoaded < lastPage } };
  }, [key, first.state, activeMore]);

  return {
    allowed,
    state,
    loadingMore: activeMore?.loading ?? false,
    loadMoreFailed: activeMore?.failed ?? false,
    loadMore,
    reload: first.reload,
  };
}
