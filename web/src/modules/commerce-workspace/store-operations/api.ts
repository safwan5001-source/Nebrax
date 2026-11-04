import { api } from '@/lib/api';

/**
 * COPS-H4-3 (UI) — إعدادات تشغيل قناة المتجر: `GET|PUT /commerce/channels/{id}/operations-settings` (الصلاحية `commerce.channel_settings.manage`، owner/admin). الخادم هو المصدر
 * الوحيد للقيم وللنسخة (`version`) ولحالة بوابة النشر `intake_controls_deployment_enabled`؛ المتصفح لا يستنتج شيئاً منها. `expected_version` إلزامي في كل كتابة.
 */
export type Period = { weekday: number; opens_at: string; closes_at: string };
export type OutsideHoursPolicy = 'accept' | 'block';
export type MinOrderScope = 'all' | 'delivery_only';

export type OperationsView = {
  version: number;
  acceptingOrders: boolean;
  pausedUntil: string | null;
  pauseMessage: string | null;
  outsideHoursPolicy: OutsideHoursPolicy;
  openingHours: Period[];
  minOrderMinor: number | null;
  minOrderScope: MinOrderScope;
  /** `commerce.channel_intake_controls_enabled` — مغلقة ⇒ تُخزَّن الإعدادات ولا يطبَّق الإيقاف/المنع/الحد الأدنى في Checkout. */
  deploymentEnabled: boolean;
};

/** ما يُرسَل: مجموعة جزئية من المفاتيح (التغييرات فقط). */
export type OperationsChanges = Partial<{
  accepting_orders: boolean;
  paused_until: string | null;
  pause_message: string | null;
  outside_hours_policy: OutsideHoursPolicy;
  opening_hours: Period[];
  min_order_minor: number | null;
  min_order_scope: MinOrderScope;
}>;

type Raw = Record<string, unknown>;

function mapPeriod(raw: unknown): Period | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Raw;
  if (typeof p.weekday !== 'number' || !Number.isInteger(p.weekday) || typeof p.opens_at !== 'string' || typeof p.closes_at !== 'string') return null;

  return { weekday: p.weekday, opens_at: p.opens_at, closes_at: p.closes_at };
}

export function mapOperations(payload: unknown): OperationsView | null {
  const d = (payload as { data?: Raw } | null)?.data;
  if (!d || typeof d.version !== 'number' || typeof d.accepting_orders !== 'boolean' || !Array.isArray(d.opening_hours)) return null;
  const policy = d.outside_hours_policy;
  const scope = d.min_order_scope;
  if ((policy !== 'accept' && policy !== 'block') || (scope !== 'all' && scope !== 'delivery_only')) return null;
  if (d.min_order_minor !== null && (typeof d.min_order_minor !== 'number' || !Number.isInteger(d.min_order_minor))) return null;

  return {
    version: d.version,
    acceptingOrders: d.accepting_orders,
    pausedUntil: typeof d.paused_until === 'string' ? d.paused_until : null,
    pauseMessage: typeof d.pause_message === 'string' ? d.pause_message : null,
    outsideHoursPolicy: policy,
    openingHours: d.opening_hours.map(mapPeriod).filter((p): p is Period => p !== null),
    minOrderMinor: d.min_order_minor as number | null,
    minOrderScope: scope,
    deploymentEnabled: d.intake_controls_deployment_enabled === true,
  };
}

const path = (channelId: string) => `/commerce/channels/${encodeURIComponent(channelId)}/operations-settings`;

export async function fetchOperations(channelId: string): Promise<OperationsView> {
  const view = mapOperations(await api<unknown>(path(channelId)));
  if (!view) throw new Error('operations settings response not recognised');

  return view;
}

export async function saveOperations(channelId: string, expectedVersion: number, changes: OperationsChanges): Promise<OperationsView> {
  const view = mapOperations(await api<unknown>(path(channelId), { method: 'PUT', body: { expected_version: expectedVersion, ...changes } }));
  if (!view) throw new Error('operations settings response not recognised');

  return view;
}
