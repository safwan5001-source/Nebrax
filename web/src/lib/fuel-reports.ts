export type FuelReportKey =
  | 'sales-station'
  | 'sales-fuel'
  | 'sales-customer'
  | 'shift-sales'
  | 'inventory'
  | 'deliveries'
  | 'avi'
  | 'maintenance'
  | 'safety'
  | 'alerts';

export type FuelReportFilters = {
  from: string;
  to: string;
  stationId: string;
  status: string;
  severity: string;
};

export const EMPTY_FUEL_REPORT_FILTERS: FuelReportFilters = {
  from: '',
  to: '',
  stationId: '',
  status: '',
  severity: '',
};

export const FUEL_REPORT_KEYS: FuelReportKey[] = [
  'sales-station',
  'sales-fuel',
  'sales-customer',
  'shift-sales',
  'inventory',
  'deliveries',
  'avi',
  'maintenance',
  'safety',
  'alerts',
];

export function isFuelReportKey(value: string | null | undefined): value is FuelReportKey {
  return !!value && FUEL_REPORT_KEYS.includes(value as FuelReportKey);
}

export function reportQuery(key: FuelReportKey, filters: FuelReportFilters): string {
  const query = new URLSearchParams();
  const set = (name: string, value: string) => { if (value) query.set(name, value); };

  if (key === 'alerts') {
    set('status', filters.status);
    set('severity', filters.severity);
    const value = query.toString();
    return `/fuel-stations/alerts${value ? `?${value}` : ''}`;
  }

  if (key === 'deliveries') {
    set('station_id', filters.stationId);
    set('status', filters.status);
    const value = query.toString();
    return `/fuel-stations/deliveries${value ? `?${value}` : ''}`;
  }

  set('from', filters.from);
  set('to', filters.to);
  set('station_id', filters.stationId);

  if (key === 'sales-station' || key === 'sales-fuel' || key === 'sales-customer' || key === 'shift-sales') {
    query.set('dimension', key === 'sales-station' ? 'station' : key === 'sales-fuel' ? 'fuel' : key === 'sales-customer' ? 'customer' : 'shift');
    return `/fuel-stations/reports/sales?${query.toString()}`;
  }

  const family = key === 'inventory' || key === 'avi' || key === 'maintenance' || key === 'safety' ? key : 'sales';
  const value = query.toString();
  return `/fuel-stations/reports/${family}${value ? `?${value}` : ''}`;
}

/** يقبل Collection Laravel أو response خاماً أو null من مصدر اختياري، ولا يمرر UUID إلى العرض. */
export function collectionRows<T>(response: unknown): T[] {
  if (!response || typeof response !== 'object') return [];
  const outer = response as { data?: unknown };
  if (Array.isArray(outer.data)) return outer.data as T[];
  if (outer.data && typeof outer.data === 'object') {
    const nested = outer.data as { data?: unknown };
    if (Array.isArray(nested.data)) return nested.data as T[];
  }
  return [];
}

export function objectRows(response: unknown, key = 'rows'): Record<string, unknown>[] {
  if (!response || typeof response !== 'object') return [];
  const payload = response as Record<string, unknown>;
  const data = payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data as Record<string, unknown>
    : payload;
  return Array.isArray(data[key]) ? data[key].filter((row): row is Record<string, unknown> => !!row && typeof row === 'object') : [];
}

export function numberValue(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

export function labelFor(id: unknown, labels: Map<string, string>, unavailable: string): string {
  const key = stringValue(id);
  return key ? labels.get(key) ?? unavailable : unavailable;
}

export function reportFiltersFromSearch(params: URLSearchParams): FuelReportFilters {
  return {
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    stationId: params.get('station_id') ?? '',
    status: params.get('status') ?? '',
    severity: params.get('severity') ?? '',
  };
}

export function reportSearchParams(key: FuelReportKey, filters: FuelReportFilters): URLSearchParams {
  const params = new URLSearchParams({ report: key });
  const set = (name: string, value: string) => { if (value) params.set(name, value); };

  if (key === 'alerts') {
    set('status', filters.status);
    set('severity', filters.severity);
    return params;
  }

  if (key === 'deliveries') {
    set('station_id', filters.stationId);
    set('status', filters.status);
    return params;
  }

  set('from', filters.from);
  set('to', filters.to);
  set('station_id', filters.stationId);
  return params;
}

export function filtersForReport(key: FuelReportKey, filters: FuelReportFilters): FuelReportFilters {
  if (key === 'alerts') return { ...EMPTY_FUEL_REPORT_FILTERS, status: filters.status, severity: filters.severity };
  if (key === 'deliveries') return { ...EMPTY_FUEL_REPORT_FILTERS, stationId: filters.stationId, status: filters.status };
  return { ...EMPTY_FUEL_REPORT_FILTERS, from: filters.from, to: filters.to, stationId: filters.stationId };
}

export function supportedFilterNames(key: FuelReportKey): Array<keyof FuelReportFilters> {
  if (key === 'alerts') return ['status', 'severity'];
  if (key === 'deliveries') return ['stationId', 'status'];
  return ['from', 'to', 'stationId'];
}

export function hasObjectPayload(response: unknown): response is { data: Record<string, unknown> } {
  return !!response && typeof response === 'object' && !!(response as { data?: unknown }).data && typeof (response as { data?: unknown }).data === 'object';
}

export function hasReportData(key: FuelReportKey, response: unknown): boolean {
  if (key === 'alerts' || key === 'deliveries') return Array.isArray(collectionRows(response));
  return hasObjectPayload(response);
}

const AVI_DECISIONS = new Set(['approved', 'denied']);

const AVI_REASON_LABEL_KEYS: Record<string, string> = {
  AVI_CORPORATE_AUTHORIZATION_REQUIRED: 'corporateAuthorizationRequired',
  AVI_DRIVER_TAG_REQUIRED: 'driverTagRequired',
  AVI_DUAL_IDENTITY_REQUIRED: 'dualIdentityRequired',
  AVI_IDENTITY_CARD_MISMATCH: 'identityCardMismatch',
  AVI_IDENTITY_CONTRACT_MISMATCH: 'identityContractMismatch',
  AVI_IDENTITY_CREDENTIAL_INVALID: 'identityCredentialInvalid',
  AVI_IDENTITY_REQUIRED: 'identityRequired',
  AVI_NOZZLE_NOT_ACTIVE: 'nozzleNotActive',
  AVI_REFILL_INTERVAL_RESTRICTED: 'refillIntervalRestricted',
  AVI_RFID_DISABLED: 'aviRfidDisabled',
  AVI_STATION_NOT_ACTIVE: 'stationNotActive',
  AVI_VEHICLE_CAPACITY_EXCEEDED: 'vehicleCapacityExceeded',
  AVI_VEHICLE_TAG_REQUIRED: 'vehicleTagRequired',
  FUEL_CARD_FUEL_RESTRICTED: 'fuelRestricted',
  FUEL_CARD_NOT_ACTIVE: 'fuelCardNotActive',
  FUEL_CARD_REQUIRED: 'fuelCardRequired',
  FUEL_CARD_STATION_RESTRICTED: 'stationRestricted',
  FUEL_CARD_TIME_RESTRICTED: 'timeRestricted',
};

/** يسمح فقط بالقيم المدعومة في مفتاح الترجمة؛ غير ذلك يبقى «غير محدد» بلا رمز تقني. */
export function aviDecisionLabelKey(value: unknown): string {
  const decision = stringValue(value);
  return AVI_DECISIONS.has(decision) ? decision : 'unknown';
}

export function aviReasonLabelKey(value: unknown): string {
  return AVI_REASON_LABEL_KEYS[stringValue(value)] ?? 'unknown';
}

const FUEL_MOVEMENT_LABEL_KEYS: Record<string, string> = {
  opening: 'opening', delivery: 'delivery', sale: 'sale', transfer_in: 'transfer_in', transfer_out: 'transfer_out',
  adjustment_gain: 'adjustment_gain', adjustment_loss: 'adjustment_loss', evaporation: 'evaporation', stocktake: 'stocktake',
  reconciliation_matched: 'reconciliation_matched',
};

/** لا يكشف رمز حركة غير معروف للمستخدم؛ يعيد تسمية آمنة قابلة للترجمة. */
export function fuelMovementLabelKey(value: unknown): string {
  return FUEL_MOVEMENT_LABEL_KEYS[stringValue(value)] ?? 'unknown';
}
