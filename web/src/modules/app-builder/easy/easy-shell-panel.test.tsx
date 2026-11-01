/* @vitest-environment jsdom */
import * as React from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { axe } from 'jest-axe';
import { NextIntlClientProvider, useTranslations } from 'next-intl';
import en from '@/messages/en.json';
import ar from '@/messages/ar.json';
import type { AppSchema } from '@/lib/app-builder';
import { EasyShellPanel } from './easy-shell-panel';

const page = (id: string) => ({ type: 'Page', id: `${id}-root`, children: [] });
const base = (navigation: Record<string, unknown> = {}): AppSchema => ({
  schemaVersion: '1.0.0', minRuntimeVersion: '1.0.0', theme: { tokens: {} },
  navigation: { initialPageId: 'home', ...navigation },
  pages: { home: page('home'), shop: page('shop'), about: page('about') },
} as unknown as AppSchema);

function Harness({ initial, canManage = true, locale = 'en' as 'en' | 'ar', onChange }: { initial: AppSchema; canManage?: boolean; locale?: 'en' | 'ar'; onChange?: (s: AppSchema) => void }) {
  const [schema, setSchema] = React.useState(initial);
  const t = useTranslations('appBuilder.builder');
  return (
    <EasyShellPanel
      schema={schema}
      pageLabel={(id) => `P:${id}`}
      canManage={canManage}
      t={t as never}
      onEdit={(edit) => setSchema((current) => { const next = edit(current) ?? current; onChange?.(next); return next; })}
    />
  );
}

const renderPanel = (props: React.ComponentProps<typeof Harness>) => {
  const messages = (props.locale ?? 'en') === 'en' ? en : ar;
  return render(
    <NextIntlClientProvider locale={props.locale ?? 'en'} messages={{ appBuilder: messages.appBuilder }}>
      <Harness {...props} />
    </NextIntlClientProvider>,
  );
};

describe('EasyShellPanel (AD-04 / S09d)', () => {
  afterEach(cleanup);

  it('enabling tabs creates one for the initial page; adding more respects the page list', () => {
    let last: AppSchema | null = null;
    renderPanel({ initial: base(), onChange: (s) => { last = s; } });
    fireEvent.click(screen.getByRole('button', { name: 'Enable bottom tabs' }));
    expect(last!.navigation.tabs).toEqual([{ pageId: 'home', title: 'P:home', icon: 'home' }]);

    fireEvent.change(screen.getByLabelText('Page to add'), { target: { value: 'shop' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add tab' }));
    expect(last!.navigation.tabs!.map((t) => t.pageId)).toEqual(['home', 'shop']);
  });

  it('editing title, icon and hidden writes through; reorder and remove work with named buttons', () => {
    let last: AppSchema | null = null;
    renderPanel({ initial: base({ tabs: [{ pageId: 'home', title: 'A', icon: 'home' }, { pageId: 'shop', title: 'B', icon: 'store' }] }), onChange: (s) => { last = s; } });

    fireEvent.change(screen.getByLabelText('Title of tab P:home'), { target: { value: 'الرئيسية' } });
    expect(last!.navigation.tabs![0].title).toBe('الرئيسية');
    fireEvent.change(screen.getByLabelText('Icon of tab P:shop'), { target: { value: 'offers' } });
    expect(last!.navigation.tabs![1].icon).toBe('offers');
    fireEvent.click(within(screen.getByTestId('shell-tab-shop')).getByRole('checkbox'));
    expect(last!.navigation.tabs![1].hidden).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Move P:shop up' }));
    expect(last!.navigation.tabs!.map((t) => t.pageId)).toEqual(['shop', 'home']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove tab P:home' }));
    expect(last!.navigation.tabs!.map((t) => t.pageId)).toEqual(['shop']);
    fireEvent.click(screen.getByRole('button', { name: 'Remove tab P:shop' }));
    expect('tabs' in last!.navigation).toBe(false);
  });

  it('with five visible tabs adding is disabled and the limit is explained', () => {
    const pages = ['home', 'shop', 'about', 'p4', 'p5'];
    const schema = base({ tabs: pages.map((id) => ({ pageId: id, title: id, icon: 'home' })) });
    (schema.pages as Record<string, unknown>).p4 = page('p4');
    (schema.pages as Record<string, unknown>).p5 = page('p5');
    (schema.pages as Record<string, unknown>).p6 = page('p6');
    renderPanel({ initial: schema });
    expect(screen.getByRole('button', { name: 'Add tab' }).hasAttribute('disabled')).toBe(true);
    expect(screen.getByText(/at most 5/i)).toBeTruthy();
    expect(screen.getByText('5 / 5 visible')).toBeTruthy();
  });

  it('top bar: title and cart toggle write appBar; clearing both removes the key', () => {
    let last: AppSchema | null = null;
    renderPanel({ initial: base(), onChange: (s) => { last = s; } });
    fireEvent.change(screen.getByLabelText('Top bar title'), { target: { value: 'متجري' } });
    expect(last!.navigation.appBar).toEqual({ title: 'متجري' });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show a cart button with the item count' }));
    expect(last!.navigation.appBar).toEqual({ title: 'متجري', showCart: true });
    fireEvent.change(screen.getByLabelText('Top bar title'), { target: { value: '' } });
    expect(last!.navigation.appBar).toEqual({ showCart: true });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show a cart button with the item count' }));
    expect(last!.navigation.appBar).toEqual({ showCart: false });
  });

  it('without manage permission everything is disabled', () => {
    renderPanel({ initial: base({ tabs: [{ pageId: 'home', title: 'A', icon: 'home' }] }), canManage: false });
    for (const el of [screen.getByLabelText('Title of tab P:home'), screen.getByLabelText('Top bar title'), screen.getByRole('button', { name: 'Remove tab P:home' })]) {
      expect(el.hasAttribute('disabled')).toBe(true);
    }
  });

  it('is fully localized in Arabic (no English-only names)', () => {
    renderPanel({ initial: base({ tabs: [{ pageId: 'home', title: 'A', icon: 'home' }] }), locale: 'ar' });
    for (const b of screen.getAllByRole('button')) expect(b.getAttribute('aria-label') ?? b.textContent ?? '').toMatch(/\p{Script=Arabic}/u);
  });

  it('has no axe violations with tabs and the top bar configured', async () => {
    const { container } = renderPanel({ initial: base({ tabs: [{ pageId: 'home', title: 'A', icon: 'home' }, { pageId: 'shop', title: 'B', icon: 'store', hidden: true }], appBar: { title: 'T', showCart: true } }) });
    const results = await axe(container, { rules: { 'color-contrast': { enabled: false } } });
    expect(results.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.html.slice(0, 100)).join(' | ')}`)).toEqual([]);
  });
});
