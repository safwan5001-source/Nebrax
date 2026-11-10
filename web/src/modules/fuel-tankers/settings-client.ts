import { api } from '@/lib/api';
import { assertId } from './client';
import { readPolicy, type TankerOperation, type TankerPolicy } from './settings-logic';

/**
 * TANKER-PR3 — نقطة الشبكة الوحيدة لشاشة إعدادات التعبئة: إعدادات الوقود القائمة (مؤسسة/محطة) وفوهات المحطة. لا حمولة تحمل `tenant_id`،
 * والفوهة لا يُرسَل لها غير `allowed_operations`. الخادم يفرض التحقق والحوكمة والنطاق والتدقيق.
 */
const SETTINGS = '/fuel-stations/settings';
const STATIONS = '/fuel-stations/stations';
const NOZZLES = '/fuel-stations/nozzles';

export interface StationOption { id: string; name: string; code: string | null }
export interface NozzleRow {
  id: string;
  fuel_station_id: string;
  pump_number: string | null;
  nozzle_number: string;
  product_name: string | null;
  status: string;
  /** القيد المخزَّن: `null` = كل العمليات. */
  allowed_operations: TankerOperation[] | null;
}

const asObject = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {});
const asList = (payload: unknown): unknown[] => {
  const data = asObject(payload).data;
  return Array.isArray(data) ? data : [];
};

export async function getTankerPolicy(stationId?: string): Promise<TankerPolicy> {
  const path = stationId ? `${STATIONS}/${assertId(stationId)}/settings` : SETTINGS;
  return readPolicy(asObject(await api<unknown>(path)).data);
}

export type PolicyPayload = Record<string, boolean | string | null>;

export async function saveTankerPolicy(stationId: string | undefined, changes: PolicyPayload, reason?: string): Promise<TankerPolicy> {
  const path = stationId ? `${STATIONS}/${assertId(stationId)}/settings` : SETTINGS;
  const body = reason && reason.trim() !== '' ? { ...changes, reason: reason.trim() } : changes;
  return readPolicy(asObject(await api<unknown>(path, { method: 'PUT', body })).data);
}

export async function listStations(): Promise<StationOption[]> {
  return asList(await api<unknown>(STATIONS))
    .map(asObject)
    .filter((row) => typeof row.id === 'string' && typeof row.name === 'string' && (row.status === undefined || row.status === 'active'))
    .map((row) => ({ id: row.id as string, name: row.name as string, code: typeof row.code === 'string' ? row.code : null }));
}

function toNozzle(row: Record<string, unknown>): NozzleRow {
  const ops = Array.isArray(row.allowed_operations) ? (row.allowed_operations as unknown[]).filter((o): o is TankerOperation => typeof o === 'string') : null;
  return {
    id: row.id as string,
    fuel_station_id: row.fuel_station_id as string,
    pump_number: typeof asObject(row.pump).pump_number === 'string' ? (asObject(row.pump).pump_number as string) : null,
    nozzle_number: String(row.nozzle_number ?? ''),
    product_name: typeof asObject(row.fuel_product).name === 'string' ? (asObject(row.fuel_product).name as string) : null,
    status: typeof row.status === 'string' ? row.status : 'active',
    allowed_operations: ops,
  };
}

/** فوهات المحطة المختارة (الخادم يقيّد بنطاق المستخدم؛ التصفية بالمحطة هنا لأن المسار القائم بلا مرشّح). */
export async function listStationNozzles(stationId: string): Promise<NozzleRow[]> {
  return asList(await api<unknown>(NOZZLES))
    .map(asObject)
    .filter((row) => typeof row.id === 'string' && row.fuel_station_id === stationId)
    .map(toNozzle);
}

/** `null` = كل العمليات. */
export async function updateNozzleOperations(id: string, allowed: TankerOperation[] | null): Promise<NozzleRow> {
  const payload = asObject(asObject(await api<unknown>(`${NOZZLES}/${assertId(id)}`, { method: 'PUT', body: { allowed_operations: allowed } })).data);
  if (typeof payload.id !== 'string') throw new Error('malformed_response');
  return toNozzle(payload);
}
