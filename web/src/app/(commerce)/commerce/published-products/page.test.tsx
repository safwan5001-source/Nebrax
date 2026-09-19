// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import CommercePublishedProductsPage from './page';

const locale = { current: 'ar' };

vi.mock('next-intl', () => {
  const t = (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${JSON.stringify(values)}` : key;
  t.rich = (key: string) => key;
  return {
    useLocale: () => locale.current,
    useTranslations: () => t,
  };
});

vi.mock('next/link', () => ({
  default: ({ href, children }: { href: string; children: React.ReactNode }) => <a href={href}>{children}</a>,
}));

const listMock = vi.fn();
const replaceMock = vi.fn();
vi.mock('@/modules/products/publication', () => ({
  loadProductPublicationList: (...args: unknown[]) => listMock(...args),
  replaceProductPublication: (...args: unknown[]) => replaceMock(...args),
}));

vi.mock('@/modules/commerce-workspace/store-context', () => ({
  useCommerceStoreContext: () => ({
    catalog: { status: 'ready', stores: [{ id: 's1', name: 'المتجر', isActive: true }] },
  }),
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ error: toastError, success: toastSuccess }),
}));

vi.mock('@/lib/auth', () => ({ currentUser: () => ({ role: 'owner', permissions: ['*'] }) }));

const emptyPage = { items: [], meta: { currentPage: 1, lastPage: 1, perPage: 25, total: 0 } };
const publishedPage = {
  items: [
    {
      id: 'p1',
      sku: 'SKU-1',
      name: 'قهوة عربية',
      nameEn: 'Arabic coffee',
      isActive: true,
      isPublished: true,
      stores: [{ id: 's1', name: 'المتجر', isPublished: true }],
    },
  ],
  meta: { currentPage: 1, lastPage: 1, perPage: 25, total: 1 },
};

describe('COM-CATALOG-1 Product Publication Workspace', () => {
  afterEach(() => {
    cleanup();
    listMock.mockReset();
    replaceMock.mockReset();
    toastError.mockReset();
    toastSuccess.mockReset();
    locale.current = 'ar';
  });

  it('shows the loading state while the list resolves', () => {
    listMock.mockReturnValue(new Promise(() => {}));
    render(<CommercePublishedProductsPage />);
    expect(screen.getByRole('status')).toBeTruthy();
  });

  it('renders rows with publication state from CommerceListing is_published', async () => {
    listMock.mockResolvedValue(publishedPage);
    render(<CommercePublishedProductsPage />);
    await waitFor(() => expect(screen.getAllByText('قهوة عربية').length).toBeGreaterThan(0));
    expect(screen.getAllByText(/المتجر · منشور/).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('button', { name: /إلغاء النشر · المتجر/ }).length).toBeGreaterThan(0);
  });

  it('shows the empty state when nothing matches', async () => {
    listMock.mockResolvedValue(emptyPage);
    render(<CommercePublishedProductsPage />);
    await waitFor(() => expect(screen.getByText('لا منتجات بعد')).toBeTruthy());
  });

  it('shows the error state with retry when loading fails', async () => {
    listMock.mockRejectedValue(new Error('network'));
    render(<CommercePublishedProductsPage />);
    await waitFor(() => expect(screen.getByText('تعذر تحميل المنتجات المنشورة. حاول مرة أخرى.')).toBeTruthy());
  });

  it('unpublishes via the COM-WS-3 replace contract and confirms feedback', async () => {
    listMock.mockResolvedValue(publishedPage);
    replaceMock.mockResolvedValue([{ id: 's1', name: 'المتجر', isPublished: false }]);
    render(<CommercePublishedProductsPage />);
    await waitFor(() => expect(screen.getAllByRole('button', { name: /إلغاء النشر · المتجر/ }).length).toBeGreaterThan(0));

    screen.getAllByRole('button', { name: /إلغاء النشر · المتجر/ })[0].click();
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('p1', []));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('تم إلغاء نشر المنتج من المتجر.'));
  });

  it('renders the English workspace when the locale is English', async () => {
    locale.current = 'en';
    listMock.mockResolvedValue(publishedPage);
    render(<CommercePublishedProductsPage />);
    await waitFor(() => expect(screen.getAllByText('قهوة عربية').length).toBeGreaterThan(0));
    expect(screen.getByRole('heading', { name: 'Published products' })).toBeTruthy();
  });
});
