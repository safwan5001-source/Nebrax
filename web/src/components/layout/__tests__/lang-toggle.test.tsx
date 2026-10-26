// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { renderIntl } from '@/test-utils/intl';
import { LangToggle } from '../lang-toggle';

const refresh = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh, replace: vi.fn(), push: vi.fn() }) }));

afterEach(() => {
  cleanup();
  refresh.mockClear();
});

describe('LangToggle (WCAG 2.5.3, label in name)', () => {
  it.each([
    ['ar', 'EN', 'تبديل اللغة'],
    ['en', 'ع', 'Switch language'],
  ] as const)('in %s the accessible name contains the visible text %s and the translated action', (locale, visible, action) => {
    renderIntl(<LangToggle />, locale);
    const button = screen.getByRole('button');
    expect(button.textContent).toContain(visible);
    const name = button.getAttribute('aria-label') ?? '';
    expect(name).toContain(visible);
    expect(name).toContain(action);
  });

  it('still switches the locale cookie and refreshes', () => {
    renderIntl(<LangToggle />, 'ar');
    fireEvent.click(screen.getByRole('button'));
    expect(document.cookie).toContain('locale=en');
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
