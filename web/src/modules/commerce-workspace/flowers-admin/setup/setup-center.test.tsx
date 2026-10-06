// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: (...args: unknown[]) => apiMock(...args),
}));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import { ApiError } from '@/lib/api';
import { renderIntl } from '@/test-utils/intl';
import { SetupCenter } from './setup-center';

afterEach(() => {
  cleanup();
  apiMock.mockReset();
});

const KEYS = ['occasions', 'recipients', 'gift_message', 'personalization', 'add_ons', 'delivery_scheduling', 'same_day_delivery', 'structured_content', 'vertical_sections'];
const items = (configured: string[]) => KEYS.map((key) => ({ key, available: true, state: configured.includes(key) ? 'configured' : 'not_configured', count: configured.includes(key) ? 3 : 0, manage_in: 'x' }));

type Opts = {
  configured?: string[];
  gift?: boolean | 'fail';
  schedule?: { enabled: boolean; windows: number } | 'fail';
  warehouse?: 'none' | 'inactive' | 'active' | 'fail';
  setupFail?: boolean;
};

function open(opts: Opts = {}) {
  apiMock.mockImplementation(async (path: string, options?: { method?: string }) => {
    if (path.endsWith('/vertical-setup/starters')) {
      if (options?.method === 'POST') return { data: { starters: { created: 22, facets: [] } } };
      return { data: { starters: { would_create: 22, facets: [{ system_key: 'occasion', facet: 'missing', missing_values: Array(12).fill({}), existing_values: [] }] } } };
    }
    if (path.endsWith('/vertical-setup')) {
      if (opts.setupFail) throw new ApiError(500, 'x', {});
      return { data: { setup: { vertical: 'flowers_gifts', items: items(opts.configured ?? []) } } };
    }
    if (path.endsWith('/gift-settings')) {
      if (opts.gift === 'fail') throw new ApiError(500, 'x', {});
      return { data: { gift_settings: { enabled: opts.gift === true, message_max_length: 250, allow_hide_sender: true, recipient_phone_required: true } } };
    }
    if (path.endsWith('/delivery-schedule')) {
      if (opts.schedule === 'fail') throw new ApiError(500, 'x', {});
      const s = opts.schedule ?? { enabled: false, windows: 0 };
      return { data: { settings: { enabled: s.enabled, required: true, timezone: 'Asia/Riyadh', lead_time_minutes: 0, cutoff_time: null, max_days_ahead: 30 }, slots: Array.from({ length: s.windows }, (_, i) => ({ id: `w${i}`, method: 'delivery', label: 'x', start_time: '09:00', end_time: '10:00', weekdays: [0], is_active: true })), blocked_dates: [] } };
    }
    if (path.endsWith('/fulfillment')) {
      if (opts.warehouse === 'fail') throw new ApiError(500, 'x', {});
      const w = opts.warehouse ?? 'none';
      return { data: { fulfillment: { warehouse: w === 'none' ? null : { id: 'w', code: '1', name: 'm', city: null, is_active: w === 'active' } }, warehouses: [] } };
    }
    throw new Error(`unexpected ${path}`);
  });
  renderIntl(<SetupCenter storeId="s1" locale="en" />, 'en');
}

const row = (key: string) => document.querySelector(`[data-setup-step="${key}"]`) as HTMLElement;

describe('SetupCenter', () => {
  it('groups the capabilities, shows real server state, and counts progress', async () => {
    open({ configured: ['occasions', 'recipients'] });
    await screen.findByText('Catalog & discovery');
    expect(Array.from(document.querySelectorAll('[data-setup-group]')).map((g) => g.getAttribute('data-setup-group'))).toEqual(['catalog', 'gifting', 'delivery', 'products', 'presentation']);
    expect(document.querySelector('[data-setup-progress]')?.textContent).toBe('2 of 9 set up');
    expect(row('occasions').getAttribute('data-state')).toBe('configured');
    expect(row('gift_message').getAttribute('data-state')).toBe('not_configured');
    expect(screen.getByRole('progressbar').getAttribute('aria-valuenow')).toBe('2');
  });

  it('explains what is missing in merchant language, derived from the real documents', async () => {
    open({ gift: false, schedule: { enabled: false, windows: 0 }, warehouse: 'none' });
    await screen.findByText('Gifting');
    expect(row('gift_message').textContent).toContain('Gifting is off; turn it on to show it to shoppers.');
    expect(row('delivery_scheduling').textContent).toContain('Delivery date selection is off');
    expect(row('same_day_delivery').textContent).toContain('Requires scheduling to be on first.');
    expect(row('same_day_delivery').textContent).toContain('No fulfilment warehouse is assigned');
    expect(row('personalization').textContent).toContain('Not set on any product yet.');
    expect(row('personalization').textContent).toContain('pick a product');
  });

  it('every action links to a real screen, with the right delivery tab for the real gap', async () => {
    open({ gift: false, schedule: { enabled: true, windows: 0 }, warehouse: 'none' });
    await screen.findByText('Delivery');
    const href = (key: string) => within(row(key)).getByRole('link').getAttribute('href');
    expect(href('occasions')).toBe('/commerce/merchandising');
    expect(href('gift_message')).toBe('/commerce/gifting');
    expect(href('delivery_scheduling')).toBe('/commerce/delivery?tab=windows');
    expect(href('same_day_delivery')).toBe('/commerce/delivery?tab=fulfilment');
    expect(href('personalization')).toBe('/products');
    expect(href('vertical_sections')).toBe('/commerce/appearance');
    expect(screen.getAllByRole('link').every((l) => (l.getAttribute('href') ?? '').startsWith('/'))).toBe(true);
  });

  it('points “Continue setup” at the first unfinished step, and shows completion when all are set up', async () => {
    open({ configured: ['occasions'] });
    expect((await screen.findByText('Continue setup')).closest('a')?.getAttribute('href')).toBe('/commerce/merchandising');
    cleanup();
    apiMock.mockReset();
    open({ configured: KEYS, gift: true, schedule: { enabled: true, windows: 1 }, warehouse: 'active' });
    expect(await screen.findByText(/Everything is set up/)).toBeTruthy();
    expect(screen.queryByText('Continue setup')).toBeNull();
  });

  it('degrades gracefully: unreadable documents give no invented reason, and a failed setup read offers retry', async () => {
    open({ gift: 'fail', schedule: 'fail', warehouse: 'fail' });
    await screen.findByText('Gifting');
    expect(row('gift_message').textContent).not.toContain('Gifting is off');
    expect(row('delivery_scheduling').textContent).not.toContain('is off');

    cleanup();
    apiMock.mockReset();
    open({ setupFail: true });
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(apiMock.mock.calls.filter((c) => String(c[0]).endsWith('/vertical-setup')).length).toBeGreaterThan(1));
  });

  it('keeps the additive starters flow: preview first, apply only on confirmation, then refresh the state', async () => {
    open();
    await userEvent.click(await screen.findByRole('button', { name: 'Preview starters' }));
    expect(await screen.findByText(/Occasions: \+12/)).toBeTruthy();
    expect(apiMock.mock.calls.some((c) => (c[1] as { method?: string } | undefined)?.method === 'POST')).toBe(false);
    await userEvent.click(screen.getByRole('button', { name: /^Add \(/ }));
    await waitFor(() => expect(apiMock.mock.calls.some((c) => (c[1] as { method?: string } | undefined)?.method === 'POST')).toBe(true));
    await waitFor(() => expect(apiMock.mock.calls.filter((c) => String(c[0]).endsWith('/vertical-setup')).length).toBe(2));
  });
});
