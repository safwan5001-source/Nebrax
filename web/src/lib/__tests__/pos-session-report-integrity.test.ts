import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

function source(file: string) {
  return readFileSync(resolve(process.cwd(), file), 'utf8');
}

describe('POS session report integrity', () => {
  it('renders invoice rows from the selected session report contract only', () => {
    const page = source('src/app/(app)/pos/report/page.tsx');

    expect(page).toContain('interface ReportResponse { session: Session; report: Report; sales: SessionSale[]; returns: SessionReturn[] }');
    expect(page).toContain('api<ReportResponse>(`/pos-sessions/${selectedId}/report`)');
    expect(page).toContain('setSales(result.sales)');
    expect(page).toContain('setReturns(result.returns)');
    expect(page).not.toContain("api<{ data: Invoice[] }>('/invoices')");
    expect(page).not.toContain('.slice(0, 10)');
    expect(page).toContain('`-${formatRiyal(item.total)}`');
    expect(page).not.toContain('href={`/returns/${item.id}`}');
    expect(page).not.toContain('href: `/returns/${item.id}`');
  });

  it('prevents stale session responses from replacing the selected report', () => {
    const page = source('src/app/(app)/pos/report/page.tsx');

    expect(page).toContain('const reportRequestId = useRef(0)');
    expect(page).toContain('requestId !== reportRequestId.current');
    expect(page).toContain('requestId === reportRequestId.current');
    expect(page).toContain('setSession(null); setReport(null); setSales([])');
  });

  it('offers explicit retry and print states using the accounting design tokens', () => {
    const page = source('src/app/(app)/pos/report/page.tsx');

    expect(page).toContain('onSelect: () => window.print()');
    expect(page).toContain('className="print-only');
    expect(page).toContain('role="alert"');
    expect(page).toContain('border-border');
    expect(page).toContain('bg-surface');
    expect(page).not.toMatch(/#[0-9a-f]{3,8}/i);
    expect(page).not.toContain('gradient');
  });
});
