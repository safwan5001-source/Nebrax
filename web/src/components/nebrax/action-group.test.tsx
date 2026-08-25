/* @vitest-environment jsdom */
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionGroup } from './action-group';
import { TEST_LOCALES, nebraxText, renderIntl } from '@/test-utils/intl';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

afterEach(cleanup);

describe.each(TEST_LOCALES)('ActionGroup (%s)', (locale) => {
  it('renders a navigational action as an anchor and keeps the primary action inline', () => {
    renderIntl(
      <ActionGroup
        actions={[
          { key: 'import', label: 'Import', href: '/products/import', variant: 'outline', emphasis: 'secondary' },
          { key: 'add', label: 'Add product', href: '/products/new', variant: 'primary' },
        ]}
      />,
      locale
    );

    expect(screen.getByRole('link', { name: 'Import' }).getAttribute('href')).toBe('/products/import');
    expect(screen.getByRole('link', { name: 'Add product' }).getAttribute('href')).toBe('/products/new');
    expect(screen.queryByRole('button', { name: nebraxText(locale, 'moreActions') })).toBeNull();
  });

  it('collapses secondary actions beyond the inline limit into a single overflow menu', async () => {
    renderIntl(
      <ActionGroup
        inlineLimit={1}
        actions={[
          { key: 'a', label: 'Export', onClick: () => {}, variant: 'outline', emphasis: 'secondary' },
          { key: 'b', label: 'Print', onClick: () => {}, variant: 'outline', emphasis: 'secondary' },
          { key: 'c', label: 'Archive', onClick: () => {}, variant: 'outline', emphasis: 'secondary' },
          { key: 'd', label: 'Create', onClick: () => {}, variant: 'primary' },
        ]}
      />,
      locale
    );

    expect(screen.getByRole('button', { name: 'Export' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create' })).toBeTruthy();

    // القائمة مخفية عن شجرة الوصول حتى تُفتح — فتحها هو ما يجعل بنودها مقروءة.
    await userEvent.click(screen.getByRole('button', { name: nebraxText(locale, 'moreActions') }));
    const menu = screen.getByRole('menu', { name: nebraxText(locale, 'moreActions') });
    expect(within(menu).getByRole('menuitem', { name: 'Print' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: 'Archive' })).toBeTruthy();
    // ما طُوي لا يُعرض مرتين — لا زر مكرّر بنفس الاسم خارج القائمة.
    expect(screen.queryByRole('button', { name: 'Print' })).toBeNull();
  });

  it('never collapses a primary action, however many secondary actions exist', async () => {
    renderIntl(
      <ActionGroup
        inlineLimit={0}
        actions={[
          { key: 'a', label: 'Export', onClick: () => {}, variant: 'outline', emphasis: 'secondary' },
          { key: 'b', label: 'New invoice', onClick: () => {}, variant: 'primary' },
        ]}
      />,
      locale
    );

    expect(screen.getByRole('button', { name: 'New invoice' })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: nebraxText(locale, 'moreActions') }));
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Export' })).toBeTruthy();
  });

  it('invokes the action handler on click', async () => {
    const onClick = vi.fn();
    renderIntl(<ActionGroup actions={[{ key: 'refresh', label: 'Refresh', onClick, variant: 'outline', emphasis: 'secondary' }]} />, locale);

    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders nothing when there are no actions', () => {
    const { container } = renderIntl(<ActionGroup actions={[]} />, locale);
    expect(container.firstChild).toBeNull();
  });
});

describe('ActionGroup overflow label', () => {
  const overflowActions = [
    { key: 'a', label: 'Export', onClick: () => {}, variant: 'outline' as const, emphasis: 'secondary' as const },
  ];

  it('names the overflow menu in Arabic for the Arabic interface', () => {
    renderIntl(<ActionGroup inlineLimit={0} actions={overflowActions} />, 'ar');
    expect(screen.getByRole('button', { name: 'إجراءات إضافية' })).toBeTruthy();
  });

  it('names the overflow menu in English for the English interface', () => {
    renderIntl(<ActionGroup inlineLimit={0} actions={overflowActions} />, 'en');
    expect(screen.getByRole('button', { name: 'More actions' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'إجراءات إضافية' })).toBeNull();
  });

  it('lets a screen override the overflow label', () => {
    renderIntl(<ActionGroup inlineLimit={0} actions={overflowActions} overflowLabel="Invoice actions" />, 'en');
    expect(screen.getByRole('button', { name: 'Invoice actions' })).toBeTruthy();
  });
});
