import { describe, expect, it } from 'vitest';
import type { ChannelSettings } from '../../channel';
import { buildAlerts, buildChecklist } from './checklist';

const settings = (over: Partial<ChannelSettings> = {}): ChannelSettings => ({
  id: 'c',
  name: 'W',
  type: 'web',
  default_price_list: null,
  wholesale_membership_enabled: false,
  wholesale_deployment_enabled: false,
  ...over,
});

describe('overview checklist', () => {
  it('is unknown everywhere until settings are read', () => {
    for (const view of [{ status: 'loading' as const }, { status: 'error' as const }]) {
      expect(buildChecklist(view).map((i) => i.state)).toEqual(['unknown', 'unknown', 'unknown']);
    }
  });

  it('reflects the three real conditions', () => {
    expect(buildChecklist({ status: 'ready', data: settings() }).map((i) => i.state)).toEqual(['todo', 'todo', 'todo']);
    const full = buildChecklist({
      status: 'ready',
      data: settings({ wholesale_deployment_enabled: true, wholesale_membership_enabled: true, default_price_list: { id: 'p', name: 'Gold', is_active: true } }),
    });
    expect(full.map((i) => i.state)).toEqual(['done', 'done', 'done']);
    expect(full[2].detail).toBe('Gold');
  });
});

describe('overview alerts', () => {
  it('invents nothing while settings and counts are unknown', () => {
    expect(buildAlerts({ status: 'loading' }, null)).toEqual([]);
    expect(buildAlerts({ status: 'error' }, null).map((a) => a.key)).toEqual(['settings_unreadable']);
  });

  it('raises alerts only from real state', () => {
    expect(buildAlerts({ status: 'ready', data: settings() }, 0).map((a) => a.key)).toEqual(['no_price_list']);
    expect(buildAlerts({ status: 'ready', data: settings({ default_price_list: { id: 'p', name: 'Old', is_active: false } }) }, 3)).toEqual([
      { key: 'pending', vars: { count: 3 } },
      { key: 'price_list_inactive', vars: { name: 'Old' } },
    ]);
    expect(buildAlerts({ status: 'ready', data: settings({ default_price_list: { id: 'p', name: 'Gold', is_active: true } }) }, 0)).toEqual([]);
  });
});
