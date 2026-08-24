export type ReadinessAssetKind = 'station' | 'tank' | 'pump' | 'nozzle' | 'device' | 'accounting_asset';

export type ReadinessAsset = {
  id: string;
  kind: ReadinessAssetKind;
  name: string;
  code?: string | null;
  stationName?: string | null;
  stationId?: string | null;
  className: string;
};

const WORK_ORDER_TRANSITIONS: Record<string, string[]> = {
  reported: ['triaged'],
  triaged: ['scheduled', 'in_progress'],
  scheduled: ['in_progress'],
  in_progress: ['completed'],
  completed: ['verified'],
  verified: ['closed'],
  closed: [],
};

export function nextWorkOrderStatuses(status: string): string[] {
  return WORK_ORDER_TRANSITIONS[status] ?? [];
}

/** يعرض الأصل التشغيلي باسم ونوع ومحطة، ولا يكشف class name أو UUID في السياق البشري. */
export function readinessAssetLabel(asset: Pick<ReadinessAsset, 'kind' | 'name' | 'code' | 'stationName'>, labels: Record<ReadinessAssetKind, string>): string {
  const identity = asset.code ? `${asset.name} · ${asset.code}` : asset.name;
  const station = asset.stationName ? ` — ${asset.stationName}` : '';
  return `${labels[asset.kind]}: ${identity}${station}`;
}

const ALERT_RULE_LABEL_KEYS: Record<string, string> = {
  'fuel.maintenance.overdue': 'maintenanceOverdue',
  'fuel.maintenance.work_order_overdue': 'workOrderOverdue',
  'fuel.safety.corrective_action_overdue': 'correctiveActionOverdue',
  'fuel.safety.permit_expiring': 'permitExpiring',
  'fuel.device.sync_failed': 'deviceSyncFailed',
  'fuel.device.stale': 'deviceStale',
};

/** يربط قاعدة محرك التنبيه الداخلية بتسمية مترجمة، ولا يسمح بعرض المفتاح الخام. */
export function fuelAlertRuleLabelKey(rule: string): string {
  return ALERT_RULE_LABEL_KEYS[rule] ?? 'unknown';
}
