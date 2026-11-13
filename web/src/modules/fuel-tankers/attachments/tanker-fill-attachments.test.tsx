// @vitest-environment jsdom
import * as React from 'react';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderIntl, TEST_MESSAGES } from '@/test-utils/intl';
import { SAFE_POLICY, type AttachmentState, type FillAttachment } from './logic';

const FILL = '00000000-0000-4000-8000-0000000000f1';
const toast = vi.hoisted(() => vi.fn());
const api = vi.hoisted(() => ({
  list: vi.fn(), upload: vi.fn(), remove: vi.fn(), replace: vi.fn(), preview: vi.fn(), download: vi.fn(),
}));

vi.mock('@/components/ui/toast', () => ({ useToast: () => ({ success: toast, error: vi.fn() }) }));
vi.mock('./client', () => ({
  listAttachments: api.list, uploadAttachment: api.upload, removeAttachment: api.remove, replaceAttachment: api.replace, previewUrl: api.preview, downloadAttachment: api.download,
}));

import { TankerFillAttachments } from './tanker-fill-attachments';
import { ApiError } from '@/lib/api';

const row = (over: Partial<FillAttachment> = {}): FillAttachment => ({
  id: '00000000-0000-4000-8000-0000000000a1', fuel_tanker_fill_id: FILL, fill_number: 'FTF-2027-00001', voucher_number: '04052', original_name: 'voucher.jpg', mime_type: 'image/jpeg', kind: 'image',
  size: 250_000, status: 'active', uploaded_by: 'u1', uploaded_by_name: 'سعد', uploaded_at: '2027-01-26T09:30:00+03:00', replaces_attachment_id: null, replaced_by_attachment_id: null,
  removed_by_name: null, removed_at: null, removal_reason: null, ...over,
});
const stateOf = (over: Partial<AttachmentState> = {}): AttachmentState => ({
  policy: { ...SAFE_POLICY, max_bytes: 2 * 1024 * 1024, max_count: 3 }, active_count: 0, status: 'none', can_add: true, add_blocked_reason: null, can_remove: true, remove_blocked_reason: null, can_view_history: false, ...over,
});
const T = (locale: 'ar' | 'en') => TEST_MESSAGES[locale].fuelTankers.attachments;
/** ينتظر ظهور العنصر فعلاً (`waitFor` بلا رمي لا ينتظر شيئاً). */
const until = async (selector: string): Promise<HTMLElement> => {
  await waitFor(() => expect(document.querySelector(selector)).not.toBeNull());
  return document.querySelector(selector) as HTMLElement;
};
const image = (name = 'photo.jpg', size = 1000) => new File([new Uint8Array(size)], name, { type: 'image/jpeg' });

beforeEach(() => {
  Object.values(api).forEach((fn) => fn.mockReset());
  api.preview.mockResolvedValue('blob:preview');
  api.list.mockResolvedValue({ rows: [], state: stateOf() });
  (URL as unknown as { revokeObjectURL: () => void }).revokeObjectURL = vi.fn();
});
afterEach(() => { cleanup(); toast.mockReset(); });

describe.each(['ar', 'en'] as const)('TankerFillAttachments (%s)', (locale) => {
  const text = T(locale);
  const mount = (props: Partial<React.ComponentProps<typeof TankerFillAttachments>> = {}) => renderIntl(<TankerFillAttachments fillId={FILL} {...props} />, locale);

  it('shows the empty state with camera and file buttons, the policy and the status', async () => {
    mount();
    expect(await screen.findByRole('heading', { name: text.title })).toBeTruthy();
    expect(screen.getByText(text.empty)).toBeTruthy();
    expect(screen.getByText(text.status.none)).toBeTruthy();
    expect(screen.getByRole('button', { name: text.takePhoto })).toBeTruthy();
    expect(screen.getByRole('button', { name: text.chooseFile })).toBeTruthy();
    // كاميرا الآيفون الخلفية؛ الصور تُحصر في JPEG/PNG (يحوّل iOS HEIC) ويقبل الاختيار PDF أيضاً.
    const cam = document.querySelector('[data-camera-input]') as HTMLInputElement;
    expect(cam.getAttribute('capture')).toBe('environment');
    expect(cam.accept).toBe('image/jpeg,image/png');
    expect((document.querySelector('[data-file-input]') as HTMLInputElement).accept).toContain('application/pdf');
  });

  it('lists active attachments with a private thumbnail and a PDF icon, and reports the count', async () => {
    const onCount = vi.fn();
    api.list.mockResolvedValue({
      rows: [row(), row({ id: '00000000-0000-4000-8000-0000000000a2', original_name: 'scan.pdf', mime_type: 'application/pdf', kind: 'pdf' })],
      state: stateOf({ active_count: 2, status: 'present' }),
    });
    mount({ onCountChange: onCount });
    expect(await screen.findByRole('button', { name: text.openNamed.replace('{name}', 'voucher.jpg') })).toBeTruthy();
    await waitFor(() => expect(document.querySelector('[data-attachment-list] img')).not.toBeNull());
    expect(api.preview).toHaveBeenCalledWith(FILL, '00000000-0000-4000-8000-0000000000a1', 'image/jpeg');
    expect(api.preview).not.toHaveBeenCalledWith(FILL, '00000000-0000-4000-8000-0000000000a2', expect.anything());
    expect(onCount).toHaveBeenLastCalledWith(2);
    expect(document.querySelector('[data-attachment-status="present"]')).not.toBeNull();
  });

  it('hides the pickers when the server says adding is blocked and explains why (no guessing)', async () => {
    api.list.mockResolvedValue({ rows: [], state: stateOf({ can_add: false, add_blocked_reason: 'shift_closed' }) });
    mount();
    await screen.findByRole('heading', { name: text.title });
    expect(screen.queryByRole('button', { name: text.takePhoto })).toBeNull();
    expect(screen.getByText(text.blocked.add.shift_closed)).toBeTruthy();
    api.list.mockResolvedValue({ rows: [], state: stateOf({ can_add: false, add_blocked_reason: null }) });
    cleanup();
    mount();
    await screen.findByRole('heading', { name: text.title });
    expect(screen.queryByRole('button', { name: text.takePhoto })).toBeNull();
  });

  it('flags a required photo as missing without blocking anything', async () => {
    api.list.mockResolvedValue({ rows: [], state: stateOf({ status: 'missing', policy: { ...SAFE_POLICY, required: true } }) });
    mount();
    await screen.findByRole('heading', { name: text.title });
    expect(document.querySelector('[data-attachment-status="missing"]')).not.toBeNull();
    expect(screen.getByText(text.missingNote)).toBeTruthy();
    expect((screen.getByRole('button', { name: text.takePhoto }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('uploads a picked photo once, shows progress while it runs, then refreshes the list from the server', async () => {
    let finish!: (value: unknown) => void;
    api.upload.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    mount();
    await screen.findByRole('heading', { name: text.title });
    fireEvent.change(document.querySelector('[data-camera-input]')!, { target: { files: [image('captured.jpg')] } });
    expect(await screen.findByRole('progressbar', { name: text.uploading.replace('{name}', 'captured.jpg') })).toBeTruthy();
    // الأزرار معطّلة أثناء الرفع فلا إرسال مكرر.
    expect((screen.getByRole('button', { name: text.takePhoto }) as HTMLButtonElement).disabled).toBe(true);
    expect(api.upload).toHaveBeenCalledTimes(1);
    expect(api.upload).toHaveBeenCalledWith(FILL, expect.objectContaining({ name: 'captured.jpg' }));
    finish({ rows: [row({ original_name: 'captured.jpg' })], state: stateOf({ active_count: 1, status: 'present' }) });
    await waitFor(() => expect(document.querySelector('[data-upload-queue]')).toBeNull());
    expect(await screen.findByRole('button', { name: text.openNamed.replace('{name}', 'captured.jpg') })).toBeTruthy();
    expect(api.upload).toHaveBeenCalledTimes(1);
  });

  it('keeps a failed upload with a clear reason, retries it explicitly, and never retries on its own', async () => {
    api.upload.mockRejectedValueOnce(new ApiError(422, 'x', { reason: 'attachment_storage_failed' }));
    api.upload.mockResolvedValueOnce({ rows: [row()], state: stateOf({ active_count: 1, status: 'present' }) });
    mount();
    await screen.findByRole('heading', { name: text.title });
    fireEvent.change(document.querySelector('[data-file-input]')!, { target: { files: [image('a.jpg')] } });
    expect(await screen.findByText(text.errors.attachment_storage_failed)).toBeTruthy();
    expect(api.upload).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: text.retry }));
    await waitFor(() => expect(api.upload).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(document.querySelector('[data-upload-queue]')).toBeNull());
  });

  it('shows an offline message for a network failure and lets the user dismiss the file', async () => {
    api.upload.mockRejectedValue(new ApiError(0, 'network', null));
    mount();
    await screen.findByRole('heading', { name: text.title });
    fireEvent.change(document.querySelector('[data-file-input]')!, { target: { files: [image('a.jpg')] } });
    expect(await screen.findByText(text.errors.offline)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: text.dismiss }));
    expect(document.querySelector('[data-upload-queue]')).toBeNull();
  });

  it('rejects an unsupported or oversized file locally with the reason and never calls the server', async () => {
    mount();
    await screen.findByRole('heading', { name: text.title });
    fireEvent.change(document.querySelector('[data-file-input]')!, { target: { files: [new File(['x'], 'run.exe', { type: 'application/x-msdownload' }), image('huge.jpg', 3 * 1024 * 1024)] } });
    expect(await screen.findByText(text.rejected.type.replace('{name}', 'run.exe'))).toBeTruthy();
    expect(screen.getByText(text.rejected.size.replace('{name}', 'huge.jpg').replace('{mb}', '2'))).toBeTruthy();
    expect(api.upload).not.toHaveBeenCalled();
  });

  it('opens a viewer with the FTF number, the paper voucher, who uploaded it, zoom and download', async () => {
    api.list.mockResolvedValue({ rows: [row()], state: stateOf({ active_count: 1, status: 'present', can_remove: false, remove_blocked_reason: 'shift_closed' }) });
    api.download.mockResolvedValue('downloaded');
    mount();
    fireEvent.click(await screen.findByRole('button', { name: text.openNamed.replace('{name}', 'voucher.jpg') }));
    const viewer = await until('[data-attachment-viewer]');
    expect(within(viewer).getByText('FTF-2027-00001')).toBeTruthy();
    expect(viewer.textContent).toContain('04052');
    expect(viewer.textContent).toContain('سعد');
    fireEvent.click(within(viewer).getByRole('button', { name: text.zoomIn }));
    await waitFor(() => expect(viewer.querySelector('img')?.getAttribute('data-zoom')).toBe('1.5'));
    fireEvent.click(within(viewer).getByRole('button', { name: text.fit }));
    await waitFor(() => expect(viewer.querySelector('img')?.getAttribute('data-zoom')).toBe('1'));
    fireEvent.click(within(viewer).getByRole('button', { name: text.download }));
    await waitFor(() => expect(api.download).toHaveBeenCalledWith(FILL, '00000000-0000-4000-8000-0000000000a1', 'voucher.jpg'));
    // الإدارة محجوبة بقرار الخادم: لا إزالة ولا استبدال، والسبب ظاهر.
    expect(within(viewer).queryByRole('button', { name: text.removeAction })).toBeNull();
    expect(viewer.querySelector('[data-remove-blocked="shift_closed"]')).not.toBeNull();
  });

  it('removes with a mandatory reason, keeps the voucher untouched and refreshes the state', async () => {
    api.list.mockResolvedValue({ rows: [row()], state: stateOf({ active_count: 1, status: 'present' }) });
    api.remove.mockResolvedValue({ row: row({ status: 'removed' }), state: stateOf({ active_count: 0, status: 'none' }) });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: text.openNamed.replace('{name}', 'voucher.jpg') }));
    fireEvent.click(await screen.findByRole('button', { name: text.removeAction }));
    const form = await until('[data-remove-form]');
    const confirm = within(form).getByRole('button', { name: text.remove.confirm }) as HTMLButtonElement;
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(form).getByRole('textbox'), { target: { value: 'ab' } });
    expect(confirm.disabled).toBe(true);
    fireEvent.change(within(form).getByRole('textbox'), { target: { value: 'صورة غير واضحة' } });
    expect(confirm.disabled).toBe(false);
    api.list.mockResolvedValue({ rows: [], state: stateOf() });
    fireEvent.click(confirm);
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith(FILL, '00000000-0000-4000-8000-0000000000a1', 'صورة غير واضحة'));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(text.removed));
    await waitFor(() => expect(screen.queryByRole('button', { name: text.openNamed.replace('{name}', 'voucher.jpg') })).toBeNull());
  });

  it('shows a server refusal on removal inside the dialog and keeps it open', async () => {
    api.list.mockResolvedValue({ rows: [row()], state: stateOf({ active_count: 1, status: 'present' }) });
    api.remove.mockRejectedValue(new ApiError(422, 'x', { reason: 'attachment_removal_blocked' }));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: text.openNamed.replace('{name}', 'voucher.jpg') }));
    fireEvent.click(await screen.findByRole('button', { name: text.removeAction }));
    const form = await until('[data-remove-form]');
    fireEvent.change(within(form).getByRole('textbox'), { target: { value: 'سبب كافٍ' } });
    fireEvent.click(within(form).getByRole('button', { name: text.remove.confirm }));
    expect(await within(form).findByText(text.errors.attachment_removal_blocked)).toBeTruthy();
    expect(document.querySelector('[data-remove-form]')).not.toBeNull();
  });

  it('replaces an attachment through the file chooser and refreshes', async () => {
    api.list.mockResolvedValue({ rows: [row()], state: stateOf({ active_count: 1, status: 'present' }) });
    api.replace.mockResolvedValue({ row: row({ id: '00000000-0000-4000-8000-0000000000a9' }), state: stateOf({ active_count: 1, status: 'present' }) });
    mount();
    fireEvent.click(await screen.findByRole('button', { name: text.openNamed.replace('{name}', 'voucher.jpg') }));
    fireEvent.click(await screen.findByRole('button', { name: text.replaceAction }));
    expect(await screen.findByText(text.replace.keepNote)).toBeTruthy();
    fireEvent.change(document.querySelector('[data-replace-input]')!, { target: { files: [image('new.jpg')] } });
    await waitFor(() => expect(api.replace).toHaveBeenCalledWith(FILL, '00000000-0000-4000-8000-0000000000a1', expect.objectContaining({ name: 'new.jpg' })));
    await waitFor(() => expect(toast).toHaveBeenCalledWith(text.replaced));
  });

  it('offers the history only to those who can remove and shows who removed what and why', async () => {
    api.list.mockImplementation(async (_fill: string, history?: boolean) => ({
      rows: history ? [row(), row({ id: '00000000-0000-4000-8000-0000000000b1', original_name: 'old.jpg', status: 'removed', removed_by_name: 'منى', removed_at: '2027-01-26T10:00:00+03:00', removal_reason: 'صورة مكررة' })] : [row()],
      state: stateOf({ active_count: 1, status: 'present', can_view_history: true }),
    }));
    mount();
    fireEvent.click(await screen.findByRole('button', { name: text.showHistory }));
    const history = await until('[data-attachment-history]');
    expect(history.textContent).toContain('old.jpg');
    expect(history.textContent).toContain('منى');
    expect(history.textContent).toContain('صورة مكررة');
    expect(api.list).toHaveBeenLastCalledWith(FILL, true);
    cleanup();
    api.list.mockResolvedValue({ rows: [row()], state: stateOf({ can_view_history: false }) });
    mount();
    await screen.findByRole('heading', { name: text.title });
    expect(screen.queryByRole('button', { name: text.showHistory })).toBeNull();
  });

  it('degrades gracefully: unavailable for 404, retryable for other failures', async () => {
    api.list.mockRejectedValue(new ApiError(404, 'x', null));
    mount();
    expect(await screen.findByText(text.unavailable)).toBeTruthy();
    cleanup();
    api.list.mockRejectedValueOnce(new ApiError(500, 'x', null));
    api.list.mockResolvedValueOnce({ rows: [], state: stateOf() });
    mount();
    expect(await screen.findByText(text.loadFailed)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: text.retry }));
    expect(await screen.findByRole('heading', { name: text.title })).toBeTruthy();
  });
});
