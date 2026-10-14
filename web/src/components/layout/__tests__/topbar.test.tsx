// @vitest-environment jsdom
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { renderIntl } from '@/test-utils/intl';
import { Topbar } from '../topbar';

const setTheme = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ replace: vi.fn(), refresh: vi.fn(), push: vi.fn() }),
  usePathname: () => '/dashboard',
}));
vi.mock('next-themes', () => ({ useTheme: () => ({ theme: 'light', setTheme }) }));
vi.mock('@/lib/company', () => ({ useCompany: () => ({ name: 'AWJ Test', logo: null }) }));
vi.mock('@/lib/auth', () => ({ currentUser: () => ({ name: 'Owner', role: 'owner' }), logout: vi.fn() }));
vi.mock('@/lib/branch', () => ({ useBranches: () => ({ branches: [], active: null, activeId: null, setActiveBranchId: vi.fn() }) }));
vi.mock('../notification-bell', () => ({ NotificationBell: () => <button type="button">bell</button> }));
vi.mock('@/components/help-center/contextual-help-trigger', () => ({ ContextualHelpTrigger: () => <button type="button">help</button> }));

afterEach(cleanup);

describe('Topbar (ERP-UX-005/021)', () => {
  it('exposes the drawer state on the menu button and never lets it shrink', () => {
    renderIntl(<Topbar onMenuClick={() => {}} menuButtonRef={createRef()} menuExpanded={false} />, 'en');
    const menu = screen.getByRole('button', { name: 'Menu' });
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    expect(menu.className).toContain('shrink-0');
    cleanup();
    renderIntl(<Topbar onMenuClick={() => {}} menuButtonRef={createRef()} menuExpanded />, 'en');
    expect(screen.getByRole('button', { name: 'Menu' }).getAttribute('aria-expanded')).toBe('true');
  });

  it('keeps language and theme reachable on phones through the account menu', () => {
    renderIntl(<Topbar onMenuClick={() => {}} menuButtonRef={createRef()} />, 'en');
    // In the bar from sm upwards only.
    const barToggle = screen.getByRole('button', { name: 'Toggle color mode' });
    expect(barToggle.closest('div')?.className).toContain('hidden');
    expect(barToggle.closest('div')?.className).toContain('sm:flex');
    // In the account menu below sm.
    fireEvent.click(screen.getByRole('button', { name: 'Account' }));
    const accountMenu = document.querySelector('[role="menu"][aria-label="Account"]') as HTMLElement;
    expect(accountMenu.getAttribute('aria-hidden')).toBe('false');
    const items = [...accountMenu.querySelectorAll<HTMLElement>('[role="menuitem"]')];
    const themeItem = items.find((el) => el.textContent?.includes('Toggle color mode'));
    expect(themeItem).toBeTruthy();
    expect(themeItem?.parentElement?.className).toContain('sm:hidden');
    fireEvent.click(themeItem as HTMLElement);
    expect(setTheme).toHaveBeenCalledWith('dark');
    expect(items.some((el) => el.textContent?.includes('Switch language'))).toBe(true);
  });
});
