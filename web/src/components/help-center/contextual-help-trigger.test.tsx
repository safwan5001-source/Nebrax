// @vitest-environment jsdom
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl, TEST_MESSAGES, TEST_LOCALES } from '@/test-utils/intl';
import { ContextualHelpTrigger } from './contextual-help-trigger';

const navigation = vi.hoisted(() => ({ pathname: '/invoices/new', push: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ push: navigation.push }),
}));

beforeEach(() => {
  navigation.pathname = '/invoices/new';
  navigation.push.mockReset();
});

afterEach(cleanup);

describe('ContextualHelpTrigger', () => {
  it.each(TEST_LOCALES)('opens the mapped V1 article in %s with the correct direction', (locale) => {
    const messages = TEST_MESSAGES[locale].helpCenter;
    renderIntl(<ContextualHelpTrigger placement="topbar" />, locale);

    fireEvent.click(screen.getByRole('button', { name: messages.contextualTitle }));

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('dir')).toBe(locale === 'ar' ? 'rtl' : 'ltr');
    expect(screen.getByText(locale === 'ar' ? 'إنشاء فاتورة مبيعات' : 'Create a sales invoice')).toBeTruthy();
    expect(screen.getByRole('link', { name: messages.openFullArticle }).getAttribute('href')).toBe('/help/create-sales-invoice');
    expect(dialog.className).toContain('w-full');
    expect(dialog.className).toContain('sm:max-w-md');
  });

  it('adds no protected product shortcut to the contextual sheet', () => {
    renderIntl(<ContextualHelpTrigger placement="topbar" />);
    fireEvent.click(screen.getByRole('button', { name: 'مساعدة هذه الشاشة' }));

    const links = within(screen.getByRole('dialog')).getAllByRole('link');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('/help/create-sales-invoice');
  });

  it('opens the same contextual sheet from the mobile user-menu action', () => {
    renderIntl(<ContextualHelpTrigger placement="menu" />);

    fireEvent.click(screen.getByRole('menuitem', { name: 'مساعدة هذه الشاشة', hidden: true }));

    expect(screen.getByRole('dialog')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'فتح المقال الكامل' }).getAttribute('href')).toBe('/help/create-sales-invoice');
  });

  it('preserves the V1 Help Center navigation on an unmapped route without opening a sheet', () => {
    navigation.pathname = '/reports';
    renderIntl(<ContextualHelpTrigger placement="topbar" />);

    fireEvent.click(screen.getByRole('button', { name: 'مركز المساعدة' }));

    expect(navigation.push).toHaveBeenCalledWith('/help');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
