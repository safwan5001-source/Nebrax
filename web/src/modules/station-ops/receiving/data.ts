'use client';

import { useStationOps } from '../context';
import { StationOpsError, opsGet } from '../read-client';
import type { Station } from '../schemas';
import { useScopedQuery, type QueryState, type ScopedQuery } from '../use-scoped-query';
import { receivingAccess, type ReceivingAccess } from './access';
import { deliveryPath, isValidDeliveryId, receivingGet } from './receiving-client';
import { deliveriesResponse, deliveryResponse, stationsWithWarehouseResponse, suppliersResponse, type Delivery, type StationWithWarehouse, type Supplier } from './schemas';

/**
 * FUEL-B5 — خطّافات القراءة. المفتاح يحمل (مستأجر|مستخدم|فرع|نطاق) فلا تسرّب ولا سباق ولا cache عابر (`useScopedQuery`). بلا صلاحية العرض لا يُرسل
 * أي طلب (حالة «ممنوع» صريحة). الخادم يبقى السلطة (404 موحّد خارج نطاق المحطة/الفرع/المخزن).
 */

const FORBIDDEN: QueryState<never> = { status: 'error', error: new StationOpsError('forbidden', 403) };

export function useReceivingAccess(): ReceivingAccess {
  const { can } = useStationOps();
  return receivingAccess(can);
}

export type StatusFilter = 'all' | 'draft' | 'approved';

export interface DeliveryPage { rows: Delivery[]; page: number; lastPage: number }

/** مرشحات القائمة الإضافية (B5.1): بحث نصي برقم سند التسليم/مرجع الشراء/المورد، حالة التكلفة، الفترة، المورد. تُرسل للخادم الذي يطبّقها داخل نطاق المستخدم. */
export interface ListFilters { q?: string; cost?: 'missing' | 'recorded'; from?: string; to?: string; supplier_id?: string }

export function listQuery(stationId: string, status: StatusFilter, filters: ListFilters): Record<string, string | undefined> {
  return {
    station_id: stationId, status: status === 'all' ? undefined : status,
    q: filters.q?.trim() || undefined, cost: filters.cost, from: filters.from || undefined, to: filters.to || undefined, supplier_id: filters.supplier_id || undefined,
  };
}

export function useDeliveryList(station: Station | null, status: StatusFilter, page: number, filters: ListFilters = {}): ScopedQuery<DeliveryPage> & { allowed: boolean } {
  const { scopeKey } = useStationOps();
  const access = useReceivingAccess();
  const stationId = station?.id ?? null;
  const signature = JSON.stringify(listQuery(stationId ?? '', status, filters));
  const key = access.view && stationId ? `${scopeKey}|rcv|list|${signature}|${page}` : null;
  const query = useScopedQuery<DeliveryPage>(key, async (signal) => {
    const result = await receivingGet('/fuel-stations/deliveries', deliveriesResponse, {
      signal, branchId: station?.branch_id, query: { ...listQuery(stationId as string, status, filters), page },
    });
    return { rows: result.data.filter((row) => row.station_id === stationId), page: result.meta?.current_page ?? page, lastPage: result.meta?.last_page ?? 1 };
  });
  return { allowed: access.view, state: access.view ? query.state : FORBIDDEN, reload: query.reload };
}

export function useDelivery(id: string): ScopedQuery<Delivery> & { allowed: boolean } {
  const { scopeKey, selectedStation } = useStationOps();
  const access = useReceivingAccess();
  const valid = isValidDeliveryId(id);
  const key = access.view && valid ? `${scopeKey}|rcv|one|${id}` : null;
  const query = useScopedQuery<Delivery>(key, async (signal) => (await receivingGet(deliveryPath(id), deliveryResponse, { signal, branchId: selectedStation?.branch_id })).data);
  return { allowed: access.view, state: !access.view ? FORBIDDEN : !valid ? { status: 'error', error: new StationOpsError('not_found', 404) } : query.state, reload: query.reload };
}

export function useSuppliers(station: Station | null, search: string): ScopedQuery<Supplier[]> & { allowed: boolean } {
  const { scopeKey } = useStationOps();
  const access = useReceivingAccess();
  const key = access.create && station ? `${scopeKey}|rcv|suppliers|${station.id}|${search}` : null;
  const query = useScopedQuery<Supplier[]>(key, async (signal) => (await receivingGet('/fuel-stations/delivery-suppliers', suppliersResponse, { signal, branchId: station?.branch_id, query: { q: search.trim() || undefined } })).data);
  return { allowed: access.create, state: access.create ? query.state : FORBIDDEN, reload: query.reload };
}

/** المحطة المختارة بمخزنها المرتبط (قائمة المحطات الأم لا تحمل المخزن في مخططها). فشل القراءة ⇒ خطأ صريح لا مخزن مخترع. */
export function useStationWarehouse(station: Station | null): ScopedQuery<StationWithWarehouse | null> {
  const { scopeKey, canViewStations } = useStationOps();
  const key = canViewStations && station ? `${scopeKey}|rcv|warehouse|${station.id}` : null;
  const stationId = station?.id;
  return useScopedQuery<StationWithWarehouse | null>(key, async (signal) => {
    const result = await opsGet('/fuel-stations/stations', stationsWithWarehouseResponse, { signal });
    return result.data.find((row) => row.id === stationId) ?? null;
  });
}
