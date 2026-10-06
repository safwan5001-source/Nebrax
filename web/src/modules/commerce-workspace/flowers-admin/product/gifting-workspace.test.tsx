// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

const apiMock = vi.fn();
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: (...args: unknown[]) => apiMock(...args),
}));

import { ToastProvider } from '@/components/ui/toast';
import { renderIntl } from '@/test-utils/intl';
import { ProductGiftingWorkspace } from './gifting-workspace';

afterEach(() => {
  cleanup();
  apiMock.mockReset();
  window.history.replaceState(null, '', '/');
});

function open(opts: { search?: string; canManage?: boolean } = {}) {
  window.history.replaceState(null, '', `/products/p1${opts.search ?? ''}`);
  apiMock.mockImplementation(async (path: string) => {
    if (path.endsWith('/preparation')) return { data: { preparation_minutes: 120 } };
    if (path.endsWith('/personalization')) return { data: { fields: [{ key: 'card-name', type: 'text', label: 'الاسم', is_required: true, max_length: 20, is_active: true, options: [] }, { key: 'note', type: 'textarea', label: 'ملاحظة', max_length: 100, is_active: true, options: [] }] } };
    if (path.endsWith('/addons')) return { data: { addons: [{ addon_product_id: 'a', addon_variant_id: null, name: 'شوكولاتة', product_is_active: true, max_quantity: 1, is_active: true }] } };
    if (path.endsWith('/content')) return { data: { blocks: [{ block_type: 'care', body: 'x', body_en: null, is_active: true }, { block_type: 'storage', body: 'y', body_en: null, is_active: true }, { block_type: 'dimensions', body: 'z', body_en: null, is_active: false }] } };
    if (/^\/products\/a$/.test(path)) return { data: { id: 'a', name: 'شوكولاتة', sale_price: '10.00', variant_state: 'simple', is_active: true } };
    throw new Error(`unexpected ${path}`);
  });
  renderIntl(
    <ToastProvider>
      <ProductGiftingWorkspace productId="p1" locale="en" canManage={opts.canManage ?? true} />
    </ToastProvider>,
    'en',
  );
}

const subTab = (name: RegExp | string) => screen.getByRole('tab', { name });

describe('ProductGiftingWorkspace (unified)', () => {
  it('offers the four product-level capabilities as one sub-navigation with server counts', async () => {
    open();
    await waitFor(() => expect(subTab(/^Content/).textContent).toContain('3'));
    expect(subTab(/^Personalization/).textContent).toContain('2');
    expect(subTab(/^Add-ons/).textContent).toContain('1');
    expect(subTab(/^Preparation/).textContent).toBe('Preparation');
    expect(screen.getAllByRole('tab')).toHaveLength(4);
  });

  it('shows one section and one save bar at a time, and keeps an unsaved draft when switching sections', async () => {
    open();
    await screen.findByLabelText('This product’s preparation time');
    await userEvent.type(screen.getByLabelText('This product’s preparation time'), '5');
    expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(1);

    await userEvent.click(subTab(/^Personalization/));
    expect(await screen.findByRole('button', { name: 'Add input' })).toBeTruthy();
    expect(screen.getAllByRole('button', { name: 'Save' })).toHaveLength(1);
    expect(document.getElementById('panel-gift-preparation')?.hidden).toBe(true);

    await userEvent.click(subTab(/^Preparation/));
    expect((screen.getByLabelText('This product’s preparation time') as HTMLInputElement).value).toBe('25');
    expect(screen.getByText('Unsaved changes')).toBeTruthy();
  });

  it('opens on the deep-linked section and records the section in the URL when switching', async () => {
    open({ search: '?tab=gifting&section=addons' });
    expect(await screen.findByRole('button', { name: 'Add an add-on' })).toBeTruthy();
    expect(subTab(/^Add-ons/).getAttribute('aria-selected')).toBe('true');
    await userEvent.click(subTab(/^Content/));
    expect(new URLSearchParams(window.location.search).get('section')).toBe('content');
    expect(new URLSearchParams(window.location.search).get('tab')).toBe('gifting');
  });

  it('falls back to the first section for an unknown deep link', async () => {
    open({ search: '?section=nope' });
    expect(await screen.findByLabelText('This product’s preparation time')).toBeTruthy();
    expect(subTab(/^Preparation/).getAttribute('aria-selected')).toBe('true');
  });

  it('read-only users see every section but no save controls anywhere', async () => {
    open({ canManage: false });
    await screen.findByLabelText('This product’s preparation time');
    for (const name of [/^Personalization/, /^Add-ons/, /^Content/]) {
      await userEvent.click(subTab(name));
      expect(screen.queryByRole('button', { name: 'Save' })).toBeNull();
    }
    const panel = document.getElementById('panel-gift-content') as HTMLElement;
    expect(within(panel).getByText(/view-only access/)).toBeTruthy();
  });
});
