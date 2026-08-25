/* @vitest-environment jsdom */
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmptyState, ErrorState, LoadingState } from './states';
import { TEST_LOCALES, nebraxText, renderIntl } from '@/test-utils/intl';

afterEach(cleanup);

describe.each(TEST_LOCALES)('screen states (%s)', (locale) => {
  it('announces loading with a translated busy label rather than an empty surface', () => {
    renderIntl(<LoadingState rows={3} />, locale);

    const status = screen.getByRole('status', { name: nebraxText(locale, 'loading') });
    expect(status.getAttribute('aria-busy')).toBe('true');
  });

  it('lets a screen name what is loading instead of the generic label', () => {
    renderIntl(<LoadingState rows={3} label="Loading invoices" />, locale);

    expect(screen.getByRole('status', { name: 'Loading invoices' })).toBeTruthy();
    expect(screen.queryByRole('status', { name: nebraxText(locale, 'loading') })).toBeNull();
  });

  it('offers a translated retry on a load failure', async () => {
    const onRetry = vi.fn();
    renderIntl(<ErrorState message="Could not load" onRetry={onRetry} />, locale);

    expect(screen.getByRole('alert').textContent).toBe('Could not load');
    await userEvent.click(screen.getByRole('button', { name: nebraxText(locale, 'retry') }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('omits the retry button when no retry is possible', () => {
    renderIntl(<ErrorState message="Could not load" />, locale);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows the caller-supplied empty title, description and first action', () => {
    renderIntl(
      <EmptyState title="No invoices yet" description="Issue the first one." action={<button type="button">New invoice</button>} />,
      locale
    );

    expect(screen.getByText('No invoices yet')).toBeTruthy();
    expect(screen.getByText('Issue the first one.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'New invoice' })).toBeTruthy();
  });
});

describe('screen state language', () => {
  it('uses Arabic defaults in Arabic and English defaults in English', () => {
    const { unmount } = renderIntl(<ErrorState message="x" onRetry={() => {}} />, 'ar');
    expect(screen.getByRole('button').textContent).toBe('إعادة المحاولة');
    unmount();

    renderIntl(<ErrorState message="x" onRetry={() => {}} />, 'en');
    expect(screen.getByRole('button').textContent).toBe('Try again');
    expect(screen.getByRole('button').textContent).not.toMatch(/[؀-ۿ]/);
  });
});
