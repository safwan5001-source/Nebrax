import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';

const apiMock = vi.fn();
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: (...args: unknown[]) => apiMock(...args),
  };
});

import {
  commerceWorkspaceCategoryPath,
  commerceWorkspaceCategoriesPath,
  listWorkspaceCategories,
  showWorkspaceCategory,
} from './workspace-categories';

afterEach(() => apiMock.mockReset());

function summaryRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    name: 'تصنيف تجريبي',
    parent_id: null,
    parent_name: null,
    ...overrides,
  };
}

function detailRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c1',
    name: 'تصنيف تجريبي',
    description: 'وصف التصنيف',
    color: '#112233',
    parent_id: null,
    children: [{ id: 'c2', name: 'ابن' }],
    ancestors: [],
    ...overrides,
  };
}

describe('workspace-categories client — CUST-H2-4', () => {
  it('builds paths without leaking a tenant id anywhere in the URL', () => {
    expect(commerceWorkspaceCategoriesPath('store-1')).toBe(
      '/commerce/workspace/storefronts/store-1/categories',
    );
    expect(commerceWorkspaceCategoryPath('store-1', 'c1')).toBe(
      '/commerce/workspace/storefronts/store-1/categories/c1',
    );
  });

  it('lists categories and maps the minimal summary shape', async () => {
    apiMock.mockResolvedValue({
      data: [summaryRow(), summaryRow({ id: 'c2', name: 'تصنيف آخر', parent_id: 'c1', parent_name: 'تصنيف تجريبي' })],
      meta: { pagination: { page: 1, per_page: 20, total: 2, last_page: 1, has_more: false } },
    });

    const result = await listWorkspaceCategories('store-1');
    expect(result).toEqual({
      ok: true,
      hasMore: false,
      data: [
        { id: 'c1', name: 'تصنيف تجريبي', parentId: null, parentName: null },
        { id: 'c2', name: 'تصنيف آخر', parentId: 'c1', parentName: 'تصنيف تجريبي' },
      ],
    });
    expect(apiMock).toHaveBeenCalledWith(
      '/commerce/workspace/storefronts/store-1/categories',
      expect.objectContaining({}),
    );
  });

  it('sends search/page/per_page as query params only when provided', async () => {
    apiMock.mockResolvedValue({ data: [], meta: { pagination: { has_more: false } } });
    await listWorkspaceCategories('store-1', { search: 'زيت', page: 2, perPage: 10 });
    const [path] = apiMock.mock.calls[0];
    expect(path).toContain('/commerce/workspace/storefronts/store-1/categories?');
    expect(path).toContain('search=');
    expect(path).toContain('page=2');
    expect(path).toContain('per_page=10');
  });

  it('sends root_only=true only when explicitly requested (CUST-H4-3 parity fix)', async () => {
    apiMock.mockResolvedValue({ data: [], meta: { pagination: { has_more: false } } });
    await listWorkspaceCategories('store-1', { rootOnly: true, perPage: 12 });
    const [path] = apiMock.mock.calls[0];
    expect(path).toContain('root_only=true');
    expect(path).toContain('per_page=12');

    apiMock.mockClear();
    await listWorkspaceCategories('store-1');
    const [defaultPath] = apiMock.mock.calls[0];
    expect(defaultPath).not.toContain('root_only');

    apiMock.mockClear();
    await listWorkspaceCategories('store-1', { rootOnly: false });
    const [falsePath] = apiMock.mock.calls[0];
    expect(falsePath).not.toContain('root_only');
  });

  it('classifies a 404 as not_found without throwing', async () => {
    apiMock.mockRejectedValue(new ApiError(404, 'not found', {}));
    const result = await listWorkspaceCategories('store-1');
    expect(result).toEqual({ ok: false, reason: 'not_found', message: 'not found' });
  });

  it('classifies a 403 as forbidden', async () => {
    apiMock.mockRejectedValue(new ApiError(403, 'forbidden', {}));
    const result = await listWorkspaceCategories('store-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('forbidden');
  });

  it('rejects a malformed list payload rather than crashing on a bad row', async () => {
    apiMock.mockResolvedValue({ data: [{ id: 'c1' /* missing name */ }] });
    const result = await listWorkspaceCategories('store-1');
    expect(result).toEqual({ ok: false, reason: 'failed', message: 'invalid_payload' });
  });

  it('shows a category detail and maps the full safe shape', async () => {
    apiMock.mockResolvedValue({ data: detailRow() });
    const result = await showWorkspaceCategory('store-1', 'c1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({
      id: 'c1',
      name: 'تصنيف تجريبي',
      description: 'وصف التصنيف',
      parentId: null,
      children: [{ id: 'c2', name: 'ابن' }],
      ancestors: [],
    });
  });

  it('maps breadcrumbs (ancestors) in root-to-parent order', async () => {
    apiMock.mockResolvedValue({
      data: detailRow({
        ancestors: [{ id: 'root', name: 'الجذر' }, { id: 'mid', name: 'وسيط' }],
      }),
    });
    const result = await showWorkspaceCategory('store-1', 'c1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.ancestors).toEqual([
      { id: 'root', name: 'الجذر' },
      { id: 'mid', name: 'وسيط' },
    ]);
  });

  it('honestly reports no description/no children rather than fabricating any', async () => {
    apiMock.mockResolvedValue({ data: detailRow({ description: null, children: [] }) });
    const result = await showWorkspaceCategory('store-1', 'c1');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.description).toBeNull();
    expect(result.data.children).toEqual([]);
  });

  it('classifies a foreign/ineligible category 404 as not_found', async () => {
    apiMock.mockRejectedValue(new ApiError(404, 'not found', {}));
    const result = await showWorkspaceCategory('store-1', 'foreign-category');
    expect(result).toEqual({ ok: false, reason: 'not_found', message: 'not found' });
  });

  it('never fabricates data on an unexpected/network failure', async () => {
    apiMock.mockRejectedValue(new Error('network down'));
    const result = await showWorkspaceCategory('store-1', 'c1');
    expect(result).toEqual({ ok: false, reason: 'failed', message: 'network down' });
  });
});
