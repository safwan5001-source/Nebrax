// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ScrollText } from 'lucide-react';
import { SoonNavEntry } from '../sidebar';

afterEach(cleanup);

describe('SoonNavEntry (ERP-UX-007)', () => {
  it('shows an unbuilt module with its badge but is not a link and not focusable', () => {
    render(<SoonNavEntry icon={ScrollText} label="Cheques" soonLabel="Soon" variant="list" />);
    const entry = screen.getByText('Cheques').parentElement as HTMLElement;
    expect(screen.getByText('Soon')).toBeTruthy();
    expect(entry.getAttribute('aria-disabled')).toBe('true');
    expect(document.querySelector('a')).toBeNull();
    expect(entry.tabIndex).toBe(-1);
  });

  it('is a disabled menu item inside the collapsed-sidebar flyout', () => {
    render(<div role="menu"><SoonNavEntry icon={ScrollText} label="Cheques" soonLabel="Soon" variant="menu" /></div>);
    const item = screen.getByRole('menuitem');
    expect(item.getAttribute('aria-disabled')).toBe('true');
    expect(item.getAttribute('href')).toBeNull();
  });
});
