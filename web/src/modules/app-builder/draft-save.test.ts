/* @vitest-environment jsdom */
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import type { AppSchema } from '@/lib/app-builder';
import {
  classifySaveError, clearDraftBackup, clearDraftBackupIfSaved, draftStatesEqual, parseDraftConflict, readDraftBackup, schemasEqual, writeDraftBackup,
} from './draft-save';

const schema: AppSchema = {
  schemaVersion: '1.0.0', minRuntimeVersion: '1.0.0', navigation: { initialPageId: 'home' },
  pages: { home: { type: 'Page', id: 'home-root', children: [] } },
};

const conflictBody = { message: 'x', reason: 'draft_conflict', current_revision: 5, base_revision: 3, updated_by: 'u2', updated_at: '2026-10-30T10:00:00+00:00' };

describe('parseDraftConflict', () => {
  it('reads the structured 409 draft_conflict body', () => {
    expect(parseDraftConflict(new ApiError(409, 'x', conflictBody))).toEqual({
      currentRevision: 5, baseRevision: 3, updatedBy: 'u2', updatedAt: '2026-10-30T10:00:00+00:00',
    });
  });

  it('tolerates a missing updated_by/updated_at', () => {
    expect(parseDraftConflict(new ApiError(409, 'x', { reason: 'draft_conflict', current_revision: 1, base_revision: 0 })))
      .toEqual({ currentRevision: 1, baseRevision: 0, updatedBy: null, updatedAt: null });
  });

  it.each([
    ['a different 409', new ApiError(409, 'x', { reason: 'idempotency_conflict' })],
    ['a 409 without numeric revisions', new ApiError(409, 'x', { reason: 'draft_conflict', current_revision: '5', base_revision: 3 })],
    ['a 422', new ApiError(422, 'x', conflictBody)],
    ['a 409 with no body', new ApiError(409, 'x', null)],
    ['a non-ApiError', new TypeError('Failed to fetch')],
    ['undefined', undefined],
  ])('returns null for %s', (_name, err) => {
    expect(parseDraftConflict(err)).toBeNull();
  });
});

describe('classifySaveError', () => {
  it('distinguishes conflict, forbidden, validation, network and other', () => {
    expect(classifySaveError(new ApiError(409, 'x', conflictBody))).toBe('conflict');
    expect(classifySaveError(new ApiError(409, 'x', { reason: 'other' }))).toBe('other');
    expect(classifySaveError(new ApiError(403, 'x', {}))).toBe('forbidden');
    expect(classifySaveError(new ApiError(422, 'x', {}))).toBe('validation');
    expect(classifySaveError(new ApiError(500, 'x', {}))).toBe('other');
    expect(classifySaveError(new TypeError('Failed to fetch'))).toBe('network');
  });
});

describe('local draft backup', () => {
  beforeEach(() => window.localStorage.clear());

  it('round-trips a backup including the base revision it was edited from', () => {
    expect(writeDraftBackup('u1', 'app-1', schema, 4)).toBe(true);
    const backup = readDraftBackup('u1', 'app-1');
    expect(backup?.baseRevision).toBe(4);
    expect(backup?.schema).toEqual(schema);
    expect(backup?.appId).toBe('app-1');
  });

  it('is isolated per user and per app', () => {
    writeDraftBackup('u1', 'app-1', schema, 1);
    expect(readDraftBackup('u2', 'app-1')).toBeNull();
    expect(readDraftBackup('u1', 'app-2')).toBeNull();
  });

  it('ignores a backup whose stored identity does not match its key (tampered or stale)', () => {
    window.localStorage.setItem('awj.appBuilder.draftBackup.v1.u1.app-1', JSON.stringify({ v: 1, appId: 'app-OTHER', userId: 'u1', schema, baseRevision: 1, savedAt: 'x' }));
    expect(readDraftBackup('u1', 'app-1')).toBeNull();
  });

  it.each([['not json', '{oops'], ['wrong version', JSON.stringify({ v: 2 })], ['no schema', JSON.stringify({ v: 1, appId: 'app-1', userId: 'u1', baseRevision: 1 })], ['no revision', JSON.stringify({ v: 1, appId: 'app-1', userId: 'u1', schema })]])(
    'returns null for corrupt data (%s)', (_name, raw) => {
      window.localStorage.setItem('awj.appBuilder.draftBackup.v1.u1.app-1', raw);
      expect(readDraftBackup('u1', 'app-1')).toBeNull();
    },
  );

  it('clears a backup', () => {
    writeDraftBackup('u1', 'app-1', schema, 1);
    clearDraftBackup('u1', 'app-1');
    expect(readDraftBackup('u1', 'app-1')).toBeNull();
  });

  it("clearDraftBackupIfSaved removes the backup only when it matches what was saved (another tab's unsaved work survives)", () => {
    const other = { ...schema, navigation: { initialPageId: 'other' } } as AppSchema;
    writeDraftBackup('u1', 'app-1', other, 1); // تبويب آخر لم يحفظ
    clearDraftBackupIfSaved('u1', 'app-1', schema);
    expect(readDraftBackup('u1', 'app-1')?.schema).toEqual(other);

    writeDraftBackup('u1', 'app-1', schema, 1); // نسخة تخصّ ما حُفظ
    clearDraftBackupIfSaved('u1', 'app-1', schema);
    expect(readDraftBackup('u1', 'app-1')).toBeNull();

    clearDraftBackupIfSaved('u1', 'app-1', schema); // لا شيء مخزَّن: لا خطأ
  });

  it('never throws when storage is blocked or full', () => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => { throw new Error('QuotaExceededError'); };
    try {
      expect(writeDraftBackup('u1', 'app-1', schema, 1)).toBe(false);
    } finally {
      Storage.prototype.setItem = original;
    }
  });
});

describe('schemasEqual', () => {
  it('compares structurally', () => {
    expect(schemasEqual(schema, JSON.parse(JSON.stringify(schema)))).toBe(true);
    expect(schemasEqual(schema, { ...schema, navigation: { initialPageId: 'other' } })).toBe(false);
  });
});

describe('draft state with editor meta (AD-05)', () => {
  beforeEach(() => window.localStorage.clear());
  const meta = { v: 1 as const, nodes: { home: { 'sec-1': { hidden: true as const } } }, pages: {} };

  it('round-trips editor meta in the local backup', () => {
    writeDraftBackup('u1', 'app-1', schema, 2, meta);
    expect(readDraftBackup('u1', 'app-1')?.editorMeta).toEqual(meta);
  });

  it('a meta-only change is a real difference; null and undefined meta are equal', () => {
    expect(draftStatesEqual({ schema, editorMeta: null }, { schema, editorMeta: meta })).toBe(false);
    expect(draftStatesEqual({ schema, editorMeta: null }, { schema, editorMeta: null })).toBe(true);
  });

  it('a saved draft clears its backup only when the meta matches too', () => {
    writeDraftBackup('u1', 'app-1', schema, 2, meta);
    clearDraftBackupIfSaved('u1', 'app-1', schema, null); // مخطط مطابق لكن بيانات المحرر أحدث محلياً
    expect(readDraftBackup('u1', 'app-1')).not.toBeNull();
    clearDraftBackupIfSaved('u1', 'app-1', schema, meta);
    expect(readDraftBackup('u1', 'app-1')).toBeNull();
  });
});
