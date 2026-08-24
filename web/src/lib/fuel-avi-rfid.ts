export interface AviRfidAuthorization {
  id: string;
  fuel_station_id: string;
  fuel_nozzle_id: string;
  vehicle_identity_tag_id: string | null;
  driver_identity_tag_id: string | null;
  partner_id: string | null;
  fuel_fleet_vehicle_id: string | null;
  quantity_milliliters: number;
  decision: 'approved' | 'denied';
  reason_code: string | null;
  suspicion_signals: string[];
  authorized_at: string;
  expires_at: string | null;
  fuel_sale_id: string | null;
}

export function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value as T[] : [];
}

export function asStringArray(value: unknown): string[] {
  return asArray<unknown>(value).filter((item): item is string => typeof item === 'string');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asRecordArray<T extends object>(value: unknown): T[] {
  return asArray<unknown>(value).filter(isRecord) as T[];
}

export function normalizeAviRfidAuthorization(value: unknown): AviRfidAuthorization | null {
  if (!isRecord(value)) return null;

  return {
    ...value,
    suspicion_signals: asStringArray(value.suspicion_signals),
  } as AviRfidAuthorization;
}

export function normalizeAviRfidAuthorizations(value: unknown): AviRfidAuthorization[] {
  return asArray<unknown>(value)
    .map(normalizeAviRfidAuthorization)
    .filter((authorization): authorization is AviRfidAuthorization => authorization !== null);
}
