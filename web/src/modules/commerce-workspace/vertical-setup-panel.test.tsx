// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: (...args: unknown[]) => apiMock(...args),
}));

import { VerticalSetupPanel } from './vertical-setup-panel';

afterEach(() => {
  cleanup();
  apiMock.mockReset();
});

const ITEMS = [
  { key: 'occasions', available: true, state: 'not_configured', count: 0, manage_in: 'merchandising' },
  { key: 'gift_message', available: true, state: 'configured', count: 1, manage_in: 'gift_settings' },
  { key: 'delivery_scheduling', available: true, state: 'not_configured', count: 0, manage_in: 'delivery_schedule' },
  { key: 'unknown_future_capability', available: true, state: 'configured', count: 1, manage_in: 'x' },
];
const setup = (items = ITEMS) => ({ data: { setup: { vertical: 'flowers_gifts', items } } });
const previewBody = (wouldCreate: number, blocked = false) => ({
  data: {
    starters: {
      would_create: wouldCreate,
      facets: [
        { system_key: 'occasion', facet: blocked ? 'blocked' : 'existing', missing_values: Array(wouldCreate).fill({}), existing_values: [1] },
        { system_key: 'recipient', facet: 'missing', missing_values: [], existing_values: [] },
      ],
    },
  },
});

describe('VerticalSetupPanel', () => {
  it('shows real state per capability, links only to screens that exist, and hides unknown keys', async () => {
    apiMock.mockResolvedValueOnce(setup());
    render(<VerticalSetupPanel storeId="s1" locale="en" />);

    await waitFor(() => expect(document.querySelector('[data-vertical-setup]')).not.toBeNull());
    expect(document.querySelector('[data-setup-item="unknown_future_capability"]')).toBeNull();
    expect(document.querySelector('[data-setup-progress]')?.textContent).toContain('1 / 3');

    const occasions = document.querySelector('[data-setup-item="occasions"]') as HTMLElement;
    expect(occasions.textContent).toContain('Not set up');
    expect(occasions.querySelector('a')?.getAttribute('href')).toBe('/commerce/merchandising');

    const schedule = document.querySelector('[data-setup-item="delivery_scheduling"]') as HTMLElement;
    expect(schedule.querySelector('a')).toBeNull();
    expect(schedule.textContent).toContain('No screen yet');

    expect((document.querySelector('[data-setup-item="gift_message"]') as HTMLElement).textContent).toContain('Set up');
  });

  it('shows an error state when the status cannot be read', async () => {
    apiMock.mockRejectedValueOnce(new Error('x'));
    render(<VerticalSetupPanel storeId="s1" locale="en" />);
    expect(await screen.findByText('Could not load the setup status. Try again.')).toBeTruthy();
  });

  it('previews first, applies only on confirmation, then refreshes the checklist', async () => {
    apiMock
      .mockResolvedValueOnce(setup())
      .mockResolvedValueOnce(previewBody(5))
      .mockResolvedValueOnce({ data: { starters: { created: 5, facets: [] } } })
      .mockResolvedValueOnce(setup([{ ...ITEMS[0], state: 'configured', count: 12 }]));
    render(<VerticalSetupPanel storeId="s1" locale="en" />);
    await screen.findByText('Preview starters');

    fireEvent.click(screen.getByText('Preview starters'));
    await waitFor(() => expect(document.querySelector('[data-starter-preview]')).not.toBeNull());
    // Nothing was written by the preview.
    expect(apiMock.mock.calls.map((c) => c[1]?.method ?? 'GET')).toEqual(['GET', 'GET']);
    expect(document.querySelector('[data-starter-preview]')?.textContent).toContain('+5');

    fireEvent.click(screen.getByText('Add (5)'));
    await screen.findByText('Starter values added (5)');
    expect(apiMock.mock.calls[2][1]).toEqual({ method: 'POST' });
    await waitFor(() => expect(document.querySelector('[data-setup-progress]')?.textContent).toContain('1 / 1'));
  });

  it('offers no apply button when there is nothing new, and cancel discards the preview', async () => {
    apiMock.mockResolvedValueOnce(setup()).mockResolvedValueOnce(previewBody(0));
    render(<VerticalSetupPanel storeId="s1" locale="en" />);
    await screen.findByText('Preview starters');
    fireEvent.click(screen.getByText('Preview starters'));
    await screen.findByText('You already have every starter value.');
    expect(screen.queryByText(/^Add \(/)).toBeNull();
    fireEvent.click(screen.getByText('Cancel'));
    expect(document.querySelector('[data-starter-preview]')).toBeNull();
  });

  it('tells the merchant when one of their own dimensions was left alone', async () => {
    apiMock.mockResolvedValueOnce(setup()).mockResolvedValueOnce(previewBody(2, true));
    render(<VerticalSetupPanel storeId="s1" locale="en" />);
    await screen.findByText('Preview starters');
    fireEvent.click(screen.getByText('Preview starters'));
    expect(await screen.findByText(/will not touch it/)).toBeTruthy();
  });

  it('reports a failed apply without claiming success', async () => {
    apiMock
      .mockResolvedValueOnce(setup())
      .mockResolvedValueOnce(previewBody(3))
      .mockRejectedValueOnce(new Error('500'));
    render(<VerticalSetupPanel storeId="s1" locale="en" />);
    await screen.findByText('Preview starters');
    fireEvent.click(screen.getByText('Preview starters'));
    fireEvent.click(await screen.findByText('Add (3)'));
    expect(await screen.findByText('That did not work. Nothing changed — try again.')).toBeTruthy();
    expect(screen.queryByText(/Starter values added/)).toBeNull();
  });

  it('renders Arabic copy for the Arabic locale', async () => {
    apiMock.mockResolvedValueOnce(setup());
    render(<VerticalSetupPanel storeId="s1" locale="ar" />);
    expect(await screen.findByText('إعداد نشاط الهدايا')).toBeTruthy();
    expect(screen.getByText('معاينة القيم المبدئية')).toBeTruthy();
  });
});
