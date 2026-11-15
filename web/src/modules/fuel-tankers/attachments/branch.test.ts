import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ api: vi.fn(), fetchPrivateFileUrl: vi.fn(), downloadFile: vi.fn() }));
vi.mock('@/lib/api', async (original) => ({ ...(await original<typeof import('@/lib/api')>()), api: mocks.api, fetchPrivateFileUrl: mocks.fetchPrivateFileUrl, downloadFile: mocks.downloadFile }));

import { downloadAttachment, listAttachments, previewUrl, removeAttachment, replaceAttachment, uploadAttachment } from './client';

const FILL = '00000000-0000-4000-8000-000000000001';
const ATT = '00000000-0000-4000-8000-000000000002';
const list = { data: [], meta: { policy: {}, status: 'ok' } };

beforeEach(() => { vi.clearAllMocks(); mocks.api.mockResolvedValue(list); });

describe('attachments requests carry an explicit station branch (cross-branch station selection)', () => {
  it('list / upload / replace / remove send X-Branch-Id when a branch is given', async () => {
    const file = new File(['x'], 'a.jpg', { type: 'image/jpeg' });
    await listAttachments(FILL, false, 'branch-b').catch(() => undefined);
    await uploadAttachment(FILL, file, 'branch-b').catch(() => undefined);
    await replaceAttachment(FILL, ATT, file, 'branch-b').catch(() => undefined);
    await removeAttachment(FILL, ATT, 'سبب', 'branch-b').catch(() => undefined);
    expect(mocks.api).toHaveBeenCalledTimes(4);
    for (const call of mocks.api.mock.calls) expect((call[1] as { headers?: Record<string, string> }).headers).toEqual({ 'X-Branch-Id': 'branch-b' });
  });

  it('without a branch the requests are exactly as before (no headers override)', async () => {
    await listAttachments(FILL).catch(() => undefined);
    expect((mocks.api.mock.calls[0][1] as { headers?: unknown } | undefined)?.headers).toBeUndefined();
  });

  it('preview and download pass the branch to the private-file helpers (and nothing extra without it)', async () => {
    await previewUrl(FILL, ATT, 'image/jpeg', 'branch-b');
    await downloadAttachment(FILL, ATT, 'a.jpg', 'branch-b');
    expect(mocks.fetchPrivateFileUrl.mock.calls[0][2]).toEqual({ branchId: 'branch-b' });
    expect(mocks.downloadFile.mock.calls[0][2]).toEqual({ branchId: 'branch-b' });
    await previewUrl(FILL, ATT, 'image/jpeg');
    await downloadAttachment(FILL, ATT, 'a.jpg');
    expect(mocks.fetchPrivateFileUrl.mock.calls[1][2]).toEqual({});
    expect(mocks.downloadFile.mock.calls[1][2]).toEqual({});
  });
});
