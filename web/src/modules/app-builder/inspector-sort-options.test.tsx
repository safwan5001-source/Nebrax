/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import ar from '@/messages/ar.json';
import type { AppBuilderRegistries, AppSchemaComponent } from '@/lib/app-builder';
import { Inspector } from './inspector';

const label = (v: string) => ({ en: v, ar: v });

const registries: AppBuilderRegistries = {
  components: {
    ProductList: {
      type: 'ProductList', version: 1, category: 'commerce', label: label('List'),
      props: [], children_rule: { kind: 'unboundedAny', suggested_child_type: null },
      actionable: false, injected_runtime_action_params: [], notes: '', bindable_resources: ['commerce.products'],
    },
  },
  actions: {},
  resources: {
    'commerce.products': {
      id: 'commerce.products', version: 1, shape: 'list', paginated: true, fields: [],
      query_params: [
        { key: 'search', kind: 'filter' },
        { key: 'name', kind: 'sort' },
        { key: 'created_at', kind: 'sort' },
        { key: 'popularity', kind: 'sort' },
        { key: 'brand_new_sort', kind: 'sort' },
      ],
    },
  },
  visibility_signals: [], visibility_operators: [],
};

const node: AppSchemaComponent = {
  type: 'ProductList', id: 'l1', binding: { resource: 'commerce.products', itemProps: {} } as never,
};

function renderIn(locale: 'en' | 'ar') {
  const messages = locale === 'en' ? en : ar;
  return render(
    <NextIntlClientProvider locale={locale} messages={{ appBuilder: messages.appBuilder }}>
      <Inspector node={node} registries={registries} pageIds={['home']} onChange={vi.fn()} onAddChild={vi.fn()} onRemove={vi.fn()} canRemove />
    </NextIntlClientProvider>,
  );
}

describe('binding sort options (AD-09 / S08b)', () => {
  afterEach(cleanup);

  it('shows human labels for known sorts including best-selling, and falls back to the raw key for unknown ones', () => {
    renderIn('en');
    const select = screen.getByLabelText('Sort by') as HTMLSelectElement;
    const options = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(options).toContain('Best-selling');
    expect(options).toContain('Name');
    expect(options).toContain('Date added');
    expect(options).toContain('brand_new_sort');
    expect(options).not.toContain('popularity');
  });

  it('is localized in Arabic', () => {
    renderIn('ar');
    const select = screen.getByLabelText('الترتيب حسب') as HTMLSelectElement;
    const options = within(select).getAllByRole('option').map((o) => o.textContent);
    expect(options).toContain('الأكثر مبيعاً');
  });
});
