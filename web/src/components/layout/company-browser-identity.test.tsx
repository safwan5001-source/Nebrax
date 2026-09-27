// @vitest-environment jsdom

import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { useCompanyMock } = vi.hoisted(() => ({
  useCompanyMock: vi.fn(),
}));

vi.mock('@/lib/company', () => ({
  useCompany: useCompanyMock,
}));

import { CompanyBrowserIdentity, safeCompanyIconUrl } from './company-browser-identity';

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
});
