import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', () => ({ api: (...args: unknown[]) => apiMock(...args) }));

import {
  categoryPublicationListPath,
  categoryPublicationPath,
  loadCategoryPublicationList,
  replaceCategoryPublication,
} from './publication';

afterEach(() => apiMock.mockReset());

describe('category publication workspace list API (COM-CATALOG-2)', () => {
  it('builds the server-side query without any client-supplied tenant authority', async () => {
    apiMock.mockResolvedValue({
      data: [
        {
          id: 'c1',
          name: 'مشروبات',
          parent_id: 'c0',
          parent_name: 'أساسيات',
          is_active: true,
          is_published: true,
          stores: [{ id: 's1', name: 'Store', is_published: true }],
        },
      ],
      meta: { current_page: 2, last_page: 4, per_page: 25, total: 90 },
    });

    const page = await loadCategoryPublicationList({
      search: '  مشروبات  ',
      status: 'published',
      storefrontId: 's1',
      page: 2,
      perPage: 25,
    });

    const url = String(apiMock.mock.calls[0][0]);
    expect(url.startsWith(`${categoryPublicationListPath()}?`)).toBe(true);
    expect(url).toContain('search=%D9%85%D8%B4%D8%B1%D9%88%D8%A8%D8%A7%D8%AA');
    expect(url).toContain('status=published');
    expect(url).toContain('storefront_id=s1');
    expect(url).toContain('page=2');
    expect(url).toContain('per_page=25');
    expect(url).not.toContain('tenant');

    expect(page.meta).toEqual({ currentPage: 2, lastPage: 4, perPage: 25, total: 90 });
    expect(page.items[0]).toMatchObject({
      id: 'c1',
      name: 'مشروبات',
      parentId: 'c0',
      parentName: 'أساسيات',
      isActive: true,
      isPublished: true,
      stores: [{ id: 's1', name: 'Store', isPublished: true }],
    });
  });

  it('omits the all-status filter and empty search from the query', async () => {
    apiMock.mockResolvedValue({
      data: [],
      meta: { current_page: 1, last_page: 1, per_page: 25, total: 0 },
    });

    await loadCategoryPublicationList({ search: '   ', status: 'all' });

    const url = String(apiMock.mock.calls[0][0]);
    expect(url).not.toContain('status=');
    expect(url).not.toContain('search=');
    expect(url).toContain('page=1');
  });

  it('replaces category publication via the replace contract with no tenant authority from the client', async () => {
    apiMock.mockResolvedValue({ data: { stores: [{ id: 's1', name: 'Store', is_published: false }] } });

    const stores = await replaceCategoryPublication('cat/x', ['s1']);

    expect(categoryPublicationPath('cat/x')).toBe('/commerce/workspace/categories/cat%2Fx/publication');
    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/categories/cat%2Fx/publication', {
      method: 'PUT',
      body: { storefront_ids: ['s1'] },
    });
    expect(JSON.stringify(apiMock.mock.calls[0])).not.toContain('tenant');
    expect(stores).toEqual([{ id: 's1', name: 'Store', isPublished: false }]);
  });
});
