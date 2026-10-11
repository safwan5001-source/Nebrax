import { describe, expect, it } from 'vitest';
import {
  buildDeliveryChannelCsv,
  comparisonRows,
  deliveryChannelPath,
  readDeliveryChannelReport,
  shownCreditNotes,
  shownFinancialMetrics,
  type DeliveryChannelCsvLabels,
  CSV_COLUMNS,
} from '@/lib/delivery-channel-report';
import { deliveryChannelFixture } from '@/lib/__tests__/delivery-channel-report.fixture';

function labels(): DeliveryChannelCsvLabels {
  const columns = Object.fromEntries(CSV_COLUMNS.map((column) => [column, column])) as DeliveryChannelCsvLabels['columns'];
  return {
    columns,
    sections: {
      summary: 'Summary',
      creditNotes: 'Credit notes',
      creditNotesNotSubtracted: 'Credit notes are not subtracted',
      collection: 'Collection',
      exceptions: 'Exceptions',
      platform: 'Platform',
      invoice: 'Invoice',
      returnDocument: 'Return',
      creditNote: 'Credit note',
    },
    names: {
      grossSales: 'Gross',
      discounts: 'Discounts',
      shipping: 'Shipping',
      adjustment: 'Adjustment',
      netSales: 'Net',
      vat: 'VAT',
      total: 'Total',
      invoiceCount: 'Invoices',
      returnsCount: 'Returns',
      returnsSubtotal: 'Return subtotal',
      returnsVat: 'Return VAT',
      returnsTotal: 'Return total',
      netAfterReturns: 'Net after returns',
      creditNoteCount: 'Credit count',
      creditNoteTotal: 'Credit total',
      platformCollected: 'Platform collected',
      merchantCollected: 'Merchant collected',
      unclassified: 'Unclassified',
      contextMismatch: 'Context mismatch',
      partnerMismatch: 'Partner mismatch',
    },
  };
}

describe('delivery channel report contract', () => {
  it('maps headline metrics from the summary without recomputing VAT or subtracting credit notes', () => {
    const report = deliveryChannelFixture();
    const shown = shownFinancialMetrics(report);
    expect(shown.find((metric) => metric.id === 'vat')?.value).toBe('13.50');
    expect(shown.find((metric) => metric.id === 'net_sales')?.value).toBe('92.75');
    expect(shown.find((metric) => metric.id === 'net_after_pos_returns')?.value).toBe('94.75');
    expect(shown.find((metric) => metric.id === 'total')?.value).toBe(report.summary.total);
    expect(shownCreditNotes(report)).toEqual({ count: 1, total: '20.00' });
    expect(shown.find((metric) => metric.id === 'net_after_pos_returns')?.value).not.toBe('74.75');
  });

  it('keeps two profiles with the same platform key as separate comparison rows', () => {
    const rows = comparisonRows(deliveryChannelFixture());
    expect(rows.map((row) => row.id)).toEqual(['profile-1', 'profile-2']);
    expect(rows.every((row) => row.platformKey === 'jahez')).toBe(true);
    expect(rows[0]?.total).toBe('106.25');
  });

  it('sends only backend filters', () => {
    expect(deliveryChannelPath({ from: '', to: '', branchIds: [], profileId: '' })).toBe('/reports/delivery-channel');
    const path = deliveryChannelPath({
      from: '2026-03-01',
      to: '2026-03-31',
      branchIds: ['branch-a', 'branch-b'],
      profileId: 'profile-1',
    });
    expect(path).toContain('from=2026-03-01');
    expect(path).toContain('to=2026-03-31');
    expect(path).toContain('branch_id%5B%5D=branch-a');
    expect(path).toContain('branch_id%5B%5D=branch-b');
    expect(path).toContain('delivery_platform_profile_id=profile-1');
    expect(path).not.toContain('payment_status');
    expect(path).not.toContain('hub');
  });

  it('rejects a payload that is not the posted delivery contract, including a hub list', () => {
    const payload = { ...deliveryChannelFixture(), hub_orders: [{ id: 'hub-1', total: '999.00' }] };
    const parsed = readDeliveryChannelReport(payload);
    expect(parsed).not.toBeNull();
    expect(parsed && 'hub_orders' in parsed).toBe(false);
    expect(readDeliveryChannelReport({ ...payload, summary: { ...payload.summary, vat: '13.5' } })).toBeNull();
    expect(readDeliveryChannelReport({ ...payload, scope: { ...payload.scope, source: 'hub_orders' } })).toBeNull();
  });

  it('neutralizes user-controlled export text and keeps negative money numeric', () => {
    const csv = buildDeliveryChannelCsv(deliveryChannelFixture(), labels()).replace('\uFEFF', '');
    expect(csv).toContain("'=1+1");
    expect(csv).toContain("'=هنقر");
    expect(csv).toContain("'@Hunger");
    expect(csv).toContain("'=الدمام");
    expect(csv).toContain(',-0.25,');
    expect(csv).not.toContain(",=1+1");
    expect(csv).not.toContain(",'-0.25");
    expect(csv).toContain('Credit notes are not subtracted');
    expect(csv).toContain('20.00');
    expect(csv).toContain('94.75');
  });
});
