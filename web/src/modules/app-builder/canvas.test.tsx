/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppSchemaComponent } from '@/lib/app-builder';
import { AppBuilderCanvas } from './canvas';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => (key === 'sampleDataBanner' ? 'Sample data — not your real store data' : key),
  useLocale: () => 'en',
}));

vi.mock('lucide-react', () => {
  const iconStub = () => <span />;
  return new Proxy({ __esModule: true } as Record<string | symbol, unknown>, {
    get: (target, name) =>
      typeof name === 'symbol' || name === 'then' || name === '__esModule' ? Reflect.get(target, name) : iconStub,
    has: () => true,
  });
});

afterEach(cleanup);

describe('AppBuilderCanvas — LIVE-PREVIEW-3 binding resolution', () => {
  it('renders unbound schemas exactly as before, with no sample-data banner', () => {
    const root: AppSchemaComponent = {
      type: 'Page',
      id: 'home-root',
      children: [{ type: 'Text', id: 'txt-1', props: { text: 'أَوْج' } }],
    };

    render(
      <AppBuilderCanvas root={root} device="mobile" locale="en" selectedId={null} onSelect={vi.fn()} />
    );

    expect(screen.getByText('أَوْج')).toBeTruthy();
    expect(screen.queryByText('Sample data — not your real store data')).toBeNull();
  });

  it('resolves a no-collect ProductList binding by repeating the template once per sample product, substituting $item.*', () => {
    const root: AppSchemaComponent = {
      type: 'Page',
      id: 'home-root',
      children: [
        {
          type: 'ProductList',
          id: 'featured-list',
          binding: { resource: 'commerce.products' },
          children: [
            { type: 'ProductCard', id: 'card-template', props: { title: '$item.name', amountMinor: '$item.price.amount_minor' } },
          ],
        },
      ],
    };

    render(
      <AppBuilderCanvas root={root} device="mobile" locale="en" selectedId={null} onSelect={vi.fn()} />
    );

    // SAMPLE_COMMERCE_PRODUCTS has 3 entries — the template must repeat exactly once per entry.
    expect(screen.getByText('قهوة عربية مختصة')).toBeTruthy();
    expect(screen.getByText('شاي أخضر فاخر')).toBeTruthy();
    expect(screen.getByText('كوب سيراميك')).toBeTruthy();
    expect(screen.getByText('Sample data — not your real store data')).toBeTruthy();
  });

  it('resolves a binding.collect CartList by repeating the template once per cart item, substituting nested $item.* paths', () => {
    const root: AppSchemaComponent = {
      type: 'Page',
      id: 'home-root',
      children: [
        {
          type: 'CartList',
          id: 'cart-list',
          binding: { resource: 'commerce.cart', collect: 'items' },
          children: [
            {
              type: 'ProductCard',
              id: 'line-template',
              props: { title: '$item.product_name', amountMinor: '$item.line_total.amount_minor' },
            },
          ],
        },
      ],
    };

    render(
      <AppBuilderCanvas root={root} device="mobile" locale="en" selectedId={null} onSelect={vi.fn()} />
    );

    // SAMPLE_COMMERCE_CART.items has 2 entries.
    expect(screen.getByText('قهوة عربية مختصة')).toBeTruthy();
    expect(screen.getByText('شاي أخضر فاخر')).toBeTruthy();
  });

  it('maps a click on a repeated (synthetic) instance back to the bound container id, not the generated instance id', () => {
    const onSelect = vi.fn();
    const root: AppSchemaComponent = {
      type: 'Page',
      id: 'home-root',
      children: [
        {
          type: 'ProductList',
          id: 'featured-list',
          binding: { resource: 'commerce.products' },
          children: [{ type: 'ProductCard', id: 'card-template', props: { title: '$item.name' } }],
        },
      ],
    };

    render(
      <AppBuilderCanvas root={root} device="mobile" locale="en" selectedId={null} onSelect={onSelect} />
    );

    // Instance ids are synthesized as `${templateId}-${item.id}` (runtime-contract.ts) and never
    // appear in the original schema — not even the bare template id ('card-template'), since the
    // template itself is consumed and replaced by N instances. The click must fall back to the
    // nearest surviving known ancestor: the bound container ('featured-list'), which is what the
    // Inspector can actually show/edit (its binding config and its one template child).
    fireEvent.click(screen.getByText('قهوة عربية مختصة'));
    expect(onSelect).toHaveBeenCalledWith('featured-list');
  });

  it('does not show the sample-data banner or resolve anything for a schema with no binding at all, even with commerce-shaped components present', () => {
    const root: AppSchemaComponent = {
      type: 'Page',
      id: 'home-root',
      children: [{ type: 'ProductCard', id: 'static-card', props: { title: 'يدوي', amountMinor: 1000 } }],
    };

    render(
      <AppBuilderCanvas root={root} device="mobile" locale="en" selectedId={null} onSelect={vi.fn()} />
    );

    expect(screen.getByText('يدوي')).toBeTruthy();
    expect(screen.queryByText('Sample data — not your real store data')).toBeNull();
  });
});
