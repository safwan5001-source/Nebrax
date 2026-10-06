/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Dropdown, DropdownItem } from './dropdown';

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => (
    <a href={href} {...rest}>{children}</a>
  ),
}));

describe('DropdownItem — choice and external-link items', () => {
  afterEach(cleanup);

  it('renders a choice as a menuitemradio carrying aria-checked, and still runs its handler', async () => {
    const onPick = vi.fn();
    const user = userEvent.setup();
    render(
      <Dropdown triggerLabel="Mode" trigger="Mode">
        <DropdownItem checked onClick={onPick}>Tablet</DropdownItem>
        <DropdownItem checked={false}>Mobile</DropdownItem>
        <DropdownItem>Plain</DropdownItem>
      </Dropdown>,
    );
    await user.click(screen.getByRole('button', { name: 'Mode' }));

    expect(screen.getByRole('menuitemradio', { name: 'Tablet' }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('menuitemradio', { name: 'Mobile' }).getAttribute('aria-checked')).toBe('false');
    // The choice is visible, not only announced: a check mark on the active
    // item, reserved (invisible) on the others so labels do not jump.
    const checkOf = (name: string) =>
      screen.getByRole('menuitemradio', { name }).querySelector('svg');
    expect(checkOf('Tablet')?.getAttribute('class')).not.toContain('invisible');
    expect(checkOf('Mobile')?.getAttribute('class')).toContain('invisible');
    // An item that never opts in stays a plain menuitem — nothing existing changes role.
    expect(screen.getByRole('menuitem', { name: 'Plain' }).getAttribute('aria-checked')).toBeNull();

    await user.click(screen.getByRole('menuitemradio', { name: 'Tablet' }));
    expect(onPick).toHaveBeenCalledTimes(1);
  });

  it('opens an external item in a new tab with a safe rel, outside next/link', async () => {
    const user = userEvent.setup();
    render(
      <Dropdown triggerLabel="More" trigger="More">
        <DropdownItem href="https://a.example.test/" external dataAttrs={{ 'data-probe': '1' }}>
          Open store
        </DropdownItem>
      </Dropdown>,
    );
    await user.click(screen.getByRole('button', { name: 'More' }));

    const link = screen.getByRole('menuitem', { name: 'Open store' });
    expect(link.getAttribute('href')).toBe('https://a.example.test/');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    expect(link.getAttribute('data-probe')).toBe('1');
  });

  it('keeps its items out of the tab order while closed and returns focus on Escape', async () => {
    const user = userEvent.setup();
    render(
      <Dropdown triggerLabel="More" trigger="More">
        <DropdownItem>One</DropdownItem>
        <DropdownItem href="https://a.example.test/" external>Two</DropdownItem>
      </Dropdown>,
    );
    const trigger = screen.getByRole('button', { name: 'More' });
    for (const item of document.querySelectorAll<HTMLElement>('[role="menuitem"]')) {
      expect(item.tabIndex).toBe(-1);
    }

    await user.click(trigger);
    await user.keyboard('{Escape}');
    expect(document.activeElement).toBe(trigger);
  });
});
