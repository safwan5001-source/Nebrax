// @vitest-environment jsdom

import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { apiMock, currentUserMock } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  currentUserMock: vi.fn(),
}));

vi.mock('./api', () => ({ api: apiMock }));
vi.mock('./auth', () => ({
  AUTH_SESSION_CHANGED_EVENT: 'nibras:auth-session-changed',
  currentUser: currentUserMock,
}));

import { fetchCompany, invalidateCompany, notifyCompanyUpdated, useCompany } from './company';

const companyA = { name: 'شركة ألف' };
const companyB = { name: 'شركة باء' };
const userA = { id: 'user-a', tenant_id: 'tenant-a' };
const userB = { id: 'user-b', tenant_id: 'tenant-b' };

function CompanyName({ label }: { label: string }) {
  const company = useCompany();
  return <output data-testid={label}>{company?.name ?? 'loading'}</output>;
}

describe('company request ownership', () => {
  beforeEach(() => {
    invalidateCompany();
    currentUserMock.mockReturnValue(userA);
    apiMock.mockReset();
  });

  afterEach(() => {
    invalidateCompany();
  });

  it('shares one in-flight /me request between shell consumers', async () => {
    let resolve!: (value: { company: typeof companyA }) => void;
    apiMock.mockReturnValueOnce(new Promise((done) => { resolve = done; }));

    render(<><CompanyName label="sidebar" /><CompanyName label="topbar" /></>);

    expect(apiMock).toHaveBeenCalledTimes(1);
    expect(apiMock).toHaveBeenCalledWith('/me');

    resolve({ company: companyA });

    await waitFor(() => {
      expect(screen.getByTestId('sidebar').textContent).toBe(companyA.name);
      expect(screen.getByTestId('topbar').textContent).toBe(companyA.name);
    });
  });

  it('does not keep a failed request and retries normally', async () => {
    apiMock.mockRejectedValueOnce(new Error('temporary failure'));
    await expect(fetchCompany()).rejects.toThrow('temporary failure');

    apiMock.mockResolvedValueOnce({ company: companyA });
    await expect(fetchCompany()).resolves.toEqual(companyA);
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it('invalidates cached company data before a fresh fetch', async () => {
    apiMock.mockResolvedValueOnce({ company: companyA }).mockResolvedValueOnce({ company: companyB });

    await expect(fetchCompany()).resolves.toEqual(companyA);
    await expect(fetchCompany()).resolves.toEqual(companyA);
    expect(apiMock).toHaveBeenCalledTimes(1);

    invalidateCompany();
    await expect(fetchCompany()).resolves.toEqual(companyB);
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the company-updated refresh event as a fresh request', async () => {
    apiMock.mockResolvedValueOnce({ company: companyA }).mockResolvedValueOnce({ company: companyB });
    render(<CompanyName label="shell" />);

    await waitFor(() => expect(screen.getByTestId('shell').textContent).toBe(companyA.name));
    notifyCompanyUpdated();

    await waitFor(() => expect(screen.getByTestId('shell').textContent).toBe(companyB.name));
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it('does not reuse a previous company result after logout then login as another user', async () => {
    apiMock.mockResolvedValueOnce({ company: companyA }).mockResolvedValueOnce({ company: companyB });

    await expect(fetchCompany()).resolves.toEqual(companyA);
    currentUserMock.mockReturnValue(null); // logout
    window.dispatchEvent(new Event('nibras:auth-session-changed'));
    currentUserMock.mockReturnValue(userB); // next login
    await expect(fetchCompany()).resolves.toEqual(companyB);

    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it('invalidates the same user cache on logout before a later login', async () => {
    apiMock.mockResolvedValueOnce({ company: companyA }).mockResolvedValueOnce({ company: companyB });
    await expect(fetchCompany()).resolves.toEqual(companyA);

    currentUserMock.mockReturnValue(null);
    window.dispatchEvent(new Event('nibras:auth-session-changed'));
    currentUserMock.mockReturnValue(userA);

    await expect(fetchCompany()).resolves.toEqual(companyB);
    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it('does not reuse company data for a different tenant identity', async () => {
    apiMock.mockResolvedValueOnce({ company: companyA }).mockResolvedValueOnce({ company: companyB });

    await expect(fetchCompany()).resolves.toEqual(companyA);
    currentUserMock.mockReturnValue({ ...userA, tenant_id: 'tenant-b' });
    await expect(fetchCompany()).resolves.toEqual(companyB);

    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it('does not reuse company data after a tenant hostname transition', async () => {
    apiMock.mockResolvedValueOnce({ company: companyA }).mockResolvedValueOnce({ company: companyB });
    await expect(fetchCompany()).resolves.toEqual(companyA);

    const originalLocation = window.location;
    Object.defineProperty(window, 'location', {
      configurable: true,
      value: { ...originalLocation, origin: 'https://tenant-b.awjdev.xyz' },
    });
    try {
      await expect(fetchCompany()).resolves.toEqual(companyB);
    } finally {
      Object.defineProperty(window, 'location', { configurable: true, value: originalLocation });
    }

    expect(apiMock).toHaveBeenCalledTimes(2);
  });

  it('keeps the same user company result through a token rotation', async () => {
    apiMock.mockResolvedValueOnce({ company: companyA });

    await expect(fetchCompany()).resolves.toEqual(companyA);
    // Token rotation does not change the authenticated user or tenant identity.
    await expect(fetchCompany()).resolves.toEqual(companyA);

    expect(apiMock).toHaveBeenCalledTimes(1);
  });
});
