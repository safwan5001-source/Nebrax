// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CommerceOverviewPage from './page';

const locale = { current: 'en' };

vi.mock('next-intl', () => ({
  useLocale: () => locale.current,
  useTranslations: () => (key: string) => key,
}));

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

describe('Commerce workspace overview', () => {
  afterEach(() => {
    cleanup();
    locale.current = 'en';
  });

  it('renders the English command center shell without mock commerce metrics', () => {
    render(<CommerceOverviewPage />);
    expect(screen.getByRole('heading', { name: 'Commerce command center' })).toBeTruthy();
    expect(screen.getByText('Open in AWJ')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Products' })).toHaveProperty('href', expect.stringContaining('/products'));
    expect(screen.queryByText(/1,234|SAR|revenue/i)).toBeNull();
  });

  it('renders the Arabic command center title', () => {
    locale.current = 'ar';
    render(<CommerceOverviewPage />);
    expect(screen.getByRole('heading', { name: 'مركز قيادة التجارة' })).toBeTruthy();
    expect(screen.getByText('الانتقال إلى أَوْج')).toBeTruthy();
  });
});
