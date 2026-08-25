/* @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EmptyState, ErrorState, LoadingState } from './states';

afterEach(cleanup);

describe('screen states', () => {
  it('announces loading as a busy status rather than an empty surface', () => {
    render(<LoadingState label="جارٍ تحميل الفواتير" rows={3} />);
    const status = screen.getByRole('status', { name: 'جارٍ تحميل الفواتير' });
    expect(status.getAttribute('aria-busy')).toBe('true');
  });

  it('shows an empty state title with an optional first action', () => {
    render(<EmptyState title="لا توجد فواتير بعد" description="ابدأ بإصدار أول فاتورة." action={<button type="button">فاتورة جديدة</button>} />);

    expect(screen.getByText('لا توجد فواتير بعد')).toBeTruthy();
    expect(screen.getByText('ابدأ بإصدار أول فاتورة.')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'فاتورة جديدة' })).toBeTruthy();
  });

  it('raises a load failure as an alert and offers a retry', async () => {
    const onRetry = vi.fn();
    render(<ErrorState message="تعذّر تحميل البيانات" onRetry={onRetry} />);

    expect(screen.getByRole('alert').textContent).toBe('تعذّر تحميل البيانات');
    await userEvent.click(screen.getByRole('button', { name: 'إعادة المحاولة' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('omits the retry button when no retry is possible', () => {
    render(<ErrorState message="تعذّر تحميل البيانات" />);
    expect(screen.queryByRole('button')).toBeNull();
  });
});
