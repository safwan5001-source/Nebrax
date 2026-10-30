import type { ChannelSettings } from '../../channel';

export type CheckState = 'done' | 'todo' | 'unknown';

export type ChecklistItem = {
  key: 'deployment' | 'marked' | 'priceList';
  state: CheckState;
  /** Price-list name for the `done` wording. */
  detail?: string;
};

export type SettingsView = { status: 'loading' } | { status: 'ready'; data: ChannelSettings } | { status: 'error' };

/** The three readiness conditions, derived from the settings the server returned — `unknown` until they are read. */
export function buildChecklist(settings: SettingsView): ChecklistItem[] {
  if (settings.status !== 'ready') {
    return (['deployment', 'marked', 'priceList'] as const).map((key) => ({ key, state: 'unknown' as const }));
  }
  const { data } = settings;
  return [
    { key: 'deployment', state: data.wholesale_deployment_enabled ? 'done' : 'todo' },
    { key: 'marked', state: data.wholesale_membership_enabled ? 'done' : 'todo' },
    { key: 'priceList', state: data.default_price_list ? 'done' : 'todo', detail: data.default_price_list?.name },
  ];
}

export type AlertKey = 'settings_unreadable' | 'pending' | 'no_price_list' | 'price_list_inactive';
export type OverviewAlert = { key: AlertKey; vars?: Record<string, string | number> };

/** Alerts come only from state we actually hold: unreadable settings, an unset/inactive list, a real pending count. */
export function buildAlerts(settings: SettingsView, pendingCount: number | null): OverviewAlert[] {
  const alerts: OverviewAlert[] = [];
  if (settings.status === 'error') alerts.push({ key: 'settings_unreadable' });
  if (pendingCount !== null && pendingCount > 0) alerts.push({ key: 'pending', vars: { count: pendingCount } });
  if (settings.status === 'ready') {
    const list = settings.data.default_price_list;
    if (!list) alerts.push({ key: 'no_price_list' });
    else if (!list.is_active) alerts.push({ key: 'price_list_inactive', vars: { name: list.name } });
  }
  return alerts;
}
