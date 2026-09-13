// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import NewProductPage from './page';

const { apiMock, routerPush, toastError, translate } = vi.hoisted(() => ({
  apiMock: vi.fn(),
  routerPush: vi.fn(),
  toastError: vi.fn(),
  translate: (key: string) => ({
    name: 'Name',
    save: 'Save',
    online_store: 'Online store',
    available_online: 'Available online',
    publication_hint: 'Choose stores',
    publication_loading: 'Loading stores',
    publication_empty: 'No stores',
    publication_load_failed: 'Could not load stores',
    publication_failed_after_create: 'Product created; publication failed. Retry without creating another product.',
    product_created_publication_pending: 'Publication pending',
    retry_publication: 'Retry publication',
    retry: 'Retry',
    created: 'Created',
    saveFailed: 'Save failed',
  } as Record<string, string>)[key] ?? key,
}));

vi.mock('next-intl', () => ({ useTranslations: () => translate }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: routerPush }) }));
vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args), ApiError: class ApiError extends Error {} }));
vi.mock('@/lib/tax', () => ({ getSystemTaxInclusive: () => Promise.resolve(false) }));
vi.mock('@/lib/use-number-preview', () => ({ useNumberPreview: () => ({ number: '' }) }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: vi.fn(), error: toastError }) }));
vi.mock('lucide-react', () => {
  const iconStub = () => <span />;
  return new Proxy({ __esModule: true } as Record<string | symbol, unknown>, {
    get: (target, name) => typeof name === 'symbol' || name === 'then' || name === '__esModule'
      ? Reflect.get(target, name)
      : iconStub,
    has: () => true,
  });
});

describe('new product store publication', () => {
  beforeEach(() => {
    apiMock.mockReset();
    routerPush.mockReset();
    toastError.mockReset();
    let publicationAttempts = 0;
    apiMock.mockImplementation((path: string, options?: { method?: string }) => {
      if (path === '/partners' || path === '/unit-templates' || path === '/accounts') {
        return Promise.resolve({ data: [] });
      }
      if (path === '/commerce/workspace/storefronts') {
        return Promise.resolve({ data: { stores: [{ id: 'store-a', name: 'Store A' }] } });
      }
      if (path === '/products' && options?.method === 'POST') {
        return Promise.resolve({ data: { id: 'product-a' } });
      }
      if (path === '/commerce/workspace/products/product-a/publication' && options?.method === 'PUT') {
        publicationAttempts += 1;
        return publicationAttempts === 1
          ? Promise.reject(new Error('publication unavailable'))
          : Promise.resolve({ data: { stores: [{ id: 'store-a', name: 'Store A', is_published: true }] } });
      }
      return Promise.resolve({ data: [] });
    });
  });

  afterEach(cleanup);

  it('retries publication for the created id without creating a duplicate product', async () => {
    const user = userEvent.setup();
    render(<NewProductPage />);

    await user.type(screen.getByLabelText('Name *'), 'Product A');
    await user.click(await screen.findByRole('checkbox', { name: /Store A/ }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText(/Product created; publication failed/)).toBeTruthy();
    expect(apiMock.mock.calls.filter(([path, options]) => path === '/products' && options?.method === 'POST')).toHaveLength(1);

    await user.click(screen.getByRole('button', { name: 'Retry publication' }));

    await waitFor(() => expect(routerPush).toHaveBeenCalledWith('/products'));
    expect(apiMock.mock.calls.filter(([path, options]) => path === '/products' && options?.method === 'POST')).toHaveLength(1);
    expect(apiMock.mock.calls.filter(([path, options]) => path === '/commerce/workspace/products/product-a/publication' && options?.method === 'PUT')).toHaveLength(2);
  });
});
