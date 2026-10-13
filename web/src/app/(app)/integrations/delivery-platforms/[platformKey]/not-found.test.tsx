// @vitest-environment jsdom
import { cleanup, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DeliveryPlatformNotFound from './not-found';
import { renderIntl, TEST_LOCALES, TEST_MESSAGES } from '@/test-utils/intl';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));

afterEach(cleanup);

describe.each(TEST_LOCALES)('delivery platform not-found boundary (%s)', (locale) => {
  const m = TEST_MESSAGES[locale].integrationCenter;

  it('shows the not-found message with a way back, and no ladder or data', () => {
    renderIntl(<DeliveryPlatformNotFound />, locale);

    const root = screen.getByTestId('delivery-platform-unknown');
    expect(within(root).getByRole('heading', { level: 1 }).textContent).toBe(m.detail.unknownTitle);
    expect(within(root).getByRole('link', { name: m.detail.backToCatalog }).getAttribute('href')).toBe('/integrations/delivery-platforms');
    expect(screen.queryByTestId('capability-ladder')).toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(api).not.toHaveBeenCalled();
  });
});
