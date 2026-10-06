// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: (...args: unknown[]) => apiMock(...args),
}));
vi.mock('next-intl', async (importOriginal) => ({ ...(await importOriginal<typeof import('next-intl')>()), useLocale: () => 'en' }));
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a> }));
const user = vi.hoisted(() => ({ value: { id: 'u', role: 'owner', permissions: ['*'] } as { id: string; role: string; permissions: string[] } | null }));
vi.mock('@/lib/auth', () => ({ currentUser: () => user.value }));

import { CommerceStoreProvider } from '@/modules/commerce-workspace/store-context';
import { renderIntl } from '@/test-utils/intl';
import CommerceOverviewPage from './page';

afterEach(() => {
  cleanup();
  apiMock.mockReset();
  user.value = { id: 'u', role: 'owner', permissions: ['*'] };
});

const store = (vertical: string) => ({ id: 's1', name: 'Rose House', sales_channel_id: 'c', is_active: true, default_locale: 'ar', business_vertical: vertical });

function open(vertical: string) {
  apiMock.mockImplementation(async (path: string) => {
    if (path === '/commerce/workspace/storefronts') return { data: { stores: [store(vertical)] } };
    if (path.endsWith('/vertical-setup')) return { data: { setup: { vertical: 'flowers_gifts', items: [{ key: 'occasions', available: true, state: 'not_configured', count: 0, manage_in: 'merchandising' }] } } };
    throw new Error('x');
  });
  renderIntl(<CommerceStoreProvider><CommerceOverviewPage /></CommerceStoreProvider>, 'en');
}

describe('Commerce overview — setup center gate', () => {
  it('shows the setup center for a Flowers & Gifts store', async () => {
    open('flowers_gifts');
    expect(await screen.findByRole('heading', { name: 'Gift business setup' })).toBeTruthy();
    expect(await screen.findByText('Store readiness')).toBeTruthy();
    expect(screen.getByText('Open in AWJ')).toBeTruthy();
  });

  it('keeps the original overview for a general store and makes no setup request', async () => {
    open('general');
    expect(await screen.findByRole('heading', { name: 'Commerce command center' })).toBeTruthy();
    expect(apiMock.mock.calls.some((c) => String(c[0]).includes('vertical-setup'))).toBe(false);
  });

  it('keeps the original overview for a user without commerce.manage', async () => {
    user.value = { id: 'u', role: 'staff', permissions: ['products.view'] };
    open('flowers_gifts');
    expect(await screen.findByRole('heading', { name: 'Commerce command center' })).toBeTruthy();
    expect(apiMock.mock.calls.some((c) => String(c[0]).includes('vertical-setup'))).toBe(false);
  });
});
