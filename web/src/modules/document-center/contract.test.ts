import { describe, expect, it } from 'vitest';
import {
  buildBatchListQuery,
  filtersFromSearchParams,
  filtersToSearchParams,
} from './contract';

describe('document-center contract', () => {
  it('builds list query from filters', () => {
    const path = buildBatchListQuery({
      search: 'PI-2084',
      status: 'needs_review',
      documentType: 'purchase_invoice',
      sourceType: 'manual',
      channel: 'web',
      reviewerId: 'user-1',
      from: '2026-08-01',
      to: '2026-08-31',
      blockingOnly: true,
    }, 2, 25);

    expect(path).toContain('search=PI-2084');
    expect(path).toContain('status=needs_review');
    expect(path).toContain('document_type=purchase_invoice');
    expect(path).toContain('reviewer_id=user-1');
    expect(path).toContain('has_blocking=1');
    expect(path).toContain('page=2');
    expect(path).toContain('per_page=25');
  });

  it('round-trips URL search params', () => {
    const params = new URLSearchParams('status=ready_for_draft&document_type=expense&has_blocking=1');
    const filters = filtersFromSearchParams(params);
    expect(filters.status).toBe('ready_for_draft');
    expect(filters.documentType).toBe('expense');
    expect(filters.blockingOnly).toBe(true);
    expect(filtersToSearchParams(filters).get('status')).toBe('ready_for_draft');
  });
});
