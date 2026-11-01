/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextIntlClientProvider } from 'next-intl';
import en from '@/messages/en.json';
import ar from '@/messages/ar.json';
import type { AppBuilderRegistries, AppSchemaComponent } from '@/lib/app-builder';
import { axe } from 'jest-axe';
import { Inspector } from './inspector';

const label = (en_: string, ar_ = en_) => ({ en: en_, ar: ar_ });

const registries: AppBuilderRegistries = {
  components: {
    Promo: {
      type: 'Promo', version: 1, category: 'content', label: label('Promo'),
      props: [
        { key: 'title', type: 'string', required: true, label: label('Headline', 'العنوان'), default: null, enum_values: null },
        { key: 'count', type: 'integer', required: false, label: label('Count', 'العدد'), default: null, enum_values: null },
        { key: 'kind', type: 'string', required: false, label: label('Kind', 'النوع'), default: null, enum_values: ['a', 'b'] },
        { key: 'tags', type: 'stringList', required: false, label: label('Tags', 'الوسوم'), default: null, enum_values: null },
      ],
      children_rule: { kind: 'none', suggested_child_type: null },
      actionable: true, injected_runtime_action_params: [], notes: '', bindable_resources: [],
    },
  },
  actions: {
    openUrl: {
      type: 'openUrl', version: 1, risk_class: 'low', label: label('Open link', 'فتح رابط'),
      params: [{ key: 'url', type: 'string', required: true, label: label('Link', 'الرابط'), min_value: null } as never],
      dispatch_status: 'implemented', notes: '',
    },
  },
  resources: {}, visibility_signals: [], visibility_operators: [],
};

const node: AppSchemaComponent = {
  type: 'Promo', id: 'p1', props: { title: 'Hi', tags: ['x', 'y'] }, action: { type: 'openUrl', params: { url: 'https://a.b' } },
};

function renderInspector(locale: 'en' | 'ar' = 'en') {
  const messages = locale === 'en' ? en : ar;
  return render(
    <NextIntlClientProvider locale={locale} messages={{ appBuilder: messages.appBuilder }}>
      <Inspector node={node} registries={registries} pageIds={['home']} onChange={vi.fn()} onAddChild={vi.fn()} onRemove={vi.fn()} canRemove />
    </NextIntlClientProvider>,
  );
}

describe('Inspector accessibility (UX-03)', () => {
  afterEach(cleanup);

  it('every property label is programmatically tied to its control', () => {
    renderInspector();
    expect((screen.getByLabelText(/Headline/) as HTMLInputElement).value).toBe('Hi');
    expect(screen.getByLabelText(/Count/).tagName).toBe('INPUT');
    expect(screen.getByLabelText(/Kind/).tagName).toBe('SELECT');
  });

  it('action parameter labels are tied to their controls', () => {
    renderInspector();
    expect((screen.getByLabelText(/Link/) as HTMLInputElement).value).toBe('https://a.b');
  });

  it('list items, remove buttons and the add button have localized names', () => {
    renderInspector();
    const group = screen.getByRole('group', { name: /Tags/ });
    const removes = within(group).getAllByRole('button', { name: /remove/i });
    expect(removes).toHaveLength(2);
    // الاسم مترجم وفريد لكل عنصر (لا النص الجامد "remove")
    expect(new Set(removes.map((b) => b.getAttribute('aria-label'))).size).toBe(2);
    expect(removes.every((b) => b.getAttribute('aria-label') !== 'remove')).toBe(true);
    expect(within(group).getByRole('button', { name: /add/i })).toBeTruthy();
    expect(within(group).getAllByRole('textbox')).toHaveLength(2);
    for (const box of within(group).getAllByRole('textbox')) expect(box.getAttribute('aria-label') || '').not.toBe('');
  });

  it('the Arabic UI has no English-only control names', () => {
    renderInspector('ar');
    const group = screen.getByRole('group', { name: /الوسوم/ });
    for (const b of within(group).getAllByRole('button')) {
      expect(b.getAttribute('aria-label') ?? '').toMatch(/\p{Script=Arabic}/u);
    }
  });

  it('has no axe violations with props, list, action, binding and visibility editors open', async () => {
    const { container } = render(
      <NextIntlClientProvider locale="en" messages={{ appBuilder: en.appBuilder }}>
        <Inspector
          node={{
            ...node,
            binding: { resource: 'commerce.products', itemProps: {} } as never,
            visibility: { signal: 'cart.itemCount', operator: 'equals', value: 1 } as never,
          }}
          registries={{
            ...registries,
            components: { ...registries.components, Promo: { ...registries.components.Promo, bindable_resources: ['commerce.products'] } },
            resources: {
              'commerce.products': { id: 'commerce.products', version: 1, shape: 'list', paginated: true, fields: [], query_params: [{ key: 'search', kind: 'filter' }, { key: 'popularity', kind: 'sort' }] },
            },
            visibility_signals: ['cart.itemCount'],
            visibility_operators: [{ type: 'equals', value_arity: 'single' }],
          }}
          pageIds={['home']}
          onChange={vi.fn()}
          onAddChild={vi.fn()}
          onRemove={vi.fn()}
          canRemove
        />
      </NextIntlClientProvider>,
    );
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 120)).join(' | ')}`)).toEqual([]);
  });
});
