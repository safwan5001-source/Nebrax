// @vitest-environment jsdom
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import ar from '@/messages/ar.json';
import en from '@/messages/en.json';
import { ApiError } from '@/lib/api';
import { ALL_ERROR_KEYS, describeError } from '../errors';
import { EXPLANATION_CODES, VERIFY_PROBLEM_CODES, WARNING_CODES, explanationKey, safeParams, verifyProblemKey, warningKey } from './explanation';
import { clearReasonDraft, draftKey, loadReasonDraft, saveReasonDraft } from './reason-draft';

const ns = (messages: unknown) => (messages as { partnerStatements: Record<string, unknown> }).partnerStatements;
const get = (root: unknown, path: string): unknown => path.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), root);
const err = (status: number, body: Record<string, unknown> = {}) => new ApiError(status, String(body.message ?? 'x'), body);

describe('review error reasons (ar/en)', () => {
  const reasons = [
    'run_stale', 'statement_changed', 'run_is_not_the_reviewed_run', 'reconciliation_not_editable', 'reconciliation_not_draft', 'reconciliation_not_reviewed',
    'reason_required', 'reason_too_long', 'difference_exceeds_tolerance', 'unit_already_decided', 'dismiss_requires_missing_in_books', 'nothing_to_confirm',
    'line_not_in_run', 'line_not_found', 'unit_keys_invalid', 'unit_keys_not_allowed', 'unit_not_in_ledger', 'unit_not_reviewable',
    'pair_member_required', 'pair_member_not_allowed', 'pair_not_proven', 'pair_not_simple', 'pair_incomplete', 'unit_not_a_reversed_pair', 'action_invalid',
  ];

  it.each(reasons)('maps %s to a translated key in both languages (never the raw server text)', (reason) => {
    const descriptor = describeError(err(reason.startsWith('reconciliation') || reason === 'run_stale' || reason === 'unit_already_decided' ? 409 : 422, { message: 'SQL leak: tenant 7', reason }));
    expect(descriptor.key).not.toBe('unknown');
    expect(get(ns(ar), `errors.${descriptor.key}`), `ar ${descriptor.key}`).toBeTruthy();
    expect(get(ns(en), `errors.${descriptor.key}`), `en ${descriptor.key}`).toBeTruthy();
    expect(ALL_ERROR_KEYS).toContain(descriptor.key);
  });

  it('treats a changed statement as a full block, distinct from a stale ledger', () => {
    expect(describeError(err(409, { reason: 'statement_changed' })).key).toBe('statement_changed');
    expect(describeError(err(409, { reason: 'run_stale' })).key).toBe('family_stale');
  });

  it('carries safe numeric details for the tolerance error and falls back for an unknown reason', () => {
    const d = describeError(err(422, { reason: 'difference_exceeds_tolerance', details: { difference_minor: 500, tolerance_minor: 0 } }));
    expect(d.details).toEqual({ difference_minor: 500, tolerance_minor: 0 });
    expect(describeError(err(422, { reason: 'brand_new_code', message: 'x' })).key).toBe('validation');
    expect(describeError(err(429)).kind).toBe('throttled');
    expect(describeError(err(403, { message: 'هذه القدرة معلّقة (قراءة فقط)' })).kind).toBe('suspended');
  });
});

describe('engine explanation codes', () => {
  it('has an ar+en translation for every known code, warning and verify problem, plus the fallback', () => {
    for (const [group, codes] of [['explanation', EXPLANATION_CODES], ['warning', WARNING_CODES], ['verify_problem', VERIFY_PROBLEM_CODES]] as const) {
      for (const code of [...codes, 'unknown']) {
        expect(get(ns(ar), `workspace.${group}.${code}`), `ar ${group}.${code}`).toBeTruthy();
        expect(get(ns(en), `workspace.${group}.${code}`), `en ${group}.${code}`).toBeTruthy();
      }
    }
  });

  it('falls back to a meaningful generic key for unknown codes, never echoing them', () => {
    expect(explanationKey('some_future_code')).toBe('unknown');
    expect(explanationKey(null)).toBe('unknown');
    expect(warningKey('x')).toBe('unknown');
    expect(verifyProblemKey(undefined)).toBe('unknown');
    expect(explanationKey('amount_differs')).toBe('amount_differs');
  });

  it('keeps only short scalar params', () => {
    expect(safeParams({ a: 1, b: 'x', c: { nested: true }, d: 'y'.repeat(100), e: NaN, f: [1] })).toEqual({ a: 1, b: 'x' });
  });
});

describe('workspace catalogs', () => {
  const flatten = (value: unknown, prefix = ''): string[] =>
    value && typeof value === 'object'
      ? Object.entries(value as Record<string, unknown>).flatMap(([key, child]) => flatten(child, prefix ? `${prefix}.${key}` : key))
      : [prefix];

  it('ships the workspace subtree in lockstep for ar and en', () => {
    expect(flatten(ns(ar).workspace).sort()).toEqual(flatten(ns(en).workspace).sort());
  });

  it('resolves every static `t(\'…\')` key used by workspace components in both languages', () => {
    const dir = __dirname;
    const missing: string[] = [];
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.tsx') && !name.endsWith('.test.tsx'))) {
      const source = readFileSync(join(dir, file), 'utf8');
      for (const match of source.matchAll(/\bt\(\s*'([a-z_.]+)'/g)) {
        const key = match[1];
        for (const [lang, messages] of [['ar', ar], ['en', en]] as const) {
          if (!get(ns(messages), key)) missing.push(`${lang}:${file}:${key}`);
        }
      }
    }
    expect(missing).toEqual([]);
  });

  it('resolves every template key the components build dynamically', () => {
    const dynamic: string[] = [
      ...['confirm', 'override', 'dismiss', 'link_pair', 'clear'].map((a) => `workspace.action.${a}`),
      ...['matched', 'amount_difference', 'date_difference', 'ambiguous', 'missing_in_books', 'missing_in_statement', 'needs_review', 'neutralised', 'incomplete', 'unknown'].map((o) => `workspace.outcome.${o}`),
      ...['confirm', 'override', 'dismiss', 'link_pair'].map((a) => `workspace.form.reason_label_${a}`),
      ...['reason_required', 'accept_required'].map((b) => `workspace.form.block_${b}`),
      ...['statement_changed', 'no_run', 'run_stale', 'unresolved_lines', 'decisions_without_entry_identity', 'decisions_on_other_runs', 'other'].map((b) => `workspace.blocker.${b}`),
      ...['closed', 'voided', 'superseded'].map((s) => `workspace.readiness.final_${s}`),
      ...['mark_reviewed', 'reopen', 'close', 'void', 'supersede', 'other'].map((a) => `workspace.events.action_${a}`),
      ...['invoice', 'credit_note', 'payment', 'purchase', 'debit_note', 'return', 'other'].map((k) => `workspace.unit_kind.${k}`),
      ...['original', 'reversal'].map((m) => `workspace.pairs.member_${m}`),
      ...['pair_not_proven', 'pair_not_simple', 'pair_incomplete', 'unit_not_a_reversed_pair', 'other'].map((b) => `workspace.pairs.blocked_${b}`),
      ...['debit', 'credit'].map((d) => `workspace.direction.${d}`),
    ];
    for (const key of dynamic) {
      expect(get(ns(ar), key), `ar ${key}`).toBeTruthy();
      expect(get(ns(en), key), `en ${key}`).toBeTruthy();
    }
  });
});

describe('reason draft (text only, session scoped)', () => {
  afterEach(() => window.sessionStorage.clear());

  it('round-trips only the reason text under a key made of ids and the action', () => {
    const key = draftKey('rec-1', 'line-1', 'override');
    saveReasonDraft(key, 'agreed with the supplier', 1000);
    expect(loadReasonDraft(key, 2000)).toBe('agreed with the supplier');
    const stored = window.sessionStorage.getItem(key) as string;
    expect(Object.keys(JSON.parse(stored)).sort()).toEqual(['at', 'reason']);
    clearReasonDraft(key);
    expect(loadReasonDraft(key)).toBe('');
  });

  it('expires after two hours, removes empty drafts and caps the stored length', () => {
    const key = draftKey('r', 'l', 'dismiss');
    saveReasonDraft(key, 'text', 0);
    expect(loadReasonDraft(key, 2 * 60 * 60 * 1000 + 1)).toBe('');
    saveReasonDraft(key, 'x'.repeat(900), 5);
    expect(loadReasonDraft(key, 6).length).toBe(500);
    saveReasonDraft(key, '   ', 7);
    expect(window.sessionStorage.getItem(key)).toBeNull();
  });

  it('prunes old entries and survives blocked storage', () => {
    for (let i = 0; i < 40; i += 1) saveReasonDraft(draftKey('r', `l${i}`, 'confirm'), `reason ${i}`, 1000 + i);
    expect(window.sessionStorage.length).toBeLessThanOrEqual(30);
    const original = Object.getOwnPropertyDescriptor(window, 'sessionStorage') as PropertyDescriptor;
    Object.defineProperty(window, 'sessionStorage', { configurable: true, get: () => { throw new Error('blocked'); } });
    expect(() => saveReasonDraft('k', 'v')).not.toThrow();
    expect(loadReasonDraft('k')).toBe('');
    Object.defineProperty(window, 'sessionStorage', original);
  });
});
