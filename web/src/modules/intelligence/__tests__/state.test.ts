import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import arMessages from '@/messages/ar.json';
import enMessages from '@/messages/en.json';
import { classifyError, errorCode, type NoticeKey } from '../state';

const err = (status: number, code?: string) =>
  new ApiError(status, 'x', code ? { error: { code, message: 'm' }, request_id: 'r' } : { message: 'm' });

describe('classifyError', () => {
  it.each([
    ['platform_disabled', 503, 'platform_disabled'],
    ['tenant_not_enabled', 403, 'tenant_disabled'],
    ['consent_required', 403, 'consent_required'],
    ['permission_denied', 403, 'permission_denied'],
    ['tool_permission_denied', 403, 'tool_permission_denied'],
    ['provider_unavailable', 503, 'provider_unavailable'],
    ['external_provider_not_acknowledged', 403, 'external_provider_not_acknowledged'],
    ['external_documents_not_acknowledged', 403, 'external_documents_not_acknowledged'],
    ['external_documents_unavailable', 503, 'external_documents_unavailable'],
    ['currency_unsupported', 422, 'currency_unsupported'],
    ['budget_not_configured', 402, 'budget_not_configured'],
    ['budget_exceeded', 429, 'budget_exceeded'],
    ['platform_budget_exceeded', 429, 'platform_budget_exceeded'],
    ['pricing_unknown', 503, 'pricing_unknown'],
    ['invalid_tool_arguments', 422, 'invalid_tool_arguments'],
    ['branch_scope_forbidden', 403, 'branch_scope_forbidden'],
    ['warehouse_scope_forbidden', 403, 'warehouse_scope_forbidden'],
    ['acknowledgement_required', 422, 'acknowledgement_required'],
    ['request_in_progress', 409, 'duplicate_request'],
    ['document_unavailable', 404, 'document_unavailable'],
    ['document_not_reviewed', 409, 'document_not_reviewed'],
    ['document_review_stale', 409, 'document_review_stale'],
    ['document_quarantined', 409, 'document_quarantined'],
    ['document_scan_incomplete', 409, 'document_scan_incomplete'],
    ['document_on_hold', 409, 'document_on_hold'],
    ['document_retention_ended', 409, 'document_retention_ended'],
    ['document_projection_unavailable', 409, 'document_projection_unavailable'],
    ['document_too_large', 422, 'document_too_large'],
  ] as [string, number, NoticeKey][])('maps server code %s to %s', (code, status, notice) => {
    const result = classifyError(err(status, code));
    expect(result.notice).toBe(notice);
    expect(result.code).toBe(code);
  });

  it('prefers the server code over the HTTP status (budget 429 is not a rate limit)', () => {
    expect(classifyError(err(429, 'budget_exceeded')).notice).toBe('budget_exceeded');
    expect(classifyError(err(429)).notice).toBe('rate_limited');
    expect(classifyError(err(429)).retryable).toBe(true);
  });

  it('falls back by status when no code is present', () => {
    expect(classifyError(err(403)).notice).toBe('permission_denied');
    expect(classifyError(err(422)).notice).toBe('invalid_request');
    expect(classifyError(err(500)).notice).toBe('server_error');
    expect(classifyError(err(418)).notice).toBe('unknown_error');
  });

  it('treats a thrown non-ApiError as a network failure that claims no result', () => {
    const result = classifyError(new TypeError('Failed to fetch'));
    expect(result).toMatchObject({ notice: 'network_error', status: null, code: null, retryable: true, refreshStatus: false });
  });

  it('asks for a status re-read only when permission/consent/enablement may have changed', () => {
    expect(classifyError(err(403, 'consent_required')).refreshStatus).toBe(true);
    expect(classifyError(err(403, 'permission_denied')).refreshStatus).toBe(true);
    expect(classifyError(err(403, 'external_provider_not_acknowledged')).refreshStatus).toBe(true);
    expect(classifyError(err(403, 'external_documents_not_acknowledged')).refreshStatus).toBe(true);
    expect(classifyError(err(422, 'invalid_tool_arguments')).refreshStatus).toBe(false);
    expect(classifyError(err(500)).refreshStatus).toBe(false);
  });

  it('reads codes only from the standard error envelope', () => {
    expect(errorCode({ error: { code: 'a' } })).toBe('a');
    expect(errorCode({ code: 'a' })).toBeNull();
    expect(errorCode(null)).toBeNull();
  });
});

describe('notice copy', () => {
  const KEYS: NoticeKey[] = [
    'platform_disabled', 'tenant_disabled', 'consent_required', 'permission_denied', 'tool_permission_denied', 'provider_unavailable',
    'external_provider_not_acknowledged', 'external_documents_not_acknowledged', 'external_documents_unavailable', 'currency_unsupported', 'branch_scope_forbidden', 'warehouse_scope_forbidden', 'scope_not_supported', 'invalid_tool_arguments',
    'invalid_request', 'budget_not_configured', 'budget_exceeded', 'platform_budget_exceeded', 'pricing_unknown',
    'acknowledgement_required', 'data_category_unavailable', 'duplicate_request', 'rate_limited', 'network_error', 'server_error', 'unknown_error',
    'category_unavailable', 'document_center_unavailable', 'document_unavailable', 'document_not_reviewed', 'document_review_stale', 'document_quarantined',
    'document_scan_incomplete', 'document_on_hold', 'document_retention_ended', 'document_projection_unavailable', 'document_too_large',
  ];
  it.each([['ar', arMessages], ['en', enMessages]] as const)('has a title and body for every state in %s', (_locale, messages) => {
    const notice = (messages as unknown as { intelligence: { notice: Record<string, { title?: string; body?: string }> } }).intelligence.notice;
    for (const key of KEYS) {
      expect(notice[key]?.title, key).toBeTruthy();
      expect(notice[key]?.body, key).toBeTruthy();
    }
  });
});

describe('message tree', () => {
  const dotted = (node: unknown, path = ''): string[] =>
    node && typeof node === 'object'
      ? Object.entries(node).flatMap(([key, value]) => [...(key.includes('.') ? [`${path}${key}`] : []), ...dotted(value, `${path}${key}.`)])
      : [];
  it.each([['ar', arMessages], ['en', enMessages]] as const)('has no dotted keys (next-intl treats them as paths) in %s', (_l, messages) => {
    expect(dotted((messages as unknown as { intelligence: unknown }).intelligence)).toEqual([]);
  });
});
