import { useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_FILTERS, ReportFilters, type ReportFilterState } from './report-filters';

const apiMock = vi.hoisted(() => vi.fn());

vi.mock('next-intl', () => ({ useTranslations: () => (key: string, values?: Record<string, unknown>) => (values ? `${key}:${JSON.stringify(values)}` : key) }));
vi.mock('@/lib/api', () => ({ api: apiMock }));

afterEach(() => {
  cleanup();
  apiMock.mockReset();
});

const branches = [
  { id: 'b1', name: 'Main Branch' },
  { id: 'b2', name: 'Second Branch' },
];

function Harness({ initial }: { initial: ReportFilterState }) {
  const [value, setValue] = useState<ReportFilterState>(initial);
  return <ReportFilters compactMobile value={value} onChange={setValue} />;
}

describe('ReportFilters compactMobile', () => {
  it('shows no active-filter badge and opens the sheet with Apply/Reset', async () => {
    apiMock.mockResolvedValue({ data: branches });
    render(<Harness initial={EMPTY_FILTERS} />);

    await waitFor(() => expect(apiMock).toHaveBeenCalledWith('/branches'));

    // لا عدّاد ظاهر بلا مرشّحات فعّالة.
    expect(screen.queryByText('2')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: /^filters/ }));
    expect(screen.getByText('filters_title')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'apply' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'reset_all' })).toBeTruthy();
  });

  it('stages branch selection and applies only on confirm (not immediately)', async () => {
    apiMock.mockResolvedValue({ data: branches });
    const onChange = vi.fn();

    function Wrapped() {
      const [value, setValue] = useState<ReportFilterState>(EMPTY_FILTERS);
      return (
        <ReportFilters
          compactMobile
          value={value}
          onChange={(next: ReportFilterState) => {
            onChange(next);
            setValue(next);
          }}
        />
      );
    }

    render(<Wrapped />);
    await waitFor(() => expect(screen.queryByText('Main Branch')).toBeNull());

    fireEvent.click(screen.getByRole('button', { name: /^filters/ }));
    await waitFor(() => expect(screen.getByText('Main Branch')).toBeTruthy());

    fireEvent.click(screen.getByText('Main Branch'));
    // لم يُطبَّق بعد — لا نداء onChange حتى الآن.
    expect(onChange).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'apply' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ branchIds: ['b1'] }));
  });

  it('resets all filters immediately and closes the sheet', async () => {
    apiMock.mockResolvedValue({ data: branches });
    const onChange = vi.fn();
    render(
      <ReportFilters
        compactMobile
        value={{ from: '2026-01-01', to: '2026-01-31', branchIds: ['b1'] }}
        onChange={onChange}
      />
    );

    await waitFor(() => expect(apiMock).toHaveBeenCalled());

    fireEvent.click(screen.getByRole('button', { name: /^filters/ }));
    fireEvent.click(screen.getByRole('button', { name: 'reset_all' }));

    expect(onChange).toHaveBeenCalledWith(EMPTY_FILTERS);
  });
});
