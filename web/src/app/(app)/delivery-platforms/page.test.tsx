// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DeliveryPlatformsPage from './page';
import { renderIntl, TEST_LOCALES, TEST_MESSAGES } from '@/test-utils/intl';

/**
 * INT-UX-3 — الهدف «ملفات منصات التوصيل» محمي فعلاً: بلا `invoices.view` رفض وصفر طلبات؛
 * ومن يملكها وحدها (محاسب/موظف) يقرأ القائمة ولا يُصدر أي كتابة (الكتابة `company.manage` على الخادم
 * وفي الواجهة، ومحروسة في `delivery-platforms-workspace.test.tsx`).
 */
const { api, currentUser } = vi.hoisted(() => ({ api: vi.fn(), currentUser: vi.fn() }));

vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('@/lib/auth', () => ({ currentUser }));

beforeEach(() => {
  api.mockReset();
  currentUser.mockReset();
  api.mockImplementation((path: string) => Promise.resolve(path === '/applications/nav-state' ? { data: { 'sales.pos': true } } : { data: [] }));
});
afterEach(cleanup);

describe.each(TEST_LOCALES)('delivery platforms page gate (%s)', (locale) => {
  const m = TEST_MESSAGES[locale].deliveryPlatforms;

  it.each([
    ['self_service', ['self_service.access']],
    ['custom without invoices.view', ['reports.view']],
  ])('%s: forbidden state and zero requests', async (role, permissions) => {
    currentUser.mockReturnValue({ id: 'u1', role, permissions });
    renderIntl(<DeliveryPlatformsPage />, locale);

    expect((await screen.findByTestId('delivery-platforms-forbidden')).textContent).toContain(m.viewForbidden);
    expect(api).not.toHaveBeenCalled();
  });

  it.each([
    ['accountant', ['invoices.view', 'invoices.manage', 'reports.view']],
    ['staff', ['invoices.view', 'reports.view']],
  ])('%s: can read the list and never issues a write request', async (role, permissions) => {
    currentUser.mockReturnValue({ id: 'u2', role, permissions });
    renderIntl(<DeliveryPlatformsPage />, locale);

    await waitFor(() => expect(api.mock.calls.some(([path]) => path === '/delivery-platforms')).toBe(true));
    expect(screen.queryByTestId('delivery-platforms-forbidden')).toBeNull();
    expect(api.mock.calls.every(([, options]) => !options || (options as { method?: string }).method === undefined || (options as { method?: string }).method === 'GET')).toBe(true);
  });
});
