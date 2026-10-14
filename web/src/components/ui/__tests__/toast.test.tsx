// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ToastProvider, useToast } from '../toast';
import { renderIntl } from '@/test-utils/intl';

function Trigger() {
  const toast = useToast();
  return (
    <>
      <button type="button" onClick={() => toast.success('Saved')}>ok</button>
      <button type="button" onClick={() => toast.error('Posting failed', 'Period is locked')}>fail</button>
    </>
  );
}

function setup(locale: 'ar' | 'en' = 'en') {
  renderIntl(<ToastProvider><Trigger /></ToastProvider>, locale);
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('Toast (ERP-UX-004)', () => {
  it('announces success politely and errors assertively', () => {
    setup();
    fireEvent.click(screen.getByText('ok'));
    fireEvent.click(screen.getByText('fail'));
    expect(screen.getByRole('status').textContent).toContain('Saved');
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Posting failed');
    expect(alert.getAttribute('aria-live')).toBe('assertive');
  });

  it('keeps errors longer than successes', () => {
    setup();
    fireEvent.click(screen.getByText('ok'));
    fireEvent.click(screen.getByText('fail'));
    act(() => { vi.advanceTimersByTime(4100); });
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
    act(() => { vi.advanceTimersByTime(4000); });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('pauses auto-dismiss while hovered', () => {
    setup();
    fireEvent.click(screen.getByText('ok'));
    const toast = screen.getByRole('status');
    fireEvent.mouseEnter(toast);
    act(() => { vi.advanceTimersByTime(10000); });
    expect(screen.getByRole('status')).toBeTruthy();
    fireEvent.mouseLeave(toast);
    act(() => { vi.advanceTimersByTime(4100); });
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('names the dismiss button in the interface language', () => {
    setup('en');
    fireEvent.click(screen.getByText('ok'));
    expect(screen.getByRole('button', { name: 'Dismiss notification' })).toBeTruthy();
    cleanup();
    setup('ar');
    fireEvent.click(screen.getByText('ok'));
    expect(screen.getByRole('button', { name: 'إغلاق التنبيه' })).toBeTruthy();
  });

  it('keeps an inline margin on both sides on phones instead of a full-width offset region', () => {
    setup();
    const region = document.querySelector('.no-print.fixed') as HTMLElement;
    expect(region.className).toContain('inset-x-4');
    expect(region.className).not.toMatch(/(^|\s)w-full(\s|$)/);
    expect(region.className).toContain('sm:max-w-sm');
  });

  it('still names the dismiss button from <html lang> without an intl provider', () => {
    document.documentElement.lang = 'en';
    render(<ToastProvider><Trigger /></ToastProvider>);
    fireEvent.click(screen.getByText('ok'));
    expect(screen.getByRole('button', { name: 'Dismiss notification' })).toBeTruthy();
    document.documentElement.lang = '';
  });
});
