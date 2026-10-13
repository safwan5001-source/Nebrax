// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DeliveryHubPage from './page';
import { renderIntl, TEST_LOCALES, TEST_MESSAGES } from '@/test-utils/intl';

/**
 * INT-UX-3 — الهدف «صندوق التوصيل» محمي فعلاً بصلاحيته وليس مخفياً رابطه فقط: من لا يملك
 * `delivery_hub.view` يرى الرفض ولا يخرج أي طلب، ومن يملكها يُحمَّل له الصندوق (فلا يكون الاختبار فارغاً).
 */
const { api, currentUser } = vi.hoisted(() => ({ api: vi.fn(), currentUser: vi.fn() }));

vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('@/lib/auth', () => ({ currentUser }));

beforeEach(() => {
  api.mockReset();
  currentUser.mockReset();
  api.mockResolvedValue({ data: [], meta: { last_page: 1 } });
});
afterEach(cleanup);

describe.each(TEST_LOCALES)('delivery hub page gate (%s)', (locale) => {
  const m = TEST_MESSAGES[locale].deliveryHub;

  it.each([
    ['accountant', ['invoices.view', 'invoices.manage', 'reports.view']],
    ['staff', ['invoices.view', 'reports.view']],
    ['self_service', ['self_service.access']],
    ['custom with operate but no view', ['delivery_hub.operate']],
  ])('%s: forbidden state and zero requests', async (role, permissions) => {
    currentUser.mockReturnValue({ id: 'u1', role, permissions });
    renderIntl(<DeliveryHubPage />, locale);

    expect((await screen.findByTestId('delivery-hub-forbidden')).textContent).toContain(m.viewForbidden);
    expect(api).not.toHaveBeenCalled();
  });

  it('a user with delivery_hub.view gets the workspace and the hub is requested', async () => {
    currentUser.mockReturnValue({ id: 'u2', role: 'custom', permissions: ['delivery_hub.view'] });
    renderIntl(<DeliveryHubPage />, locale);

    await waitFor(() => expect(api).toHaveBeenCalled());
    expect(screen.queryByTestId('delivery-hub-forbidden')).toBeNull();
    expect(api.mock.calls.every(([path]) => String(path).startsWith('/delivery-hub'))).toBe(true);
  });
});
