// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { renderIntl } from '@/test-utils/intl';
import { ToastProvider } from '@/components/ui/toast';

const { api } = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api };
});
vi.mock('@/lib/auth', () => ({ currentUser: () => ({ role: 'owner', permissions: ['*'] }) }));

import { ApiError } from '@/lib/api';
import FuelStationsSettingsPage from './page';

afterEach(() => { cleanup(); api.mockReset(); });

function renderPage(locale: 'ar' | 'en' = 'en') {
  return renderIntl(<ToastProvider><FuelStationsSettingsPage /></ToastProvider>, locale);
}

describe('Fuel settings when the first load fails (ERP-UX-023)', () => {
  it('shows the page title and a localized forbidden state instead of endless skeletons', async () => {
    api.mockRejectedValue(new ApiError(403, 'لا تتوفر صلاحية فعالة لهذه القدرة.', {}));
    renderPage('en');
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain("isn't available");
    expect(screen.queryByRole('button', { name: /refresh/i })).toBeNull();
    expect(document.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('offers a retry for other failures', async () => {
    api.mockRejectedValue(new ApiError(500, 'Server error', {}));
    renderPage('en');
    expect(await screen.findByRole('heading', { level: 1 })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain('Server error');
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
  });
});
