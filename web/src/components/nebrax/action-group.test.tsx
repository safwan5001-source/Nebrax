/* @vitest-environment jsdom */
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ActionGroup } from './action-group';

vi.mock('next/link', () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

afterEach(cleanup);

describe('ActionGroup', () => {
  it('renders a navigational action as an anchor and keeps the primary action inline', () => {
    render(
      <ActionGroup
        actions={[
          { key: 'import', label: 'استيراد', href: '/products/import', variant: 'outline', emphasis: 'secondary' },
          { key: 'add', label: 'إضافة منتج', href: '/products/new', variant: 'primary' },
        ]}
      />
    );

    expect(screen.getByRole('link', { name: 'استيراد' }).getAttribute('href')).toBe('/products/import');
    expect(screen.getByRole('link', { name: 'إضافة منتج' }).getAttribute('href')).toBe('/products/new');
    expect(screen.queryByRole('button', { name: 'إجراءات إضافية' })).toBeNull();
  });

  it('collapses secondary actions beyond the inline limit into a single overflow menu', async () => {
    render(
      <ActionGroup
        inlineLimit={1}
        actions={[
          { key: 'a', label: 'تصدير', onClick: () => {}, variant: 'outline', emphasis: 'secondary' },
          { key: 'b', label: 'طباعة', onClick: () => {}, variant: 'outline', emphasis: 'secondary' },
          { key: 'c', label: 'أرشفة', onClick: () => {}, variant: 'outline', emphasis: 'secondary' },
          { key: 'd', label: 'إنشاء', onClick: () => {}, variant: 'primary' },
        ]}
      />
    );

    expect(screen.getByRole('button', { name: 'تصدير' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'إنشاء' })).toBeTruthy();

    // القائمة مخفية عن شجرة الوصول حتى تُفتح — فتحها هو ما يجعل بنودها مقروءة.
    await userEvent.click(screen.getByRole('button', { name: 'إجراءات إضافية' }));
    const menu = screen.getByRole('menu', { name: 'إجراءات إضافية' });
    expect(within(menu).getByRole('menuitem', { name: 'طباعة' })).toBeTruthy();
    expect(within(menu).getByRole('menuitem', { name: 'أرشفة' })).toBeTruthy();
    // ما طُوي لا يُعرض مرتين — لا زر مكرّر بنفس الاسم خارج القائمة.
    expect(screen.queryByRole('button', { name: 'طباعة' })).toBeNull();
  });

  it('never collapses a primary action, however many secondary actions exist', async () => {
    render(
      <ActionGroup
        inlineLimit={0}
        actions={[
          { key: 'a', label: 'تصدير', onClick: () => {}, variant: 'outline', emphasis: 'secondary' },
          { key: 'b', label: 'فاتورة جديدة', onClick: () => {}, variant: 'primary' },
        ]}
      />
    );

    expect(screen.getByRole('button', { name: 'فاتورة جديدة' })).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'إجراءات إضافية' }));
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'تصدير' })).toBeTruthy();
  });

  it('invokes the action handler on click', async () => {
    const onClick = vi.fn();
    render(<ActionGroup actions={[{ key: 'refresh', label: 'تحديث', onClick, variant: 'outline', emphasis: 'secondary' }]} />);

    await userEvent.click(screen.getByRole('button', { name: 'تحديث' }));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('renders nothing when there are no actions', () => {
    const { container } = render(<ActionGroup actions={[]} />);
    expect(container.firstChild).toBeNull();
  });
});
