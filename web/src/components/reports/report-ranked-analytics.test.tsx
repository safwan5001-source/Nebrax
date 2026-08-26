import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ReportRankedAnalytics, type ReportRankedAnalyticsRow } from './report-ranked-analytics';

const baseProps = {
  analyticsKey: 'ranking-test',
  loading: false,
  title: 'Ranking',
  description: 'Ranking description',
  emptyLabel: 'Empty ranking',
  unassignedLabel: 'Unassigned',
};

afterEach(cleanup);

function labels() {
  return Array.from(screen.getByTestId('report-ranked-analytics-ranking-test').querySelectorAll('li span:first-child')).map((element) => element.textContent);
}

describe('ReportRankedAnalytics ranking modes', () => {
  it('keeps its default positive-only behavior and excludes zero and negative values', () => {
    const rows: ReportRankedAnalyticsRow[] = [
      { key: 'positive', label: 'Positive', amount: '12.00' },
      { key: 'zero', label: 'Zero', amount: '0.00' },
      { key: 'negative', label: 'Negative', amount: '-9.00' },
    ];

    render(<ReportRankedAnalytics {...baseProps} rows={rows} />);

    expect(labels()).toEqual(['Positive']);
    expect(screen.queryByText('Negative')).toBeNull();
    expect(rows.map((row) => row.amount)).toEqual(['12.00', '0.00', '-9.00']);
  });

  it('accepts signed values in absolute-signed mode, ranks by magnitude, and retains the source sign in display text', () => {
    const rows: ReportRankedAnalyticsRow[] = [
      { key: 'positive', label: 'Positive 500', amount: '500.00' },
      { key: 'negative', label: 'Negative 400', amount: '-400.00' },
      { key: 'small', label: 'Positive 100', amount: '100.00' },
      { key: 'zero', label: 'Zero', amount: '0.00' },
    ];

    render(<ReportRankedAnalytics {...baseProps} rows={rows} rankingMode="absolute-signed" />);

    expect(labels()).toEqual(['Positive 500', 'Negative 400', 'Positive 100']);
    expect(screen.getByTestId('report-ranked-analytics-ranking-test').textContent).toContain('-400.00');
    expect(screen.queryByText('Empty ranking')).toBeNull();
    expect(rows.map((row) => row.amount)).toEqual(['500.00', '-400.00', '100.00', '0.00']);
  });

  it('does not show an empty state when signed mode receives negative-only source rows', () => {
    render(<ReportRankedAnalytics {...baseProps} rows={[{ key: 'negative', label: 'Negative only', amount: '-25.00' }]} rankingMode="absolute-signed" />);

    expect(labels()).toEqual(['Negative only']);
    expect(screen.getByTestId('report-ranked-analytics-ranking-test').textContent).toContain('-25.00');
    expect(screen.queryByText('Empty ranking')).toBeNull();
  });
});
