import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';

const apiMock = vi.fn();
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return {
    ...actual,
    api: (...args: unknown[]) => apiMock(...args),
  };
});

import {
  cancelPresentationVersionSchedule,
  commerceStorefrontPresentationVersionPath,
  commerceStorefrontPresentationVersionPublishPath,
  commerceStorefrontPresentationVersionSchedulePath,
  commerceStorefrontPresentationVersionsPath,
  createPresentationVersion,
  deletePresentationVersion,
  listPresentationVersions,
  publishPresentationVersion,
  renamePresentationVersion,
  savePresentationVersion,
  schedulePresentationVersion,
  showPresentationVersion,
} from './presentation-versions';

afterEach(() => apiMock.mockReset());

const CONFIG = {
  version: 1,
  themePreset: 'navy',
  primaryColor: '#1e3a5f',
  homepage: { heroHeadline: 'مرحبا' },
};

function summary(overrides: Record<string, unknown> = {}) {
  return {
    id: 'v1',
    storefront_id: 'store-1',
    name: 'رمضان 1448',
    state: 'draft',
    schema_version: 1,
    revision: 1,
    scheduled_for: null,
    last_published_at: null,
    created_at: '2026-09-01T00:00:00.000Z',
    updated_at: '2026-09-01T00:00:00.000Z',
    // CUST-H1-5 — present on every real row (see `summarize()`); tests that
    // care about a specific value override it explicitly.
    schedule_token: 'opaque-token-0',
    scheduling_runtime_active: true,
    ...overrides,
  };
}

function detailEnvelope(overrides: Record<string, unknown> = {}) {
  return { data: { ...summary(overrides), config: CONFIG } };
}

describe('commerce workspace presentation-versions API client', () => {
  it('builds workspace-scoped paths only, never store/v1 or a tenant segment', () => {
    expect(commerceStorefrontPresentationVersionsPath('store-1')).toBe(
      '/commerce/workspace/storefronts/store-1/presentation/versions',
    );
    expect(commerceStorefrontPresentationVersionPath('store-1', 'v1')).toBe(
      '/commerce/workspace/storefronts/store-1/presentation/versions/v1',
    );
    expect(commerceStorefrontPresentationVersionPath('store-1', 'v1')).not.toContain('store/v1');
    expect(commerceStorefrontPresentationVersionPath('store-1', 'v1')).not.toContain('tenant');
    expect(commerceStorefrontPresentationVersionSchedulePath('store-1', 'v1')).toBe(
      '/commerce/workspace/storefronts/store-1/presentation/versions/v1/schedule',
    );
  });

  it('lists versions and maps snake_case fields to camelCase', async () => {
    apiMock.mockResolvedValue({ data: [summary(), summary({ id: 'v2', state: 'published' })] });

    const result = await listPresentationVersions('store-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0]).toMatchObject({ id: 'v1', storefrontId: 'store-1', state: 'draft', revision: 1 });
      expect(result.data[1].state).toBe('published');
    }
    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts/store-1/presentation/versions');
  });

  it('creates a version with only name (+ optional source_version_id), never a client config', async () => {
    apiMock.mockResolvedValue(detailEnvelope());

    const result = await createPresentationVersion('store-1', 'رمضان 1448');

    expect(result.ok).toBe(true);
    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts/store-1/presentation/versions', {
      method: 'POST',
      body: { name: 'رمضان 1448' },
    });
    const body = apiMock.mock.calls[0][1].body as Record<string, unknown>;
    expect(Object.keys(body)).toEqual(['name']);
  });

  it('duplicates by passing source_version_id through the same create endpoint', async () => {
    apiMock.mockResolvedValue(detailEnvelope({ id: 'v2', name: 'نسخة من رمضان 1448' }));

    await createPresentationVersion('store-1', 'نسخة من رمضان 1448', 'v1');

    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts/store-1/presentation/versions', {
      method: 'POST',
      body: { name: 'نسخة من رمضان 1448', source_version_id: 'v1' },
    });
  });

  it('reads an exact version including its config', async () => {
    apiMock.mockResolvedValue(detailEnvelope());

    const result = await showPresentationVersion('store-1', 'v1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toBe('v1');
      expect(result.data.config.themePreset).toBe('navy');
    }
  });

  it('rejects a detail response whose config is missing instead of silently defaulting it (codex round 9)', async () => {
    apiMock.mockResolvedValue({ data: { ...summary() } }); // no `config` key at all

    const result = await showPresentationVersion('store-1', 'v1');

    expect(result).toEqual({ ok: false, reason: 'failed', message: 'invalid_payload' });
  });

  it('rejects a detail response whose config is not an object (codex round 9)', async () => {
    apiMock.mockResolvedValue({ data: { ...summary(), config: 'not-an-object' } });

    const result = await showPresentationVersion('store-1', 'v1');

    expect(result).toEqual({ ok: false, reason: 'failed', message: 'invalid_payload' });
  });

  it('classifies a 409 on read as unsupported_schema (forward-schema fail-closed)', async () => {
    apiMock.mockRejectedValue(new ApiError(409, 'النسخة بمخطط أمامي.', {}));

    const result = await showPresentationVersion('store-1', 'v1');

    expect(result).toEqual({ ok: false, reason: 'unsupported_schema', message: 'النسخة بمخطط أمامي.' });
  });

  it('rejects a row with a missing state instead of silently defaulting it to draft (codex round 10)', async () => {
    apiMock.mockResolvedValue({ data: [summary({ state: undefined })] });

    const result = await listPresentationVersions('store-1');

    expect(result).toEqual({ ok: false, reason: 'failed', message: 'invalid_payload' });
  });

  it('rejects a row with an unrecognized state instead of silently defaulting it to draft (codex round 10)', async () => {
    apiMock.mockResolvedValue(detailEnvelope({ state: 'archived' }));

    const result = await showPresentationVersion('store-1', 'v1');

    expect(result).toEqual({ ok: false, reason: 'failed', message: 'invalid_payload' });
  });

  it('saves with config + revision only', async () => {
    apiMock.mockResolvedValue(detailEnvelope({ revision: 2 }));

    const result = await savePresentationVersion('store-1', 'v1', CONFIG as never, 1);

    expect(result.ok).toBe(true);
    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts/store-1/presentation/versions/v1', {
      method: 'PUT',
      body: { config: CONFIG, revision: 1 },
    });
    const body = apiMock.mock.calls[0][1].body as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual(['config', 'revision']);
  });

  it('classifies a 409 on save as conflict so the editor offers a reload, not an overwrite', async () => {
    apiMock.mockRejectedValue(new ApiError(409, 'تم تعديل هذه النسخة من جلسة أخرى.', {}));

    const result = await savePresentationVersion('store-1', 'v1', CONFIG as never, 0);

    expect(result).toEqual({ ok: false, reason: 'conflict', message: 'تم تعديل هذه النسخة من جلسة أخرى.' });
  });

  it('renames with name + revision only', async () => {
    apiMock.mockResolvedValue(detailEnvelope({ name: 'اسم جديد', revision: 2 }));

    const result = await renamePresentationVersion('store-1', 'v1', 'اسم جديد', 1);

    expect(result.ok).toBe(true);
    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts/store-1/presentation/versions/v1', {
      method: 'PATCH',
      body: { name: 'اسم جديد', revision: 1 },
    });
  });

  it('deletes a version and reports lifecycle_conflict on 409', async () => {
    apiMock.mockResolvedValueOnce(null);
    const okResult = await deletePresentationVersion('store-1', 'v1');
    expect(okResult).toEqual({ ok: true });
    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts/store-1/presentation/versions/v1', {
      method: 'DELETE',
    });

    apiMock.mockRejectedValueOnce(new ApiError(409, 'لا يمكن حذف النسخة المنشورة حالياً.', {}));
    const conflictResult = await deletePresentationVersion('store-1', 'v1');
    expect(conflictResult).toEqual({
      ok: false,
      reason: 'lifecycle_conflict',
      message: 'لا يمكن حذف النسخة المنشورة حالياً.',
    });
  });

  it('maps a foreign/missing version to not_found without leaking existence details', async () => {
    apiMock.mockRejectedValue(new ApiError(404, 'النسخة غير موجودة.', {}));

    const result = await showPresentationVersion('store-1', 'foreign');

    expect(result).toEqual({ ok: false, reason: 'not_found', message: 'النسخة غير موجودة.' });
  });

  it('lists versions and maps published_revision, defaulting a missing/null value to null', async () => {
    apiMock.mockResolvedValue({
      data: [summary({ published_revision: 3 }), summary({ id: 'v2', published_revision: null })],
    });

    const result = await listPresentationVersions('store-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data[0].publishedRevision).toBe(3);
      expect(result.data[1].publishedRevision).toBeNull();
    }
  });

  it('rejects a row whose published_revision is present but not a number or null', async () => {
    apiMock.mockResolvedValue({ data: [summary({ published_revision: 'three' })] });

    const result = await listPresentationVersions('store-1');

    expect(result).toEqual({ ok: false, reason: 'failed', message: 'invalid_payload' });
  });

  it('publishes a version with revision + publication-head expectations only, never a client config', async () => {
    apiMock.mockResolvedValue({ data: { ...summary({ state: 'published', published_revision: 2 }), config: CONFIG } });

    const result = await publishPresentationVersion('store-1', 'v1', 1, 1, 'v0');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.state).toBe('published');
      expect(result.data.publishedRevision).toBe(2);
    }
    expect(commerceStorefrontPresentationVersionPublishPath('store-1', 'v1')).toBe(
      '/commerce/workspace/storefronts/store-1/presentation/versions/v1/publish',
    );
    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts/store-1/presentation/versions/v1/publish', {
      method: 'POST',
      body: { revision: 1, expected_published_revision: 1, expected_active_version_id: 'v0' },
    });
    const [, options] = apiMock.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(Object.keys(options.body).sort()).toEqual([
      'expected_active_version_id',
      'expected_published_revision',
      'revision',
    ]);
  });

  it('sends explicit null publication-head expectations for a never-published storefront', async () => {
    apiMock.mockResolvedValue(detailEnvelope({ state: 'published', published_revision: 1 }));

    await publishPresentationVersion('store-1', 'v1', 1, null, null);

    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts/store-1/presentation/versions/v1/publish', {
      method: 'POST',
      body: { revision: 1, expected_published_revision: null, expected_active_version_id: null },
    });
  });

  it('carries the publish-gate path ⇒ code map from a 422 (CUST-HV V3), and nothing from other statuses', async () => {
    const body = {
      code: 'publish_validation_failed',
      error_codes: { 'announcements.items[0].window.endsAt': 'window_end_not_after_start', bad: 7 },
    };
    apiMock.mockRejectedValueOnce(new ApiError(422, 'تعذّر نشر التصميم', body));
    expect(await publishPresentationVersion('store-1', 'v1', 1, null, null)).toEqual({
      ok: false,
      reason: 'validation',
      message: 'تعذّر نشر التصميم',
      issues: { 'announcements.items[0].window.endsAt': 'window_end_not_after_start' },
    });

    apiMock.mockRejectedValueOnce(new ApiError(422, 'x', { error_codes: ['a'] }));
    const plain = await publishPresentationVersion('store-1', 'v1', 1, null, null);
    expect(plain).toEqual({ ok: false, reason: 'validation', message: 'x' });
  });

  it('classifies publish 409s by the server message: forward-schema, scheduled, and stale', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(409, 'إصدار المستند أحدث مما يدعمه الخادم الحالي.', {}));
    expect(await publishPresentationVersion('store-1', 'v1', 1, null, null)).toEqual({
      ok: false,
      reason: 'unsupported_schema',
      message: 'إصدار المستند أحدث مما يدعمه الخادم الحالي.',
    });

    apiMock.mockRejectedValueOnce(
      new ApiError(409, 'هذه النسخة مجدولة للنشر لاحقاً. ألغِ الجدولة أولاً قبل النشر الفوري.', {}),
    );
    expect(await publishPresentationVersion('store-1', 'v1', 1, null, null)).toEqual({
      ok: false,
      reason: 'scheduled_conflict',
      message: 'هذه النسخة مجدولة للنشر لاحقاً. ألغِ الجدولة أولاً قبل النشر الفوري.',
    });

    apiMock.mockRejectedValueOnce(new ApiError(409, 'النسخة تغيّرت. أعد التحميل ثم احفظ من جديد.', {}));
    expect(await publishPresentationVersion('store-1', 'v1', 1, null, null)).toEqual({
      ok: false,
      reason: 'stale',
      message: 'النسخة تغيّرت. أعد التحميل ثم احفظ من جديد.',
    });

    apiMock.mockRejectedValueOnce(
      new ApiError(409, 'حالة النشر تغيّرت منذ آخر مراجعة. أعد تحميل حالة المتجر الحالية قبل النشر من جديد.', {}),
    );
    expect(await publishPresentationVersion('store-1', 'v1', 1, null, null)).toEqual({
      ok: false,
      reason: 'stale',
      message: 'حالة النشر تغيّرت منذ آخر مراجعة. أعد تحميل حالة المتجر الحالية قبل النشر من جديد.',
    });
  });

  it('classifies non-409 publish failures the same way as other version endpoints', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(404, 'النسخة غير موجودة.', {}));
    const notFound = await publishPresentationVersion('store-1', 'v1', 1, null, null);
    expect(notFound.ok).toBe(false);
    if (!notFound.ok) expect(notFound.reason).toBe('not_found');

    apiMock.mockRejectedValueOnce(new ApiError(403, 'ممنوع.', {}));
    const forbidden = await publishPresentationVersion('store-1', 'v1', 1, null, null);
    expect(forbidden.ok).toBe(false);
    if (!forbidden.ok) expect(forbidden.reason).toBe('forbidden');

    apiMock.mockRejectedValueOnce(new ApiError(422, 'غير صالح.', {}));
    const validation = await publishPresentationVersion('store-1', 'v1', 1, null, null);
    expect(validation.ok).toBe(false);
    if (!validation.ok) expect(validation.reason).toBe('validation');
  });

  it('lists versions and maps the schedule token + scheduling runtime gate', async () => {
    apiMock.mockResolvedValue({
      data: [summary({ schedule_token: 'tok-a', scheduling_runtime_active: false })],
    });
    const result = await listPresentationVersions('store-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data[0].scheduleToken).toBe('tok-a');
      expect(result.data[0].schedulingRuntimeActive).toBe(false);
    }
  });

  it('rejects a row whose schedule_token is missing or empty instead of sending a fabricated authority later', async () => {
    apiMock.mockResolvedValueOnce({ data: [summary({ schedule_token: undefined })] });
    expect((await listPresentationVersions('store-1')).ok).toBe(false);
    apiMock.mockResolvedValueOnce({ data: [summary({ schedule_token: '' })] });
    expect((await listPresentationVersions('store-1')).ok).toBe(false);
  });

  it('defaults scheduling_runtime_active to false (the restrictive value) rather than rejecting the row, for a missing/wrong-typed value', async () => {
    apiMock.mockResolvedValueOnce({ data: [summary({ scheduling_runtime_active: undefined })] });
    const missing = await listPresentationVersions('store-1');
    expect(missing.ok).toBe(true);
    if (missing.ok) expect(missing.data[0].schedulingRuntimeActive).toBe(false);

    apiMock.mockResolvedValueOnce({ data: [summary({ scheduling_runtime_active: 'yes' })] });
    const wrongType = await listPresentationVersions('store-1');
    expect(wrongType.ok).toBe(true);
    if (wrongType.ok) expect(wrongType.data[0].schedulingRuntimeActive).toBe(false);
  });

  it('schedules a version with revision + explicit-offset time + the current schedule token, never a client config', async () => {
    apiMock.mockResolvedValueOnce(
      detailEnvelope({ state: 'scheduled', scheduled_for: '2026-12-01T18:00:00.000Z' }),
    );
    const result = await schedulePresentationVersion(
      'store-1',
      'v1',
      3,
      '2026-12-01T21:00:00+03:00',
      'tok-current',
    );
    expect(result.ok).toBe(true);
    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts/store-1/presentation/versions/v1/schedule', {
      method: 'PUT',
      body: { revision: 3, scheduled_for: '2026-12-01T21:00:00+03:00', expected_schedule_token: 'tok-current' },
    });
  });

  it('classifies schedule 409s by the server message: stale token, active conflict, and stale revision (default)', async () => {
    apiMock.mockRejectedValueOnce(
      new ApiError(409, 'حالة الجدولة تغيّرت منذ آخر مراجعة. أعد تحميل حالة المتجر الحالية ثم أعد المحاولة.', {}),
    );
    const staleToken = await schedulePresentationVersion('store-1', 'v1', 1, '2026-12-01T00:00:00Z', 'tok');
    expect(staleToken).toEqual({
      ok: false,
      reason: 'stale_token',
      message: 'حالة الجدولة تغيّرت منذ آخر مراجعة. أعد تحميل حالة المتجر الحالية ثم أعد المحاولة.',
    });

    apiMock.mockRejectedValueOnce(
      new ApiError(409, 'لا يمكن جدولة النسخة المنشورة حالياً. أنشئ نسخة مسودة للتعديل.', {}),
    );
    const activeConflict = await schedulePresentationVersion('store-1', 'v1', 1, '2026-12-01T00:00:00Z', 'tok');
    expect(activeConflict).toEqual({
      ok: false,
      reason: 'active_conflict',
      message: 'لا يمكن جدولة النسخة المنشورة حالياً. أنشئ نسخة مسودة للتعديل.',
    });

    apiMock.mockRejectedValueOnce(new ApiError(409, 'النسخة تغيّرت. أعد التحميل ثم احفظ من جديد.', {}));
    const staleRevision = await schedulePresentationVersion('store-1', 'v1', 1, '2026-12-01T00:00:00Z', 'tok');
    expect(staleRevision).toEqual({
      ok: false,
      reason: 'stale_revision',
      message: 'النسخة تغيّرت. أعد التحميل ثم احفظ من جديد.',
    });
  });

  it('classifies a 422 (past/malformed scheduled_for) as validation', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(422, 'وقت الجدولة يجب أن يكون في المستقبل.', {}));
    const result = await schedulePresentationVersion('store-1', 'v1', 1, '2020-01-01T00:00:00Z', 'tok');
    expect(result).toEqual({ ok: false, reason: 'validation', message: 'وقت الجدولة يجب أن يكون في المستقبل.' });
  });

  it('cancels a schedule with only the current schedule token, via DELETE-with-JSON-body', async () => {
    apiMock.mockResolvedValueOnce(detailEnvelope({ state: 'draft', scheduled_for: null }));
    const result = await cancelPresentationVersionSchedule('store-1', 'v1', 'tok-current');
    expect(result.ok).toBe(true);
    expect(apiMock).toHaveBeenCalledWith('/commerce/workspace/storefronts/store-1/presentation/versions/v1/schedule', {
      method: 'DELETE',
      body: { expected_schedule_token: 'tok-current' },
    });
  });

  it('classifies cancel-schedule 409s: stale token vs. not-scheduled (default)', async () => {
    apiMock.mockRejectedValueOnce(
      new ApiError(409, 'حالة الجدولة تغيّرت منذ آخر مراجعة. أعد تحميل حالة المتجر الحالية ثم أعد المحاولة.', {}),
    );
    const staleToken = await cancelPresentationVersionSchedule('store-1', 'v1', 'tok');
    expect(staleToken).toEqual({
      ok: false,
      reason: 'stale_token',
      message: 'حالة الجدولة تغيّرت منذ آخر مراجعة. أعد تحميل حالة المتجر الحالية ثم أعد المحاولة.',
    });

    apiMock.mockRejectedValueOnce(new ApiError(409, 'هذه النسخة ليست مجدولة حالياً.', {}));
    const notScheduled = await cancelPresentationVersionSchedule('store-1', 'v1', 'tok');
    expect(notScheduled).toEqual({
      ok: false,
      reason: 'not_scheduled',
      message: 'هذه النسخة ليست مجدولة حالياً.',
    });
  });

  it('never sends a tenant_id in any request body', async () => {
    apiMock.mockResolvedValue(detailEnvelope());
    await createPresentationVersion('store-1', 'name');
    await savePresentationVersion('store-1', 'v1', CONFIG as never, 1);
    await renamePresentationVersion('store-1', 'v1', 'name', 1);
    await publishPresentationVersion('store-1', 'v1', 1, 1, 'v0');
    await schedulePresentationVersion('store-1', 'v1', 1, '2026-12-01T00:00:00Z', 'tok');
    await cancelPresentationVersionSchedule('store-1', 'v1', 'tok');
    for (const call of apiMock.mock.calls) {
      expect(JSON.stringify(call)).not.toContain('tenant_id');
    }
  });
});
