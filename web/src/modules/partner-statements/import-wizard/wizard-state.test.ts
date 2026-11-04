import { describe, expect, it } from 'vitest';
import type { InspectColumn, PreviewResult } from '../contract';
import {
  WIZARD_STEPS,
  applyOptionsFrom,
  branchChoices,
  canConfirmImport,
  mappingGaps,
  mappingReady,
  previewOptionsFrom,
  previewVerdict,
  reconciliationHref,
  resultOutcome,
  setupIssues,
  setupReady,
  suggestedMapping,
  usesSingleAmount,
  type SetupInput,
} from './wizard-state';

const PARTNER = '11111111-1111-4111-8111-111111111111';
const BRANCH = '22222222-2222-4222-8222-222222222222';

const column = (index: number, suggested: string | null): InspectColumn => ({ index, header: `h${index}`, samples: [], suggested_field: suggested });

const setup = (patch: Partial<SetupInput> = {}): SetupInput => ({
  partnerId: PARTNER, role: 'customer', periodFrom: '2026-01-01', periodTo: '2026-03-31', branchId: '',
  dateToleranceDays: 3, amountToleranceMinor: 0, branchRequired: false, ...patch,
});

const preview = (patch: Partial<PreviewResult> = {}): PreviewResult => ({
  partner_id: PARTNER, partner_name: 'شركة النور', role: 'customer', period_from: '2026-01-01', period_to: '2026-03-31', currency: 'SAR',
  policy: { version: 1, currency: 'SAR', date_tolerance_days: 3, amount_tolerance_minor: 0, amount_direction: null, include_reversed: true, branch_id: null },
  mapping: {}, total_rows: 3, line_rows: 3, warning_rows: 0, error_rows: 0, valid_rows: 3, invalid_rows: 0, total_debit_minor: 100, total_credit_minor: 0,
  checks: { balance_rows: 0, balance_pairs_checked: 0, balance_mismatches: [], balance_mismatches_truncated: false },
  already_imported: false, existing_reconciliation_id: null, rows: [], rows_shown: 0, rows_truncated: false, errors: [],
  binding: { id: 'p1', hash: 'h' }, ...patch,
});

describe('wizard steps', () => {
  it('runs file → setup → mapping → preview → confirm → result', () => {
    expect([...WIZARD_STEPS]).toEqual(['file', 'setup', 'mapping', 'preview', 'confirm', 'result']);
  });
});

describe('mapping rules mirror the server', () => {
  it('suggests one column per field (no double binding)', () => {
    const mapping = suggestedMapping([column(0, 'line_date'), column(1, 'debit'), column(2, 'debit'), column(3, null)]);
    expect(mapping).toEqual({ 0: 'line_date', 1: 'debit', 2: null, 3: null });
  });

  it('accepts date + debit + credit, or date + a single amount with an explicit direction', () => {
    expect(mappingReady({ 0: 'line_date', 1: 'debit', 2: 'credit' }, null)).toBe(true);
    expect(mappingReady({ 0: 'line_date', 1: 'amount' }, 'positive_is_debit')).toBe(true);
  });

  it('rejects missing date, lone debit/credit, mixed styles, missing/unexpected direction and duplicates', () => {
    expect(mappingGaps({ 0: 'debit', 1: 'credit' }, null).missingDate).toBe(true);
    expect(mappingGaps({ 0: 'line_date', 1: 'debit' }, null).amountMissing).toBe(true);
    expect(mappingGaps({ 0: 'line_date', 1: 'amount', 2: 'debit' }, 'positive_is_debit').amountConflict).toBe(true);
    expect(mappingGaps({ 0: 'line_date', 1: 'amount' }, null).directionRequired).toBe(true);
    expect(mappingGaps({ 0: 'line_date', 1: 'debit', 2: 'credit' }, 'positive_is_debit').directionUnexpected).toBe(true);
    expect(mappingGaps({ 0: 'line_date', 1: 'line_date', 2: 'amount' }, 'positive_is_debit').duplicate).toBe(true);
    expect(mappingReady({}, null)).toBe(false);
  });

  it('knows when a single amount column is used', () => {
    expect(usesSingleAmount({ 0: 'amount' })).toBe(true);
    expect(usesSingleAmount({ 0: 'debit', 1: 'credit' })).toBe(false);
  });
});

describe('setup validation', () => {
  it('is ready with a role, partner, valid period and tolerances', () => {
    expect(setupReady(setup(), 30)).toBe(true);
  });

  it('flags each problem separately', () => {
    expect(setupIssues(setup({ role: '' }), 30).role).toBe(true);
    expect(setupIssues(setup({ partnerId: '' }), 30).partner).toBe(true);
    expect(setupIssues(setup({ periodFrom: '2026-05-01', periodTo: '2026-01-01' }), 30).period).toBe('inverted');
    expect(setupIssues(setup({ dateToleranceDays: 31 }), 30).dateTolerance).toBe(true);
    expect(setupIssues(setup({ dateToleranceDays: null }), 30).dateTolerance).toBe(true);
    expect(setupIssues(setup({ amountToleranceMinor: null }), 30).amountTolerance).toBe(true);
  });

  it('forces a branch for branch-restricted actors (no organization-wide option)', () => {
    expect(setupReady(setup({ branchRequired: true, branchId: '' }), 30)).toBe(false);
    expect(setupReady(setup({ branchRequired: true, branchId: BRANCH }), 30)).toBe(true);
    expect(setupReady(setup({ branchRequired: false, branchId: '' }), 30)).toBe(true);
  });
});

describe('frozen options', () => {
  it('builds identical preview and job options so the preview binding matches', () => {
    const mapping = { 0: 'line_date', 1: 'amount', 2: null };
    const options = previewOptionsFrom(setup({ branchId: BRANCH, amountToleranceMinor: 150 }), mapping, 'positive_is_credit');
    expect(options).toMatchObject({ partnerId: PARTNER, role: 'customer', branchId: BRANCH, amountToleranceMinor: 150, amountDirection: 'positive_is_credit' });
    expect(applyOptionsFrom(options)).toEqual({
      partner_id: PARTNER, role: 'customer', period_from: '2026-01-01', period_to: '2026-03-31',
      date_tolerance_days: 3, amount_tolerance_minor: 150, branch_id: BRANCH, amount_direction: 'positive_is_credit', mapping,
    });
  });

  it('omits direction for debit/credit files and branch for organization scope', () => {
    const options = previewOptionsFrom(setup(), { 0: 'line_date', 1: 'debit', 2: 'credit' }, 'positive_is_debit');
    expect(options.amountDirection).toBeNull();
    expect(options.branchId).toBeNull();
    const payload = applyOptionsFrom(options);
    expect(payload).not.toHaveProperty('amount_direction');
    expect(payload).not.toHaveProperty('branch_id');
    expect(payload).not.toHaveProperty('currency');
  });

  it('refuses to build options from an incomplete setup', () => {
    expect(() => previewOptionsFrom(setup({ role: '' }), {}, null)).toThrow();
  });
});

describe('preview verdict and confirmation', () => {
  it('blocks errors and empty files, and routes duplicates to the existing reconciliation', () => {
    expect(previewVerdict(preview({ error_rows: 2 }))).toBe('blocked_errors');
    expect(previewVerdict(preview({ total_rows: 0 }))).toBe('blocked_empty');
    expect(previewVerdict(preview({ already_imported: true, existing_reconciliation_id: 'r1' }))).toBe('already_imported');
    expect(previewVerdict(preview())).toBe('ready');
  });

  it('requires an explicit acknowledgement and a clean, non-duplicate preview', () => {
    expect(canConfirmImport(preview(), false)).toBe(false);
    expect(canConfirmImport(preview(), true)).toBe(true);
    expect(canConfirmImport(preview({ already_imported: true }), true)).toBe(false);
    expect(canConfirmImport(preview({ error_rows: 1 }), true)).toBe(false);
    expect(canConfirmImport(null, true)).toBe(false);
  });
});

describe('import outcome', () => {
  it('reads the reconciliation id from apply_result', () => {
    expect(resultOutcome({ reconciliation_id: 'r1', created: 1, replayed: false, lines: 12 })).toEqual({ kind: 'created', reconciliationId: 'r1', lines: 12 });
  });

  it('flags a replay (the same file imported before) without creating anything new', () => {
    expect(resultOutcome({ reconciliation_id: 'r1', created: 0, skipped: 1, replayed: true })).toEqual({ kind: 'replayed', reconciliationId: 'r1', lines: null });
  });

  it('survives a missing or malformed result', () => {
    expect(resultOutcome(null)).toEqual({ kind: 'created', reconciliationId: null, lines: null });
    expect(resultOutcome({ reconciliation_id: 42 })).toEqual({ kind: 'created', reconciliationId: null, lines: null });
  });

  it('links to the list with a highlight (no detail route exists before A4b)', () => {
    expect(reconciliationHref('abc-1')).toBe('/partner-statements?highlight=abc-1');
    expect(reconciliationHref(null)).toBe('/partner-statements');
  });
});

describe('branch choices', () => {
  const fetched = [{ id: 'b1', name: 'فرع الدمام' }, { id: 'b2', name: 'فرع جدة' }];

  it('offers unrestricted actors whatever /branches returned', () => {
    expect(branchChoices({ restricted: false, scopeIds: [], fetched, failed: false })).toEqual([{ id: 'b1', name: 'فرع الدمام' }, { id: 'b2', name: 'فرع جدة' }]);
  });

  it('limits restricted actors to their own branches, named when the lookup worked', () => {
    expect(branchChoices({ restricted: true, scopeIds: ['b2'], fetched, failed: false })).toEqual([{ id: 'b2', name: 'فرع جدة' }]);
  });

  it('falls back to the actor scope from /me (unnamed) when /branches is denied, so the required field is never impossible', () => {
    expect(branchChoices({ restricted: true, scopeIds: ['b1', 'b9'], fetched: [], failed: true })).toEqual([{ id: 'b1', name: null }, { id: 'b9', name: null }]);
  });

  it('shows nothing while the lookup is still pending', () => {
    expect(branchChoices({ restricted: true, scopeIds: ['b1'], fetched: [], failed: false })).toEqual([]);
  });
});
