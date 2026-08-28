import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ReportDataTable, defaultReportTableLabels, type ReportDataColumn } from './report-data-table';

afterEach(cleanup);

const columns: ReportDataColumn[] = [
  { id: 'account', label: 'Account', hideable: false },
];

const rows = Array.from({ length: 11 }, (_, index) => [`Account ${index + 1}`]);

describe('ReportDataTable pagination direction', () => {
  it('uses left for previous and right for next in LTR, with RTL rotation support', () => {
    render(
      <ReportDataTable
        columns={columns}
        rows={rows}
        labels={defaultReportTableLabels('en')}
        initialPageSize={10}
        resizeDirection="ltr"
      />
    );

    const previous = screen.getByRole('button', { name: 'Previous' });
    const next = screen.getByRole('button', { name: 'Next' });

    expect(previous.querySelector('.lucide-chevron-left')).toBeTruthy();
    expect(next.querySelector('.lucide-chevron-right')).toBeTruthy();
    expect(previous.querySelector('svg')?.getAttribute('class')).toContain('rtl:rotate-180');
    expect(next.querySelector('svg')?.getAttribute('class')).toContain('rtl:rotate-180');
  });
});
