// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: (...args: unknown[]) => apiMock(...args),
}));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));

import { ApiError } from '@/lib/api';
import { renderIntl } from '@/test-utils/intl';
import { OnboardingFlow } from './onboarding-flow';

const KEYS = ['occasions', 'recipients', 'gift_message', 'personalization', 'add_ons', 'delivery_scheduling', 'same_day_delivery', 'structured_content', 'vertical_sections'];

function open(configured: string[], { setupFail = false } = {}) {
  apiMock.mockImplementation(async (path: string) => {
    if (path.endsWith('/vertical-setup')) {
      if (setupFail) throw new ApiError(500, 'x', {});
      return { data: { setup: { vertical: 'flowers_gifts', items: KEYS.map((key) => ({ key, available: true, state: configured.includes(key) ? 'configured' : 'not_configured', count: configured.includes(key) ? 3 : 0, manage_in: 'x' })) } } };
    }
    if (path.endsWith('/gift-settings')) return { data: { gift_settings: { enabled: false, message_max_length: 250, allow_hide_sender: true, recipient_phone_required: true } } };
    if (path.endsWith('/delivery-schedule')) return { data: { settings: { enabled: true, required: true, timezone: 'Asia/Riyadh', lead_time_minutes: 0, cutoff_time: null, max_days_ahead: 30 }, slots: [], blocked_dates: [] } };
    if (path.endsWith('/fulfillment')) return { data: { fulfillment: { warehouse: null }, warehouses: [] } };
    throw new Error(`unexpected ${path}`);
  });
  renderIntl(<OnboardingFlow storeId="s1" locale="en" />, 'en');
}

beforeEach(() => window.history.replaceState(null, '', '/commerce/onboarding'));
afterEach(() => {
  cleanup();
  apiMock.mockReset();
});

const current = () => document.querySelector('[data-onboarding-step]')?.getAttribute('data-onboarding-step');

describe('OnboardingFlow', () => {
  it('resumes at the first unconfigured step derived from real state, with no stored flag', async () => {
    open(['occasions', 'recipients']);
    await screen.findByRole('heading', { name: 'Gift message' });
    expect(current()).toBe('gift_message');
    expect(screen.getByText('Step 3 of 9')).toBeTruthy();
    expect(document.querySelector('[data-onboarding-status]')?.textContent).toContain('Gifting is off');
    expect(document.querySelector('[data-onboarding-open]')?.getAttribute('href')).toBe('/commerce/gifting');
  });

  it('honours ?step= and moves with next/back, updating the URL', async () => {
    window.history.replaceState(null, '', '/commerce/onboarding?step=delivery_scheduling');
    open([]);
    await screen.findByRole('heading', { name: 'Delivery date & time slot' });
    expect(document.querySelector('[data-onboarding-open]')?.getAttribute('href')).toBe('/commerce/delivery?tab=windows');
    await userEvent.click(screen.getByRole('button', { name: /Next/ }));
    expect(current()).toBe('same_day_delivery');
    expect(window.location.search).toBe('?step=same_day_delivery');
    await userEvent.click(screen.getByRole('button', { name: /Back/ }));
    expect(current()).toBe('delivery_scheduling');
  });

  it('the first step has Back disabled and the last step offers finish instead of next', async () => {
    window.history.replaceState(null, '', '/commerce/onboarding?step=occasions');
    open([]);
    await screen.findByRole('heading', { name: 'Occasions' });
    expect((screen.getByRole('button', { name: /Back/ }) as HTMLButtonElement).disabled).toBe(true);
    window.history.replaceState(null, '', '/commerce/onboarding?step=vertical_sections');
    cleanup();
    open([]);
    await screen.findByRole('heading', { name: 'Gift store sections' });
    expect(document.querySelector('[data-onboarding-next]')).toBeNull();
    expect(document.querySelector('[data-onboarding-finish]')?.getAttribute('href')).toBe('/commerce');
  });

  it('offers the starters inline on catalog steps only', async () => {
    window.history.replaceState(null, '', '/commerce/onboarding?step=occasions');
    open([]);
    await waitFor(() => expect(document.querySelector('[data-starters-box]')).not.toBeNull());
    cleanup();
    window.history.replaceState(null, '', '/commerce/onboarding?step=gift_message');
    open([]);
    await screen.findByRole('heading', { name: 'Gift message' });
    expect(document.querySelector('[data-starters-box]')).toBeNull();
  });

  it('shows a configured step as done and an all-done notice when everything is set up', async () => {
    open(KEYS);
    await screen.findByRole('heading', { name: 'Occasions' });
    expect(current()).toBe('occasions');
    expect(document.querySelector('[data-onboarding-status]')?.textContent).toContain('This step is set up');
    expect(document.querySelector('[data-onboarding-complete]')).not.toBeNull();
  });

  it('shows a retryable error when the checklist cannot be read', async () => {
    open([], { setupFail: true });
    await screen.findByText('Could not load the settings. Try again.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy();
  });
});
