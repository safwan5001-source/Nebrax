import { beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

import { channelSettingsPath, deriveReadiness, fetchChannelSettings, updateChannelSettings, type ChannelSettings } from './channel';

const settings = (over: Partial<ChannelSettings> = {}): ChannelSettings => ({
  id: 'c1',
  name: 'Wholesale',
  type: 'web',
  default_price_list: null,
  wholesale_membership_enabled: false,
  wholesale_deployment_enabled: false,
  ...over,
});

describe('deriveReadiness', () => {
  it('has no channel when the store has none, whatever the settings state', () => {
    expect(deriveReadiness({ salesChannelId: null, settings: { status: 'loading' } })).toBe('no_channel');
  });

  it('is loading until settings resolve, unavailable when they cannot be read', () => {
    expect(deriveReadiness({ salesChannelId: 'c1', settings: { status: 'loading' } })).toBe('loading');
    expect(deriveReadiness({ salesChannelId: 'c1', settings: { status: 'error' } })).toBe('settings_unavailable');
  });

  it('is dark while the deployment switch is off, even if the channel flag is on', () => {
    expect(deriveReadiness({ salesChannelId: 'c1', settings: { status: 'ready', data: settings() } })).toBe('deployment_off');
    expect(
      deriveReadiness({ salesChannelId: 'c1', settings: { status: 'ready', data: settings({ wholesale_membership_enabled: true }) } }),
    ).toBe('deployment_off');
  });

  it('is active only when the switch is on and the channel is marked', () => {
    expect(
      deriveReadiness({ salesChannelId: 'c1', settings: { status: 'ready', data: settings({ wholesale_deployment_enabled: true }) } }),
    ).toBe('channel_not_marked');
    expect(
      deriveReadiness({
        salesChannelId: 'c1',
        settings: { status: 'ready', data: settings({ wholesale_deployment_enabled: true, wholesale_membership_enabled: true }) },
      }),
    ).toBe('active');
  });
});

describe('channel settings client', () => {
  beforeEach(() => apiMock.mockReset());

  it('reads and writes only the pricing-settings endpoint, sending no tenant', async () => {
    apiMock.mockResolvedValue({ data: settings() });
    await fetchChannelSettings('c 1');
    expect(apiMock).toHaveBeenLastCalledWith('/commerce/channels/c%201/pricing-settings');
    await updateChannelSettings('c1', { default_price_list_id: null });
    expect(apiMock).toHaveBeenLastCalledWith(channelSettingsPath('c1'), { method: 'PUT', body: { default_price_list_id: null } });
    expect(JSON.stringify(apiMock.mock.calls)).not.toContain('tenant');
  });
});
