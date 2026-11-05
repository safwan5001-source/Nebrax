'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildStationCatalog, type StationCatalog } from './catalog';
import { useStationOps } from './context';
import { resolveStationPrices, type PriceResult } from './prices';
import { previousClosingMap } from './entry';
import { STRICT_POLICY, toShiftPolicy, type ShiftPolicy } from './policy';
import { collectionResponse, type CollectionView } from './collection';
import { StationOpsError, isAbort, isValidShiftId, opsGet, shiftCollectionPath, shiftDetailPath, stationSettingsPath } from './read-client';
import {
  fuelProductsResponse,
  nozzlesResponse,
  effectivePricesResponse,
  pumpsResponse,
  shiftDetailResponse,
  shiftsResponse,
  stationSettingsResponse,
  tanksResponse,
  type FuelProduct,
  type Nozzle,
  type Pump,
  type Shift,
  type ShiftDetail,
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
  const key = allowed && stationId && ids.length > 0 ? `${scopeKey}|${stationId}|effective-prices|${ids.join(',')}` : null;

  const query = useScopedQuery<Record<string, PriceResult>>(key, async (signal) =>
    resolveStationPrices(
      async () => (await opsGet('/fuel-stations/prices/effective', effectivePricesResponse, { signal, query: { station_id: stationId as string } })).data,
      stationId as string,
      ids,
    ),
  );

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
      branchId: station?.branch_id,
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

export interface ShiftDetailResult {
  allowed: boolean;
  state: QueryState<ShiftDetail>;
  /** آخر نتيجة ناجحة **لهذا المفتاح نفسه** (نطاق + محطة + وردية). تُعرض مع تنبيه «قديمة» أثناء التحديث/الفشل، ولا تعبر المفاتيح أبداً. */
  retained: { data: ShiftDetail; fetchedAt: number } | null;
  reload: () => void;
}

const INVALID_SHIFT: QueryState<ShiftDetail> = { status: 'error', error: new StationOpsError('not_found', 404) };

/**
 * UI-1 — تفاصيل وردية واحدة (قراءة فقط). الاستعلام يحمل فرع المحطة المختارة (`X-Branch-Id`) كالقائمة، ويتحقق العميل من أن
 * الوردية المعادة تخص المحطة المختارة فعلاً — وإلا تُعامل «غير موجودة» (لا نعرض وردية محطة أخرى بمجرد وصول معرّفها، حتى لو
 * سمح بها الخادم: انظر فجوة نطاق المحطة في تقرير UI-1).
 */
export function useShiftDetail(station: Station | null, shiftId: string): ShiftDetailResult {
  const { scopeKey, can } = useStationOps();
  const allowed = can('fuel.shift.view');
  const stationId = station?.id ?? null;
  const valid = isValidShiftId(shiftId);
  const key = allowed && stationId && valid ? `${scopeKey}|${stationId}|shift|${shiftId}` : null;

  const query = useScopedQuery<ShiftDetail>(key, async (signal) => {
    const response = await opsGet(shiftDetailPath(shiftId), shiftDetailResponse, { signal, branchId: station?.branch_id });
    if (response.data.station_id !== stationId) throw new StationOpsError('not_found', 404);
    return response.data;
  });

  // آخر نجاح لهذا المفتاح: يُسجَّل أثناء العرض نفسه (مرتبطاً بهوية كائن البيانات، فهو idempotent) كي لا يظهر إطارٌ بلا «آخر تحديث».
  const last = useRef<{ key: string; data: ShiftDetail; fetchedAt: number } | null>(null);
  if (key !== null && query.state.status === 'success' && (last.current?.key !== key || last.current.data !== query.state.data)) {
    last.current = { key, data: query.state.data, fetchedAt: Date.now() };
  }
  const retained = key !== null && last.current !== null && last.current.key === key ? { data: last.current.data, fetchedAt: last.current.fetchedAt } : null;

  return { allowed, state: !valid ? INVALID_SHIFT : query.state, retained, reload: query.reload };
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
      branchId: station?.branch_id,
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
      branchId: station?.branch_id,
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
  }, [key, firstData, stationId, station?.branch_id, filter, activeMore]);

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

export interface StationPolicyResult {
  /** سياسة الوردية؛ فشل القراءة ⇒ `STRICT_POLICY` (known=false) لا خطأ يوقف العمل: السياسة تُعرِّف الواجب لا الصلاحية. */
  policy: ShiftPolicy;
  loading: boolean;
}

/** UI-2 — سياسة وردية المحطة من إعداداتها (قراءة فقط، `fuel_stations.view`). */
export function useStationPolicy(station: Station | null): StationPolicyResult {
  const { scopeKey, canViewStations } = useStationOps();
  const stationId = station?.id ?? null;
  const key = canViewStations && stationId ? `${scopeKey}|${stationId}|policy` : null;
  const query = useScopedQuery<ShiftPolicy>(key, async (signal) => {
    try {
      const response = await opsGet(stationSettingsPath(stationId as string), stationSettingsResponse, { signal, branchId: station?.branch_id });
      return toShiftPolicy(response.data);
    } catch (error) {
      if (isAbort(error)) throw error;
      return STRICT_POLICY;
    }
  });
  if (key === null) return { policy: STRICT_POLICY, loading: false };
  return { policy: query.state.status === 'success' ? query.state.data : STRICT_POLICY, loading: query.state.status === 'loading' };
}

export interface PreviousClosing {
  /** رقم الوردية السابقة (للتسمية: «من الوردية …»). */
  shiftNumber: string;
  byNozzle: Record<string, number>;
}

/**
 * UI-2 (B4) — آخر قراءة إغلاق لكل فوهة من **آخر وردية غير مفتوحة** للمحطة. مرجع إرشادي فقط: لا GET لسلسلة قراءات فوهة، فلا نَعِد بأنها
 * «القراءة السابقة الرسمية» ولا نحجب بها. أي فشل ⇒ `null` (لا مرجع) ولا يعطّل الإدخال.
 */
export function usePreviousClosing(station: Station | null, currentShiftId: string, enabled: boolean): QueryState<PreviousClosing | null> {
  const { scopeKey, can } = useStationOps();
  const stationId = station?.id ?? null;
  const key = enabled && can('fuel.shift.view') && stationId && isValidShiftId(currentShiftId) ? `${scopeKey}|${stationId}|prev-closing|${currentShiftId}` : null;
  const query = useScopedQuery<PreviousClosing | null>(key, async (signal) => {
    try {
      const page = await opsGet('/fuel-stations/shifts', shiftsResponse, { signal, branchId: station?.branch_id, query: { station_id: stationId as string } });
      const previous = page.data
        .filter((shift) => shift.station_id === stationId && shift.status !== 'open' && shift.id !== currentShiftId)
        .sort((a, b) => Date.parse(b.opened_at ?? '') - Date.parse(a.opened_at ?? ''))[0];
      if (!previous || !isValidShiftId(previous.id)) return null;
      const detail = await opsGet(shiftDetailPath(previous.id), shiftDetailResponse, { signal, branchId: station?.branch_id });
      if (detail.data.station_id !== stationId) return null;
      const byNozzle = previousClosingMap(detail.data);
      return Object.keys(byNozzle).length === 0 ? null : { shiftNumber: detail.data.number, byNozzle };
    } catch (error) {
      if (isAbort(error)) throw error;
      return null;
    }
  });
  const idle: QueryState<PreviousClosing | null> = useMemo(() => ({ status: 'success', data: null }), []);
  return key === null ? idle : query.state;
}


export interface ShiftCollectionResult {
  /** `false` = لا صلاحية `fuel.shift.view` (لا طلب أُرسل). */
  allowed: boolean;
  state: QueryState<CollectionView>;
  /** آخر نجاح لهذا المفتاح نفسه: يبقى معروضاً أثناء التحديث التلقائي فلا تُفقد المدخلات ولا يومض القسم. */
  retained: CollectionView | null;
  reload: () => void;
}

const COLLECTION_REFRESH_MS = 60_000;
const COLLECTION_FOCUS_THROTTLE_MS = 5_000;

/**
 * إقرار تحصيل الوردية (قراءة فقط). **القائمة تتبع إعدادات المحطة تلقائياً:** يُعاد الجلب عند عودة التبويب/النافذة للتركيز وكل دقيقة وهو ظاهر،
 * فتفعيل/تعطيل طريقة دفع من إعدادات المحطة ينعكس دون إعادة تحميل الصفحة؛ والخادم يرفض عند الحفظ أي قائمة قديمة على أي حال.
 * البوابة مغلقة ⇒ 404 ⇒ `not_found` ⇒ القسم لا يُعرض (الشاشة كما كانت).
 */
export function useShiftCollection(station: Station | null, shiftId: string, options: { autoRefresh?: boolean } = {}): ShiftCollectionResult {
  const { scopeKey, can } = useStationOps();
  const allowed = can('fuel.shift.view');
  const stationId = station?.id ?? null;
  const valid = isValidShiftId(shiftId);
  const key = allowed && stationId && valid ? `${scopeKey}|${stationId}|shift|${shiftId}|collection` : null;

  const query = useScopedQuery<CollectionView>(key, async (signal) => (await opsGet(shiftCollectionPath(shiftId), collectionResponse, { signal, branchId: station?.branch_id })).data);

  const last = useRef<{ key: string; data: CollectionView } | null>(null);
  if (key !== null && query.state.status === 'success') last.current = { key, data: query.state.data };
  const retained = key !== null && last.current?.key === key ? last.current.data : null;

  const { reload } = query;
  const autoRefresh = options.autoRefresh === true;
  useEffect(() => {
    if (!autoRefresh || key === null) return undefined;
    let lastRun = Date.now();
    const run = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      if (Date.now() - lastRun < COLLECTION_FOCUS_THROTTLE_MS) return;
      lastRun = Date.now();
      reload();
    };
    const timer = window.setInterval(run, COLLECTION_REFRESH_MS);
    window.addEventListener('focus', run);
    document.addEventListener('visibilitychange', run);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', run);
      document.removeEventListener('visibilitychange', run);
    };
  }, [autoRefresh, key, reload]);

  const idle: QueryState<CollectionView> = useMemo(() => ({ status: 'error', error: new StationOpsError('forbidden', 403) }), []);
  return { allowed, state: key === null ? idle : query.state, retained, reload };
}
