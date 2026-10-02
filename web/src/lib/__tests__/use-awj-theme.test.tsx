import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen, cleanup } from '@testing-library/react';
import { useAwjTheme } from '../use-awj-theme';
import { AWJ_THEME_ATTRIBUTE, applyAwjTheme } from '../awj-theme';

// Reactive subscription test: the Settings selector and pre-paint script both mutate
// html[data-awj-theme] OUTSIDE React (direct DOM attribute writes), so useAwjTheme must
// observe via MutationObserver, not just read once on mount (mirrors use-awj-ui3.ts).

function Probe() {
  const theme = useAwjTheme();
  return <span data-testid="theme">{theme}</span>;
}

beforeEach(() => {
  document.documentElement.removeAttribute(AWJ_THEME_ATTRIBUTE);
});
afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute(AWJ_THEME_ATTRIBUTE);
});

describe('useAwjTheme', () => {
  it('reads "default" when the attribute is absent', () => {
    render(<Probe />);
    expect(screen.getByTestId('theme').textContent).toBe('default');
  });

  it('reacts to an external attribute change (MutationObserver), not just initial mount', async () => {
    render(<Probe />);
    expect(screen.getByTestId('theme').textContent).toBe('default');

    await act(async () => {
      applyAwjTheme('ink');
      await Promise.resolve();
    });
    expect(screen.getByTestId('theme').textContent).toBe('ink');

    await act(async () => {
      applyAwjTheme('default');
      await Promise.resolve();
    });
    expect(screen.getByTestId('theme').textContent).toBe('default');
  });
});
