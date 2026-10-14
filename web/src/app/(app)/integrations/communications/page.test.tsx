// @vitest-environment jsdom
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import CommunicationsProvidersPage from './page';
import { renderIntl, TEST_MESSAGES } from '@/test-utils/intl';

const { api, currentUser } = vi.hoisted(() => ({ api: vi.fn(), currentUser: vi.fn() }));

vi.mock('@/lib/api', () => ({ api, ApiError: class ApiError extends Error {} }));
vi.mock('@/lib/auth', () => ({ currentUser }));

const m = TEST_MESSAGES.ar.integrationCenter;

beforeEach(() => {
  api.mockReset();
  currentUser.mockReset();
});
afterEach(cleanup);

describe('CommunicationsProvidersPage', () => {
  it('owner sees the static catalog and the page makes no API request at all', async () => {
    currentUser.mockReturnValue({ id: 'u1', role: 'owner', permissions: ['*'] });
    renderIntl(<CommunicationsProvidersPage />, 'ar');

    await waitFor(() => expect(screen.getByTestId('communications-catalog')).toBeTruthy());
    expect(screen.getByTestId('communications-truth-note')).toBeTruthy();
    expect(api).not.toHaveBeenCalled();
  });

  it('a user without company.manage is denied and sees no provider', async () => {
    currentUser.mockReturnValue({ id: 'u2', role: 'custom', permissions: ['invoices.view'] });
    renderIntl(<CommunicationsProvidersPage />, 'ar');

    await waitFor(() => expect(screen.getByTestId('communications-restricted')).toBeTruthy());
    expect(screen.getByRole('note').textContent).toBe(m.communications.denied);
    expect(document.querySelectorAll('[data-testid^="communications-provider-"]')).toHaveLength(0);
    expect(api).not.toHaveBeenCalled();
  });

  it('an unknown session is denied', async () => {
    currentUser.mockReturnValue(null);
    renderIntl(<CommunicationsProvidersPage />, 'ar');

    await waitFor(() => expect(screen.getByTestId('communications-restricted')).toBeTruthy());
  });
});
