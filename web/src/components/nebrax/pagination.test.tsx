/* @vitest-environment jsdom */
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Pagination } from './pagination';

afterEach(cleanup);

describe('Pagination', () => {
  it('disables backward navigation on the first page and forward navigation on the last', () => {
    const { unmount } = render(
      <Pagination page={1} lastPage={3} perPage={25} onPageChange={() => {}} />
    );
    expect((screen.getByRole('button', { name: 'الصفحة السابقة' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'الصفحة التالية' }) as HTMLButtonElement).disabled).toBe(false);
    unmount();

    render(<Pagination page={3} lastPage={3} perPage={25} onPageChange={() => {}} />);
    expect((screen.getByRole('button', { name: 'الصفحة السابقة' }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: 'الصفحة التالية' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('reports the page position and total record count', () => {
    render(<Pagination page={2} lastPage={4} perPage={25} total={87} totalUnit="فاتورة" onPageChange={() => {}} />);

    const status = screen.getByLabelText('تنقّل النتائج').querySelector('p');
    expect(status?.textContent).toContain('87');
    expect(status?.textContent).toContain('فاتورة');
    expect(status?.textContent).toContain('2');
    expect(status?.textContent).toContain('4');
  });

  it('moves one page at a time and never past the bounds', async () => {
    const onPageChange = vi.fn();
    render(<Pagination page={2} lastPage={3} perPage={25} onPageChange={onPageChange} />);

    await userEvent.click(screen.getByRole('button', { name: 'الصفحة التالية' }));
    expect(onPageChange).toHaveBeenLastCalledWith(3);

    await userEvent.click(screen.getByRole('button', { name: 'الصفحة السابقة' }));
    expect(onPageChange).toHaveBeenLastCalledWith(1);
  });

  it('clamps an out-of-range page instead of rendering an impossible position', () => {
    const onPageChange = vi.fn();
    render(<Pagination page={9} lastPage={2} perPage={25} onPageChange={onPageChange} />);

    expect((screen.getByRole('button', { name: 'الصفحة التالية' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('omits the page-size control when the page cannot change it', () => {
    const { unmount } = render(<Pagination page={1} lastPage={2} perPage={25} onPageChange={() => {}} />);
    expect(screen.queryByLabelText('عدد النتائج في الصفحة')).toBeNull();
    unmount();

    const onPerPageChange = vi.fn();
    render(<Pagination page={1} lastPage={2} perPage={25} onPageChange={() => {}} onPerPageChange={onPerPageChange} />);
    expect(screen.getByLabelText('عدد النتائج في الصفحة')).toBeTruthy();
  });

  it('reports the chosen page size as a number', async () => {
    const onPerPageChange = vi.fn();
    render(<Pagination page={1} lastPage={2} perPage={25} onPageChange={() => {}} onPerPageChange={onPerPageChange} />);

    await userEvent.selectOptions(screen.getByLabelText('عدد النتائج في الصفحة'), '50');
    expect(onPerPageChange).toHaveBeenCalledWith(50);
  });
});
