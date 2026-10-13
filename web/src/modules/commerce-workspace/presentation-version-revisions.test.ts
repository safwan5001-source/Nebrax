import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';

const apiMock = vi.fn();
vi.mock('@/lib/api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/api')>('@/lib/api');
  return { ...actual, api: (...args: unknown[]) => apiMock(...args) };
});

import {
  commerceStorefrontPresentationVersionRevisionsPath,
  createPresentationVersion,
  listPresentationVersionRevisions,
  showPresentationVersionRevision,
} from './presentation-versions';

afterEach(() => apiMock.mockReset());

const CONFIG = { version: 1, themePreset: 'navy', primaryColor: '#1e3a5f', homepage: { heroHeadline: 'مرحبا' } };

function revision(overrides: Record<string, unknown> = {}) {
  return {
    id: 'r1',
    version_id: 'v1',
    version_revision: 3,
    schema_version: 3,
    size_bytes: 1522,
    created_at: '2026-10-12T10:00:00.000Z',
    is_current: false,
    ...overrides,
  };
}

function versionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'v2',
    storefront_id: 'store-1',
    name: 'من لقطة',
    state: 'draft',
    schema_version: 3,
    revision: 1,
    scheduled_for: null,
    last_published_at: null,
    created_at: '2026-10-12T10:00:00.000Z',
    updated_at: '2026-10-12T10:00:00.000Z',
    schedule_token: 'opaque',
    scheduling_runtime_active: true,
    ...overrides,
  };
}

describe('presentation version revisions client (CUST-H5-3/4)', () => {
  it('builds the read-only revisions path under the exact Version', () => {
    expect(commerceStorefrontPresentationVersionRevisionsPath('s1', 'v1')).toMatch(/\/s1\/presentation\/versions\/v1\/revisions$/);
  });

  it('lists snapshots as camelCase metadata and keeps the server order', async () => {
    apiMock.mockResolvedValueOnce({ data: [revision({ id: 'r2', version_revision: 4, is_current: true }), revision()] });

    const result = await listPresentationVersionRevisions('s1', 'v1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.map((r) => [r.id, r.versionRevision, r.isCurrent])).toEqual([
      ['r2', 4, true],
      ['r1', 3, false],
    ]);
    expect(result.data[0]).not.toHaveProperty('config');
    expect(apiMock.mock.calls[0][0]).toMatch(/\/versions\/v1\/revisions$/);
  });

  it('fails closed on a malformed list instead of showing a partial history', async () => {
    apiMock.mockResolvedValueOnce({ data: [revision(), { id: '' }] });
    expect(await listPresentationVersionRevisions('s1', 'v1')).toMatchObject({ ok: false, reason: 'failed' });
    apiMock.mockResolvedValueOnce({ nope: true });
    expect(await listPresentationVersionRevisions('s1', 'v1')).toMatchObject({ ok: false, reason: 'failed' });
  });

  it('classifies list failures (403 / 404 / other)', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(403, 'x', {}));
    expect(await listPresentationVersionRevisions('s1', 'v1')).toMatchObject({ ok: false, reason: 'forbidden' });
    apiMock.mockRejectedValueOnce(new ApiError(404, 'x', {}));
    expect(await listPresentationVersionRevisions('s1', 'v1')).toMatchObject({ ok: false, reason: 'not_found' });
    apiMock.mockRejectedValueOnce(new ApiError(500, 'x', {}));
    expect(await listPresentationVersionRevisions('s1', 'v1')).toMatchObject({ ok: false, reason: 'failed' });
  });

  it('reads one snapshot with its normalized document and current media issues', async () => {
    apiMock.mockResolvedValueOnce({
      data: {
        ...revision(),
        config: CONFIG,
        media_issues: [{ path: 'branding.logoMedia.mediaId', code: 'media_missing', message: 'x' }],
      },
    });

    const result = await showPresentationVersionRevision('s1', 'v1', 'r1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.config.themePreset).toBe('navy');
    expect(result.data.mediaIssues).toEqual([{ path: 'branding.logoMedia.mediaId', code: 'media_missing', message: 'x' }]);
    expect(apiMock.mock.calls[0][0]).toMatch(/\/versions\/v1\/revisions\/r1$/);
    expect(apiMock.mock.calls[0][1]).toBeUndefined(); // a plain GET — never a write
  });

  it('an empty media_issues list is "healthy"; a MISSING field fails closed', async () => {
    apiMock.mockResolvedValueOnce({ data: { ...revision(), config: CONFIG, media_issues: [] } });
    const healthy = await showPresentationVersionRevision('s1', 'v1', 'r1');
    expect(healthy.ok && healthy.data.mediaIssues).toEqual([]);

    apiMock.mockResolvedValueOnce({ data: { ...revision(), config: CONFIG } });
    expect(await showPresentationVersionRevision('s1', 'v1', 'r1')).toMatchObject({ ok: false, reason: 'failed' });
    apiMock.mockResolvedValueOnce({ data: { ...revision(), config: CONFIG, media_issues: 'none' } });
    expect(await showPresentationVersionRevision('s1', 'v1', 'r1')).toMatchObject({ ok: false, reason: 'failed' });
  });

  it('a snapshot without a document is invalid', async () => {
    apiMock.mockResolvedValueOnce({ data: { ...revision(), media_issues: [] } });
    expect(await showPresentationVersionRevision('s1', 'v1', 'r1')).toMatchObject({ ok: false, reason: 'failed' });
  });

  it('classifies snapshot read failures: 409 → unsupported_schema, 404, 403', async () => {
    apiMock.mockRejectedValueOnce(new ApiError(409, 'x', {}));
    expect(await showPresentationVersionRevision('s1', 'v1', 'r1')).toMatchObject({ ok: false, reason: 'unsupported_schema' });
    apiMock.mockRejectedValueOnce(new ApiError(404, 'x', {}));
    expect(await showPresentationVersionRevision('s1', 'v1', 'r1')).toMatchObject({ ok: false, reason: 'not_found' });
    apiMock.mockRejectedValueOnce(new ApiError(403, 'x', {}));
    expect(await showPresentationVersionRevision('s1', 'v1', 'r1')).toMatchObject({ ok: false, reason: 'forbidden' });
  });

  it('creates a Draft from a snapshot: sends source_version_id + source_revision_id, never a document or tenant', async () => {
    apiMock.mockResolvedValueOnce({
      data: { ...versionRow(), config: CONFIG, media_issues: [{ path: 'a', code: 'media_missing', message: '' }] },
    });

    const result = await createPresentationVersion('s1', 'من لقطة', 'v1', 'r1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.mediaIssues).toEqual([{ path: 'a', code: 'media_missing', message: '' }]);
    const [, options] = apiMock.mock.calls[0];
    expect(options).toEqual({ method: 'POST', body: { name: 'من لقطة', source_version_id: 'v1', source_revision_id: 'r1' } });
    expect(JSON.stringify(options.body)).not.toMatch(/tenant|config/);
  });

  it('an ordinary duplicate still sends no revision, and a plain create gets no mediaIssues', async () => {
    apiMock.mockResolvedValueOnce({ data: { ...versionRow(), config: CONFIG } });

    const result = await createPresentationVersion('s1', 'نسخة', 'v1');

    expect(apiMock.mock.calls[0][1]).toEqual({ method: 'POST', body: { name: 'نسخة', source_version_id: 'v1' } });
    expect(result.ok && result.data.mediaIssues).toBeUndefined();
  });
});
