/* @vitest-environment jsdom */
import * as React from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useToday } from './use-today';

function Probe() {
  return <p data-testid="today">{useToday()}</p>;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-12T23:59:30Z'));
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('useToday', () => {
  it('starts on the current UTC date and rolls over at UTC midnight without any interaction', () => {
    render(<Probe />);
    expect(screen.getByTestId('today').textContent).toBe('2026-10-12');
    act(() => {
      vi.advanceTimersByTime(29_000);
    });
    expect(screen.getByTestId('today').textContent).toBe('2026-10-12');
    act(() => {
      vi.advanceTimersByTime(2_000);
    });
    expect(screen.getByTestId('today').textContent).toBe('2026-10-13');
    // and keeps rolling on the following days
    act(() => {
      vi.advanceTimersByTime(86_400_000);
    });
    expect(screen.getByTestId('today').textContent).toBe('2026-10-14');
  });

  it('re-reads the date when the tab becomes visible again (a sleeping device skips timers)', () => {
    render(<Probe />);
    vi.setSystemTime(new Date('2026-10-15T08:00:00Z'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(screen.getByTestId('today').textContent).toBe('2026-10-15');
  });

  it('clears its timer on unmount', () => {
    const { unmount } = render(<Probe />);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });
});
