import { describe, expect, it } from 'vitest';
import { resolveAssistantContext } from '../context';
import { checkDate, checkPeriod, monthStart } from '../dates';
import { gateFor } from '../gate';
import { ApiError } from '@/lib/api';
import { classifyError } from '../state';
import { blockedStatus, makeStatus } from './fixtures';

const UUID = '3f2b8c1e-5a4d-4e7b-9c1a-0d2e4f6a8b10';

describe('resolveAssistantContext (approved metadata only)', () => {
  it('maps known paths and keeps only a valid UUID as entity id', () => {
    expect(resolveAssistantContext('/invoices')).toMatchObject({ kind: 'invoices', entityId: null });
    expect(resolveAssistantContext(`/invoices/${UUID}`)).toMatchObject({ kind: 'invoice_detail', entityId: UUID });
    expect(resolveAssistantContext('/invoices/not-a-uuid')).toMatchObject({ kind: 'invoices', entityId: null });
    expect(resolveAssistantContext('/reports/general/income-statement')).toMatchObject({ kind: 'income_statement_report', suggestedTools: ['finance.income_statement'] });
    expect(resolveAssistantContext('/reports/customers/aging').kind).toBe('receivables_aging_report');
    expect(resolveAssistantContext('/reports/purchases/aging').kind).toBe('payables_aging_report');
    expect(resolveAssistantContext('/something/else').kind).toBe('other');
    expect(resolveAssistantContext(null).kind).toBe('other');
  });

  it('ignores query strings (nothing from the URL beyond the path is read)', () => {
    expect(resolveAssistantContext('/invoices?customer=secret&q=ahmad')).toMatchObject({ kind: 'invoices', entityId: null });
  });

  it('recognises a Document Center review screen by its UUID only (AI-04)', () => {
    expect(resolveAssistantContext(`/documents/${UUID}`)).toMatchObject({ kind: 'document_review', entityId: UUID, suggestedTools: [] });
    expect(resolveAssistantContext(`/documents/${UUID.toUpperCase()}/`)).toMatchObject({ kind: 'document_review', entityId: UUID });
    expect(resolveAssistantContext('/documents/operations').kind).toBe('other');
    expect(resolveAssistantContext('/documents/not-a-uuid').kind).toBe('other');
    expect(resolveAssistantContext(`/documents/${UUID}/diagnostics`).kind).toBe('other');
    expect(resolveAssistantContext('/documents').kind).toBe('other');
  });

  it('exposes nothing but kind, entityId and suggestions', () => {
    expect(Object.keys(resolveAssistantContext(`/invoices/${UUID}`)).sort()).toEqual(['entityId', 'kind', 'suggestedTools']);
  });
});

describe('date validation (cosmetic mirror of the server rules)', () => {
  const today = '2026-10-16';
  it('rejects malformed, impossible, pre-2000 and future dates', () => {
    expect(checkDate('2026-02-30', today)).toBe('invalid');
    expect(checkDate('16/10/2026', today)).toBe('invalid');
    expect(checkDate('1999-12-31', today)).toBe('invalid');
    expect(checkDate('2026-10-17', today)).toBe('future');
    expect(checkDate('2026-10-16', today)).toBeNull();
  });
  it('validates ordering and the 366-day ceiling', () => {
    expect(checkPeriod('2026-10-10', '2026-10-01', today).range).toBe('inverted');
    expect(checkPeriod('2025-01-01', '2026-10-01', today).range).toBe('too_long');
    expect(checkPeriod('2025-10-15', '2026-10-16', today).range).toBe('too_long'); // 367 days inclusive
    expect(checkPeriod('2025-10-16', '2026-10-16', today).range).toBeNull(); // exactly 366 inclusive
  });
  it('starts the default period at the first of the organization month', () => {
    expect(monthStart(today)).toBe('2026-10-01');
  });
});

describe('gateFor', () => {
  it('stays loading until the server state arrives — nothing is assumed', () => {
    expect(gateFor({ statusPhase: 'idle', status: null, statusError: null }, 'financial')).toEqual({ kind: 'loading' });
    expect(gateFor({ statusPhase: 'loading', status: null, statusError: null }, 'chat')).toEqual({ kind: 'loading' });
  });
  it('reports a status read failure', () => {
    const statusError = classifyError(new ApiError(500, 'x', null));
    expect(gateFor({ statusPhase: 'error', status: null, statusError }, 'chat')).toEqual({ kind: 'error', error: statusError });
  });
  it('blocks on each non-ready capability and passes only on ready', () => {
    for (const state of ['permission_denied', 'platform_disabled', 'tenant_disabled', 'consent_required', 'provider_unavailable', 'currency_unsupported'] as const) {
      expect(gateFor({ statusPhase: 'ready', status: blockedStatus(state), statusError: null }, 'financial')).toEqual({ kind: 'blocked', notice: state });
    }
    expect(gateFor({ statusPhase: 'ready', status: makeStatus(), statusError: null }, 'financial')).toEqual({ kind: 'ready' });
  });
  it('evaluates chat and financial independently', () => {
    const status = makeStatus({ chat: 'ready', financial: 'consent_required' });
    expect(gateFor({ statusPhase: 'ready', status, statusError: null }, 'chat').kind).toBe('ready');
    expect(gateFor({ statusPhase: 'ready', status, statusError: null }, 'financial').kind).toBe('blocked');
  });
});
