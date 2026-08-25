/* @vitest-environment jsdom */
import { cleanup, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Pagination } from './pagination';
import { ARABIC_DISPLAY_LOCALE, ENGLISH_DISPLAY_LOCALE } from '@/lib/formatting';
import { TEST_LOCALES, nebraxText, renderIntl } from '@/test-utils/intl';

afterEach(cleanup);

describe.each(TEST_LOCALES)('Pagination (%s)', (locale) => {
  const label = (key: 'previousPage' | 'nextPage' | 'perPage' | 'resultsNavigation') => nebraxText(locale, key);

  it('labels its controls in the active language', () => {
    renderIntl(<Pagination page={1} lastPage={3} perPage={25} onPageChange={() => {}} onPerPageChange={() => {}} />, locale);

    expect(screen.getByRole('navigation', { name: label('resultsNavigation') })).toBeTruthy();
    expect(screen.getByRole('button', { name: label('previousPage') })).toBeTruthy();
    expect(screen.getByRole('button', { name: label('nextPage') })).toBeTruthy();
    expect(screen.getByLabelText(label('perPage'))).toBeTruthy();
  });

  it('disables backward navigation on the first page and forward navigation on the last', () => {
    const { unmount } = renderIntl(<Pagination page={1} lastPage={3} perPage={25} onPageChange={() => {}} />, locale);
    expect((screen.getByRole('button', { name: label('previousPage') }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: label('nextPage') }) as HTMLButtonElement).disabled).toBe(false);
    unmount();

    renderIntl(<Pagination page={3} lastPage={3} perPage={25} onPageChange={() => {}} />, locale);
    expect((screen.getByRole('button', { name: label('previousPage') }) as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByRole('button', { name: label('nextPage') }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('moves one page at a time and never past the bounds', async () => {
    const onPageChange = vi.fn();
    renderIntl(<Pagination page={2} lastPage={3} perPage={25} onPageChange={onPageChange} />, locale);

    await userEvent.click(screen.getByRole('button', { name: label('nextPage') }));
    expect(onPageChange).toHaveBeenLastCalledWith(3);

    await userEvent.click(screen.getByRole('button', { name: label('previousPage') }));
    expect(onPageChange).toHaveBeenLastCalledWith(1);
  });

  it('clamps an out-of-range page instead of rendering an impossible position', () => {
    renderIntl(<Pagination page={9} lastPage={2} perPage={25} onPageChange={() => {}} />, locale);
    expect((screen.getByRole('button', { name: label('nextPage') }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('omits the page-size control when the page cannot change it', () => {
    renderIntl(<Pagination page={1} lastPage={2} perPage={25} onPageChange={() => {}} />, locale);
    expect(screen.queryByLabelText(label('perPage'))).toBeNull();
  });

  it('reports the chosen page size as a number', async () => {
    const onPerPageChange = vi.fn();
    renderIntl(<Pagination page={1} lastPage={2} perPage={25} onPageChange={() => {}} onPerPageChange={onPerPageChange} />, locale);

    await userEvent.selectOptions(screen.getByLabelText(label('perPage')), '50');
    expect(onPerPageChange).toHaveBeenCalledWith(50);
  });
});

describe('Pagination summary language', () => {
  function summary() {
    return screen.getByRole('navigation').querySelector('p')?.textContent ?? '';
  }

  it('states the page position in Arabic for the Arabic interface', () => {
    renderIntl(<Pagination page={2} lastPage={4} perPage={25} total={87654} onPageChange={() => {}} />, 'ar');

    expect(summary()).toContain('صفحة');
    expect(summary()).toContain('نتيجة');
    expect(summary()).not.toMatch(/Page|results/);
  });

  it('states the page position in English for the English interface', () => {
    renderIntl(<Pagination page={2} lastPage={4} perPage={25} total={87654} onPageChange={() => {}} />, 'en');

    expect(summary()).toContain('Page');
    expect(summary()).toContain('results');
    // لا بقايا عربية تتسرّب من الطبقة المشتركة إلى واجهة إنجليزية.
    expect(summary()).not.toMatch(/[؀-ۿ]/);
  });

  it('pluralises the English record count instead of always saying "results"', () => {
    const { unmount } = renderIntl(<Pagination page={1} lastPage={1} perPage={25} total={1} onPageChange={() => {}} />, 'en');
    expect(summary()).toContain('1 result');
    expect(summary()).not.toContain('1 results');
    unmount();

    renderIntl(<Pagination page={1} lastPage={1} perPage={25} total={2} onPageChange={() => {}} />, 'en');
    expect(summary()).toContain('2 results');
  });

  it('formats numbers with the active display locale, never a pinned Arabic one', () => {
    const { unmount } = renderIntl(<Pagination page={1} lastPage={9} perPage={25} total={87654} onPageChange={() => {}} />, 'en');
    expect(summary()).toContain((87654).toLocaleString(ENGLISH_DISPLAY_LOCALE));
    unmount();

    renderIntl(<Pagination page={1} lastPage={9} perPage={25} total={87654} onPageChange={() => {}} />, 'ar');
    expect(summary()).toContain((87654).toLocaleString(ARABIC_DISPLAY_LOCALE));
  });

  it('keeps Latin digits in both languages', () => {
    const { unmount } = renderIntl(<Pagination page={2} lastPage={4} perPage={25} total={87654} onPageChange={() => {}} />, 'ar');
    expect(summary()).toMatch(/2/);
    expect(summary()).not.toMatch(/[٠-٩]/);
    unmount();

    renderIntl(<Pagination page={2} lastPage={4} perPage={25} total={87654} onPageChange={() => {}} />, 'en');
    expect(summary()).not.toMatch(/[٠-٩]/);
  });

  it('renders the counters with the Mono numeral class in both languages', () => {
    for (const locale of TEST_LOCALES) {
      const { unmount } = renderIntl(<Pagination page={2} lastPage={4} perPage={25} total={87} onPageChange={() => {}} />, locale);
      expect(screen.getByRole('navigation').querySelectorAll('p .num').length).toBeGreaterThanOrEqual(3);
      unmount();
    }
  });
});
