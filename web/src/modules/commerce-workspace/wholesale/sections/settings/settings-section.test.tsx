// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const locale = vi.hoisted(() => ({ current: 'en' }));
vi.mock('next-intl', () => {
  const t = (key: string) => key;
  return { useLocale: () => locale.current, useTranslations: () => t };
});
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));

const can = vi.hoisted(() => ({ allowed: new Set<string>() }));
vi.mock('@/lib/use-can', () => ({ useCan: () => ({ hydrated: true, can: (p: string) => can.allowed.has(p) }) }));

const channel = vi.hoisted(() => ({ value: {} as Record<string, unknown>, apply: vi.fn(), reload: vi.fn() }));
vi.mock('../../channel-context', () => ({ useWholesaleChannel: () => channel.value }));

const apiMock = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

import { ToastProvider } from '@/components/ui/toast';
import type { ChannelSettings } from '../../channel';
import { COMMERCIAL_RULES } from './commercial-rules';
import { saveErrorKey } from './channel-config';
import { SettingsSection } from './settings-section';

const base = (over: Partial<ChannelSettings> = {}): ChannelSettings => ({
  id: 'c1',
  name: 'Wholesale',
  type: 'web',
  default_price_list: { id: 'pl1', name: 'Trade prices', is_active: true },
  wholesale_membership_enabled: false,
  wholesale_deployment_enabled: true,
  recent_changes: [],
  ...over,
});

function setChannel(settings: ChannelSettings | { status: string; kind?: string }, readiness = 'channel_not_marked') {
  const resolved = 'status' in settings ? settings : { status: 'ready', data: settings };
  channel.value = {
    readiness,
    channelId: 'c1',
    store: { id: 's1', name: 'Wholesale Store' },
    settings: resolved,
    applySettings: channel.apply,
    reloadSettings: channel.reload,
  };
}

const mount = () => render(<ToastProvider><SettingsSection /></ToastProvider>);
const markSwitch = () => screen.getByRole('switch');
const apiError = (status: number, body: Record<string, unknown>) => Object.assign(new Error('x'), { status, body });

describe('SettingsSection', () => {
  beforeEach(() => {
    locale.current = 'en';
    can.allowed = new Set(['commerce.channel_settings.manage']);
    channel.apply.mockReset();
    channel.reload.mockReset();
    apiMock.mockReset();
    setChannel(base());
  });
  afterEach(cleanup);

  it('shows a permission-denied state and sends nothing without commerce.channel_settings.manage', () => {
    can.allowed = new Set();
    mount();
    expect(screen.getByText('You do not have access to this section')).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('reads channel state from the context without any request of its own', () => {
    mount();
    expect(apiMock).not.toHaveBeenCalled();
    expect(screen.getByText('Open')).toBeTruthy(); // deployment switch (read-only)
    expect(screen.getByText('Trade prices')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Manage price lists' }).getAttribute('href')).toContain('/commerce/wholesale/price-lists');
  });

  it('turning ON asks for confirmation first, explains the retail hazard, then sends exactly {wholesale_membership_enabled: true}', async () => {
    const updated = base({ wholesale_membership_enabled: true });
    apiMock.mockResolvedValue({ data: updated });
    mount();
    fireEvent.click(markSwitch());
    expect(apiMock).not.toHaveBeenCalled();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/hides prices, cart and checkout from any visitor who is not an approved buyer/)).toBeTruthy();
    expect(within(dialog).getByText(/Do not mark a retail channel/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Mark channel wholesale' }));
    await waitFor(() => expect(channel.apply).toHaveBeenCalledWith(updated));
    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith('/commerce/channels/c1/pricing-settings', { method: 'PUT', body: { wholesale_membership_enabled: true } });
    expect(JSON.stringify(apiMock.mock.calls)).not.toContain('tenant');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('cancelling the confirmation sends nothing', () => {
    mount();
    fireEvent.click(markSwitch());
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }));
    expect(apiMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('turning OFF also confirms, describes the effect, and sends {wholesale_membership_enabled: false}', async () => {
    setChannel(base({ wholesale_membership_enabled: true }), 'active');
    const updated = base({ wholesale_membership_enabled: false });
    apiMock.mockResolvedValue({ data: updated });
    mount();
    fireEvent.click(markSwitch());
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/any visitor sees prices and can order without a membership/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Remove mark' }));
    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/commerce/channels/c1/pricing-settings', { method: 'PUT', body: { wholesale_membership_enabled: false } }));
    await waitFor(() => expect(channel.apply).toHaveBeenCalledWith(updated));
  });

  it('disables turning ON while the deployment switch is closed, and explains why', () => {
    setChannel(base({ wholesale_deployment_enabled: false }), 'deployment_off');
    mount();
    expect((markSwitch() as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText('The channel cannot be marked while the wholesale deployment switch is closed.')).toBeTruthy();
    expect(screen.getByText('Closed')).toBeTruthy();
    fireEvent.click(markSwitch());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(apiMock).not.toHaveBeenCalled();
  });

  it('still lets a marked channel be un-marked while the deployment switch is closed', () => {
    setChannel(base({ wholesale_deployment_enabled: false, wholesale_membership_enabled: true }), 'deployment_off');
    mount();
    expect((markSwitch() as HTMLButtonElement).disabled).toBe(false);
  });

  it('maps a server 409 wholesale_deployment_disabled to a clear message and keeps the old state', async () => {
    apiMock.mockRejectedValue(apiError(409, { message: 'x', reason: 'wholesale_deployment_disabled' }));
    mount();
    fireEvent.click(markSwitch());
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark channel wholesale' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('The wholesale deployment switch is closed');
    expect(channel.apply).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).toBeTruthy();
  });

  it('shows a generic error for other failures', async () => {
    apiMock.mockRejectedValue(apiError(500, {}));
    mount();
    fireEvent.click(markSwitch());
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Mark channel wholesale' }));
    expect((await screen.findByRole('alert')).textContent).toBe('Could not save the setting. Please try again.');
  });

  it('shows the audit trail with actor, time and a readable before→after, never raw ids', () => {
    setChannel(
      base({
        recent_changes: [
          { at: '2026-03-01T10:00:00Z', actor: { id: 'u1', name: 'Dana Owner' }, changes: { wholesale_membership_enabled: { from: false, to: true } } },
          { at: '2026-02-01T10:00:00Z', actor: null, changes: { default_price_list_id: { from: null, to: 'f1c0a0de-0000-4000-8000-000000000000' } } },
        ],
      }),
      'active',
    );
    mount();
    const events = screen.getAllByTestId('audit-event');
    expect(events).toHaveLength(2);
    expect(events[0].textContent).toContain('by Dana Owner');
    expect(events[0].textContent).toContain('Not marked → Marked');
    expect(events[1].textContent).toContain('List assigned');
    expect(events[1].textContent).toContain('Unknown user');
    expect(document.body.textContent).not.toContain('f1c0a0de');
  });

  it('shows the loading, forbidden and error states of the settings read', () => {
    setChannel({ status: 'loading' }, 'loading');
    mount();
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);
    cleanup();

    setChannel({ status: 'error', kind: 'forbidden' }, 'settings_unavailable');
    mount();
    expect(screen.getByText(/requires the “commerce\.channel_settings\.manage” permission/)).toBeTruthy();
    cleanup();

    setChannel({ status: 'error', kind: 'network' }, 'settings_unavailable');
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    expect(channel.reload).toHaveBeenCalled();
  });

  it('lists the buyer-access policy as facts, with no inputs, and a deferred panel for configurable policies', () => {
    mount();
    const policy = screen.getByRole('region', { name: 'Buyer-access policy' }) ?? screen.getByText('Buyer-access policy');
    expect(policy).toBeTruthy();
    expect(screen.getByText(/Approval is manual/)).toBeTruthy();
    expect(screen.getByText(/must verify their email/)).toBeTruthy();
    expect(screen.getByText(/the cart is kept as it is, and reinstatement restores it/)).toBeTruthy();
    expect(screen.getByText(/Rejection is final/)).toBeTruthy();
    const deferred = screen.getByTestId('deferred-capability');
    expect(deferred.textContent).toMatch(/no settings model for access policy/);
    expect(deferred.querySelector('input,button,select')).toBeNull();
  });

  it('renders every commercial rule read-only with its pending decision and no way to edit it', () => {
    mount();
    for (const rule of COMMERCIAL_RULES) {
      for (const decision of rule.decisions) expect(screen.getAllByText(new RegExp(`^${decision} ·`)).length).toBeGreaterThan(0);
    }
    expect(screen.getAllByText('Not configurable yet').length).toBeGreaterThanOrEqual(COMMERCIAL_RULES.length);
    expect(screen.getAllByText('Minimum order quantity (MOQ)').length).toBeGreaterThan(0);
    // The only form control on the whole screen is the channel-mark switch.
    expect(screen.getAllByRole('switch')).toHaveLength(1);
    expect(document.querySelectorAll('input, select, textarea')).toHaveLength(0);
    expect(screen.getByRole('link', { name: /Sales settings in AWJ/ }).getAttribute('href')).toBe('/sales-settings');
  });

  it('renders in Arabic', () => {
    locale.current = 'ar';
    mount();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('إعدادات الجملة');
    expect(screen.getByText('إعداد القناة')).toBeTruthy();
    expect(screen.getAllByText('غير قابلة للضبط بعد').length).toBeGreaterThan(0);
  });
});

describe('saveErrorKey', () => {
  it('maps server reasons and statuses', () => {
    expect(saveErrorKey(apiError(409, { reason: 'wholesale_deployment_disabled' }))).toBe('error.wholesale_deployment_disabled');
    expect(saveErrorKey(apiError(422, { reason: 'channel_not_web' }))).toBe('error.channel_not_web');
    expect(saveErrorKey(apiError(404, {}))).toBe('error.not_found');
    expect(saveErrorKey(new Error('offline'))).toBe('error.generic');
  });
});
