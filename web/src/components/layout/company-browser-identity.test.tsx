// @vitest-environment jsdom

import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { useCompanyMock } = vi.hoisted(() => ({
  useCompanyMock: vi.fn(),
}));

vi.mock('@/lib/company', () => ({
  useCompany: useCompanyMock,
}));

import { AuthenticatedCompanyBrowserIdentity, CompanyBrowserIdentity, safeCompanyIconUrl } from './company-browser-identity';

const LOGO_A = 'data:image/png;base64,iVBORw0KGgo=';
const LOGO_B = 'https://cdn.example.test/company-b.webp';

function headLinks() {
  return {
    icon: document.head.querySelector('link[rel="icon"]'),
    apple: document.head.querySelector('link[rel="apple-touch-icon"]'),
  };
}

describe('company browser identity', () => {
  beforeEach(() => {
    document.head.innerHTML = '';
    useCompanyMock.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  it('uses a tenant company logo for both browser and Apple identity', async () => {
    useCompanyMock.mockReturnValue({ name: 'Tenant A', logo: LOGO_A });

    render(<CompanyBrowserIdentity />);

    await waitFor(() => {
      expect(headLinks().icon?.getAttribute('href')).toBe(LOGO_A);
      expect(headLinks().apple?.getAttribute('href')).toBe(LOGO_A);
    });
  });

  it('switches from Tenant A to Tenant B without reusing the previous identity', async () => {
    useCompanyMock.mockReturnValue({ name: 'Tenant A', logo: LOGO_A });
    const view = render(<CompanyBrowserIdentity />);

    await waitFor(() => expect(headLinks().icon?.getAttribute('href')).toBe(LOGO_A));

    useCompanyMock.mockReturnValue({ name: 'Tenant B', logo: LOGO_B });
    view.rerender(<CompanyBrowserIdentity />);

    await waitFor(() => {
      expect(headLinks().icon?.getAttribute('href')).toBe(LOGO_B);
      expect(headLinks().apple?.getAttribute('href')).toBe(LOGO_B);
    });
  });

  it('uses the approved AWJ fallback for missing or unsafe logos', async () => {
    expect(safeCompanyIconUrl(null)).toBe('/icon.ico');
    expect(safeCompanyIconUrl('javascript:alert(1)')).toBe('/icon.ico');
    expect(safeCompanyIconUrl('data:image/svg+xml;base64,PHN2Zy8+')).toBe('/icon.ico');

    useCompanyMock.mockReturnValue({ name: 'Fallback tenant', logo: 'javascript:alert(1)' });
    render(<CompanyBrowserIdentity />);

    await waitFor(() => {
      expect(headLinks().icon?.getAttribute('href')).toBe('/icon.ico');
      expect(headLinks().apple?.getAttribute('href')).toBe('/icon.ico');
    });
  });

  it('removes only links owned by the component on unmount', async () => {
    const externalIcon = document.createElement('link');
    externalIcon.rel = 'icon';
    externalIcon.href = '/external-icon.ico';
    document.head.appendChild(externalIcon);
    useCompanyMock.mockReturnValue({ name: 'Tenant A', logo: LOGO_A });

    const view = render(<CompanyBrowserIdentity />);
    await waitFor(() => expect(document.head.querySelector('link[data-nebrax-company-icon][rel="icon"]')?.getAttribute('href')).toBe(LOGO_A));

    view.unmount();

    expect(document.head.querySelector('link[data-nebrax-company-icon]')).toBeNull();
    expect(externalIcon.isConnected).toBe(true);
  });

  it('removes tenant identity when the authenticated session ends', async () => {
    localStorage.setItem('token', 'token');
    useCompanyMock.mockReturnValue({ name: 'Tenant A', logo: LOGO_A });

    render(<AuthenticatedCompanyBrowserIdentity />);
    await waitFor(() => expect(headLinks().apple?.getAttribute('href')).toBe(LOGO_A));

    localStorage.removeItem('token');
    window.dispatchEvent(new Event('nibras:auth-session-changed'));

    await waitFor(() => {
      expect(document.head.querySelector('link[data-nebrax-company-icon]')).toBeNull();
    });
  });

  it('reloads the identity when the account changes while still authenticated', async () => {
    localStorage.setItem('token', 'token-a');
    useCompanyMock.mockReturnValue({ name: 'Tenant A', logo: LOGO_A });

    render(<AuthenticatedCompanyBrowserIdentity />);
    await waitFor(() => expect(headLinks().icon?.getAttribute('href')).toBe(LOGO_A));

    useCompanyMock.mockReturnValue({ name: 'Tenant B', logo: LOGO_B });
    localStorage.setItem('token', 'token-b');
    window.dispatchEvent(new Event('nibras:auth-session-changed'));

    await waitFor(() => {
      expect(headLinks().icon?.getAttribute('href')).toBe(LOGO_B);
      expect(headLinks().apple?.getAttribute('href')).toBe(LOGO_B);
    });
  });
});
