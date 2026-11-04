// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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
const bulkMock = vi.fn();
vi.mock('@/modules/products/publication', () => ({
  loadProductPublicationList: (...args: unknown[]) => listMock(...args),
  replaceProductPublication: (...args: unknown[]) => replaceMock(...args),
  bulkSetProductPublication: (...args: unknown[]) => bulkMock(...args),
}));

const categoryListMock = vi.fn();
const categoryReplaceMock = vi.fn();
const categoryBulkMock = vi.fn();
vi.mock('@/modules/categories/publication', () => ({
  loadCategoryPublicationList: (...args: unknown[]) => categoryListMock(...args),
  replaceCategoryPublication: (...args: unknown[]) => categoryReplaceMock(...args),
  bulkSetCategoryPublication: (...args: unknown[]) => categoryBulkMock(...args),
}));

const storeFixture = {
  current: [{ id: 's1', name: 'المتجر', isActive: true }] as Array<{ id: string; name: string; isActive: boolean }>,
};
vi.mock('@/modules/commerce-workspace/store-context', () => ({
  useCommerceStoreContext: () => ({
    catalog: { status: 'ready', stores: storeFixture.current },
  }),
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('@/components/ui/toast', () => ({
  useToast: () => ({ error: toastError, success: toastSuccess }),
}));

const userFixture = { current: { role: 'owner', permissions: ['*'] } as { role: string; permissions: string[] } };
vi.mock('@/lib/auth', () => ({ currentUser: () => userFixture.current }));

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
    categoryListMock.mockReset();
    categoryReplaceMock.mockReset();
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

  it('points the selected tab at a panel that exists (ERP-UX-019)', async () => {
    listMock.mockResolvedValue(publishedPage);
    render(<CommercePublishedProductsPage />);
    const tab = screen.getAllByRole('tab').find((el) => el.getAttribute('aria-selected') === 'true') as HTMLElement;
    const panel = document.getElementById(tab.getAttribute('aria-controls') ?? '');
    expect(panel?.getAttribute('role')).toBe('tabpanel');
    expect(panel?.getAttribute('aria-labelledby')).toBe(tab.id);
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

const publishedCategoriesPage = {
  items: [
    {
      id: 'c1',
      name: 'مشروبات',
      parentId: 'c0',
      parentName: 'أساسيات',
      isActive: true,
      isPublished: false,
      stores: [{ id: 's1', name: 'المتجر', isPublished: false }],
    },
  ],
  meta: { currentPage: 1, lastPage: 1, perPage: 25, total: 1 },
};

describe('COM-CATALOG-2 Category Publication tab', () => {
  afterEach(() => {
    cleanup();
    listMock.mockReset();
    replaceMock.mockReset();
    categoryListMock.mockReset();
    categoryReplaceMock.mockReset();
    toastError.mockReset();
    toastSuccess.mockReset();
    locale.current = 'ar';
  });

  it('keeps the products tab as the default without regressing COM-CATALOG-1', async () => {
    listMock.mockResolvedValue(publishedPage);
    categoryListMock.mockResolvedValue(publishedCategoriesPage);
    render(<CommercePublishedProductsPage />);

    expect(screen.getByRole('tab', { name: 'المنتجات', selected: true })).toBeTruthy();
    expect(screen.getByRole('tab', { name: 'التصنيفات', selected: false })).toBeTruthy();
    await waitFor(() => expect(screen.getAllByText('قهوة عربية').length).toBeGreaterThan(0));
    // التبويبة الافتراضية لا تستدعي واجهة التصنيفات إطلاقاً.
    expect(categoryListMock).not.toHaveBeenCalled();
  });

  it('renders the categories tab with hierarchy context and per-store state', async () => {
    listMock.mockResolvedValue(publishedPage);
    categoryListMock.mockResolvedValue(publishedCategoriesPage);
    render(<CommercePublishedProductsPage />);

    screen.getByRole('tab', { name: 'التصنيفات' }).click();

    await waitFor(() => expect(screen.getAllByText('مشروبات').length).toBeGreaterThan(0));
    expect(screen.getAllByText(/ضمن أساسيات/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/المتجر · غير منشور/).length).toBeGreaterThan(0);
    expect(categoryListMock).toHaveBeenCalledTimes(1);
  });

  it('publishes a category via the replace contract with success feedback', async () => {
    listMock.mockResolvedValue(publishedPage);
    categoryListMock.mockResolvedValue(publishedCategoriesPage);
    categoryReplaceMock.mockResolvedValue([{ id: 's1', name: 'المتجر', isPublished: true }]);
    render(<CommercePublishedProductsPage />);

    screen.getByRole('tab', { name: 'التصنيفات' }).click();
    await waitFor(() => expect(screen.getAllByRole('button', { name: /نشر · المتجر/ }).length).toBeGreaterThan(0));

    screen.getAllByRole('button', { name: /نشر · المتجر/ })[0].click();
    await waitFor(() => expect(categoryReplaceMock).toHaveBeenCalledWith('c1', ['s1']));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('تم نشر التصنيف في المتجر.'));
    // المنتجات لا تُلمس — استقلالية كاملة بين التبويبتين.
    expect(replaceMock).not.toHaveBeenCalled();
  });

  it('shows the category empty and error states', async () => {
    listMock.mockResolvedValue(publishedPage);
    categoryListMock.mockResolvedValue({ items: [], meta: { currentPage: 1, lastPage: 1, perPage: 25, total: 0 } });
    render(<CommercePublishedProductsPage />);
    screen.getByRole('tab', { name: 'التصنيفات' }).click();
    await waitFor(() => expect(screen.getByText('لا تصنيفات بعد')).toBeTruthy());

    cleanup();
    categoryListMock.mockReset();
    categoryListMock.mockRejectedValue(new Error('network'));
    render(<CommercePublishedProductsPage />);
    screen.getByRole('tab', { name: 'التصنيفات' }).click();
    await waitFor(() => expect(screen.getByText('تعذر تحميل التصنيفات. حاول مرة أخرى.')).toBeTruthy());
  });

  it('renders the categories tab labels in English', async () => {
    locale.current = 'en';
    listMock.mockResolvedValue(publishedPage);
    categoryListMock.mockResolvedValue(publishedCategoriesPage);
    render(<CommercePublishedProductsPage />);

    expect(screen.getByRole('tab', { name: 'Categories' })).toBeTruthy();
    screen.getByRole('tab', { name: 'Categories' }).click();
    await waitFor(() => expect(screen.getAllByText('مشروبات').length).toBeGreaterThan(0));
    expect(screen.getAllByText(/Under أساسيات/).length).toBeGreaterThan(0);
  });
});

// ── COM-CATALOG-3 — Bulk selection & publishing ─────────────────────────────

const row = (id: string, name: string, published = false, stores = [{ id: 's1', name: 'المتجر', isPublished: published }]) => ({
  id,
  sku: `SKU-${id}`,
  name,
  nameEn: null,
  isActive: true,
  isPublished: published,
  stores,
});
const bulkPage = (lastPage = 1, currentPage = 1) => ({
  items: [row('p1', 'بن يمني'), row('p2', 'هيل'), row('p3', 'زعفران')],
  meta: { currentPage, lastPage, perPage: 25, total: 3 * lastPage },
});
const okResult = (action: 'publish' | 'unpublish', ids: string[], storefrontId = 's1') => ({
  action,
  storefrontId,
  summary: { requested: ids.length, updated: ids.length, unchanged: 0, rejected: 0, failed: 0 },
  results: ids.map((id) => ({ id, status: 'updated' as const, reason: null })),
});

/** كل صف يُرسم مرتين (جدول سطح المكتب + سجل الجوال) — النسخة الأولى هي الجدول. */
const rowBox = (name: string) => screen.getAllByLabelText(`تحديد: ${name}`)[0] as HTMLInputElement;
const pageBox = () => screen.getAllByLabelText('تحديد كل عناصر الصفحة الحالية فقط')[0] as HTMLInputElement;
const countText = () => screen.queryByTestId('bulk-selected-count')?.textContent ?? null;

describe('COM-CATALOG-3 bulk selection', () => {
  afterEach(() => {
    cleanup();
    [listMock, replaceMock, bulkMock, categoryListMock, categoryReplaceMock, categoryBulkMock, toastError, toastSuccess].forEach((m) => m.mockReset());
    storeFixture.current = [{ id: 's1', name: 'المتجر', isActive: true }];
    userFixture.current = { role: 'owner', permissions: ['*'] };
    locale.current = 'ar';
  });

  const renderProducts = async (page = bulkPage()) => {
    listMock.mockResolvedValue(page);
    render(<CommercePublishedProductsPage />);
    await waitFor(() => expect(screen.getAllByText('بن يمني').length).toBeGreaterThan(0));
  };

  it('shows no bulk bar until something is selected, and selection toggles per row', async () => {
    await renderProducts();
    expect(countText()).toBeNull();

    fireEvent.click(rowBox('بن يمني'));
    expect(countText()).toBe('المحدد: 1');
    fireEvent.click(rowBox('هيل'));
    expect(countText()).toBe('المحدد: 2');
    fireEvent.click(rowBox('بن يمني'));
    expect(countText()).toBe('المحدد: 1');
    fireEvent.click(rowBox('هيل'));
    expect(countText()).toBeNull();
  });

  it('select-all affects the current page only, reports indeterminate, and toggles off', async () => {
    await renderProducts();
    fireEvent.click(rowBox('بن يمني'));
    expect(pageBox().indeterminate).toBe(true);

    fireEvent.click(pageBox());
    expect(countText()).toBe('المحدد: 3');
    expect(pageBox().checked).toBe(true);
    expect(pageBox().indeterminate).toBe(false);

    fireEvent.click(pageBox());
    expect(countText()).toBeNull();
  });

  it('clears the selection (with a notice) when the search changes — never silently widening it', async () => {
    await renderProducts();
    fireEvent.click(pageBox());
    expect(countText()).toBe('المحدد: 3');

    fireEvent.change(screen.getByLabelText('بحث في المنتجات'), { target: { value: 'هيل' } });
    expect(countText()).toBeNull();
    expect(screen.getByText('أُلغي التحديد لأن البحث أو الفلاتر تغيّرت.')).toBeTruthy();
  });

  it('clears the selection when the status filter changes', async () => {
    await renderProducts();
    fireEvent.click(rowBox('هيل'));
    fireEvent.change(screen.getByLabelText('حالة النشر'), { target: { value: 'published' } });
    expect(countText()).toBeNull();
  });

  it('keeps the selection across pagination and shows the off-page count', async () => {
    await renderProducts(bulkPage(2, 1));
    fireEvent.click(pageBox());
    expect(countText()).toBe('المحدد: 3');

    listMock.mockResolvedValue({
      items: [row('p9', 'قرفة')],
      meta: { currentPage: 2, lastPage: 2, perPage: 25, total: 6 },
    });
    fireEvent.click(screen.getByLabelText('nextPage'));
    await waitFor(() => expect(screen.getAllByText('قرفة').length).toBeGreaterThan(0));

    expect(countText()).toBe('المحدد: 3');
    expect(screen.getByText(/في صفحات أخرى: 3/)).toBeTruthy();
    expect(rowBox('قرفة').checked).toBe(false);
  });

  it('confirms with exact scope, then sends only the selected ids to the single store', async () => {
    await renderProducts();
    bulkMock.mockResolvedValue(okResult('publish', ['p1', 'p3']));
    fireEvent.click(rowBox('بن يمني'));
    fireEvent.click(rowBox('زعفران'));
    fireEvent.click(screen.getByRole('button', { name: 'نشر المحدد' }));

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/سيُنشر 2 من المنتجات في المتجر «المتجر»/)).toBeTruthy();
    expect(bulkMock).not.toHaveBeenCalled(); // لا تنفيذ قبل التأكيد

    fireEvent.click(within(dialog).getByRole('button', { name: 'تأكيد النشر' }));
    await waitFor(() => expect(bulkMock).toHaveBeenCalledTimes(1));
    expect(bulkMock).toHaveBeenCalledWith({ action: 'publish', storefrontId: 's1', ids: ['p1', 'p3'] });
    expect(await screen.findByText('اكتملت العملية على كل العناصر المحددة.')).toBeTruthy();
    // الإعادة من الخادم + تفريغ التحديد المكتمل.
    await waitFor(() => expect(listMock.mock.calls.length).toBeGreaterThan(1));
    expect(countText()).toBeNull();
    // لا استدعاء لمسار المفرد ولا للتصنيفات.
    expect(replaceMock).not.toHaveBeenCalled();
    expect(categoryBulkMock).not.toHaveBeenCalled();
  });

  it('can be cancelled from the confirmation without any request', async () => {
    await renderProducts();
    fireEvent.click(rowBox('هيل'));
    fireEvent.click(screen.getByRole('button', { name: 'إلغاء نشر المحدد' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'رجوع' }));
    expect(bulkMock).not.toHaveBeenCalled();
    expect(countText()).toBe('المحدد: 1');
  });

  it('reports partial failure by name and keeps only the failed items selected', async () => {
    await renderProducts();
    bulkMock.mockResolvedValue({
      action: 'unpublish',
      storefrontId: 's1',
      summary: { requested: 3, updated: 1, unchanged: 0, rejected: 1, failed: 1 },
      results: [
        { id: 'p1', status: 'updated', reason: null },
        { id: 'p2', status: 'rejected', reason: 'not_found' },
        { id: 'p3', status: 'failed', reason: 'error' },
      ],
    });
    fireEvent.click(pageBox());
    fireEvent.click(screen.getByRole('button', { name: 'إلغاء نشر المحدد' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'تأكيد إلغاء النشر' }));

    expect(await screen.findByText('اكتملت العملية جزئياً: بعض العناصر لم تُنفَّذ.')).toBeTruthy();
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(/غير موجود في حسابك/)).toBeTruthy();
    expect(within(dialog).getByText('هيل')).toBeTruthy();
    expect(within(dialog).getByText('زعفران')).toBeTruthy();
    expect(within(dialog).getByText('بقيت العناصر الفاشلة محددة لتعيد المحاولة.')).toBeTruthy();

    fireEvent.click(within(dialog).getByRole('button', { name: 'إغلاق' }));
    await waitFor(() => expect(countText()).toBe('المحدد: 1'));
    expect(rowBox('زعفران').checked).toBe(true);
    expect(rowBox('هيل').checked).toBe(false);
  });

  it('on a failed request says the outcome is unconfirmed and keeps the selection intact', async () => {
    await renderProducts();
    bulkMock.mockRejectedValue(new Error('network'));
    fireEvent.click(rowBox('هيل'));
    fireEvent.click(screen.getByRole('button', { name: 'نشر المحدد' }));
    fireEvent.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'تأكيد النشر' }));

    expect(await screen.findByText(/ولا يمكن الجزم بما تغيّر/)).toBeTruthy();
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'إغلاق' }));
    await waitFor(() => expect(countText()).toBe('المحدد: 1'));
  });

  it('with several stores the target must be chosen explicitly — no guessing, no all-stores', async () => {
    storeFixture.current = [
      { id: 's1', name: 'المتجر', isActive: true },
      { id: 's2', name: 'متجر الهدايا', isActive: true },
    ];
    await renderProducts();
    fireEvent.click(rowBox('هيل'));

    const publish = screen.getByRole('button', { name: 'نشر المحدد' }) as HTMLButtonElement;
    expect(publish.disabled).toBe(true);
    expect(screen.getByText('اختر المتجر المستهدف أولاً.')).toBeTruthy();

    fireEvent.change(screen.getByLabelText('المتجر المستهدف'), { target: { value: 's2' } });
    expect(publish.disabled).toBe(false);

    bulkMock.mockResolvedValue(okResult('publish', ['p2'], 's2'));
    fireEvent.click(publish);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/في المتجر «متجر الهدايا»/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'تأكيد النشر' }));
    await waitFor(() => expect(bulkMock).toHaveBeenCalledWith({ action: 'publish', storefrontId: 's2', ids: ['p2'] }));
  });

  it('hides all selection controls without products.manage', async () => {
    userFixture.current = { role: 'staff', permissions: ['products.view'] };
    await renderProducts();
    expect(screen.queryAllByLabelText('تحديد كل عناصر الصفحة الحالية فقط')).toHaveLength(0);
    expect(screen.queryAllByLabelText('تحديد: بن يمني')).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'نشر المحدد' })).toBeNull();
  });

  it('offers no selection when there is no active web store to target', async () => {
    storeFixture.current = [];
    await renderProducts();
    expect(screen.queryAllByLabelText('تحديد كل عناصر الصفحة الحالية فقط')).toHaveLength(0);
  });

  it('keeps the individual per-store actions working alongside bulk', async () => {
    await renderProducts();
    replaceMock.mockResolvedValue([{ id: 's1', name: 'المتجر', isPublished: true }]);
    screen.getAllByRole('button', { name: /^نشر · المتجر/ })[0].click();
    await waitFor(() => expect(replaceMock).toHaveBeenCalledWith('p1', ['s1']));
  });

  it('drops the selection when switching tabs and bulk-publishes categories through the category contract', async () => {
    await renderProducts();
    fireEvent.click(pageBox());
    expect(countText()).toBe('المحدد: 3');

    categoryListMock.mockResolvedValue(publishedCategoriesPage);
    screen.getByRole('tab', { name: 'التصنيفات' }).click();
    await waitFor(() => expect(screen.getAllByText('مشروبات').length).toBeGreaterThan(0));
    expect(countText()).toBeNull();

    categoryBulkMock.mockResolvedValue(okResult('publish', ['c1']));
    fireEvent.click(screen.getAllByLabelText('تحديد: مشروبات')[0]);
    fireEvent.click(screen.getByRole('button', { name: 'نشر المحدد' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText(/سيُنشر 1 من التصنيفات/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'تأكيد النشر' }));
    await waitFor(() => expect(categoryBulkMock).toHaveBeenCalledWith({ action: 'publish', storefrontId: 's1', ids: ['c1'] }));
    expect(bulkMock).not.toHaveBeenCalled();
  });

  it('renders the bulk UI in English', async () => {
    locale.current = 'en';
    listMock.mockResolvedValue(bulkPage());
    render(<CommercePublishedProductsPage />);
    await waitFor(() => expect(screen.getAllByText('بن يمني').length).toBeGreaterThan(0));
    fireEvent.click(screen.getAllByLabelText('Select all items on the current page only')[0]);
    expect(screen.getByTestId('bulk-selected-count').textContent).toBe('Selected: 3');
    expect(screen.getByRole('button', { name: 'Publish selected' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Unpublish selected' })).toBeTruthy();
  });
});
