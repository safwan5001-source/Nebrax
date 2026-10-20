// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ExecutionImagesList, ImageArchiveCard, PreviewImagesCell } from './product-images-ui';
import type { ExecutionImage, PreviewImages, PreviewImageItem } from './product-images';

const { api, fetchImageUrl, toast, ApiErrorMock } = vi.hoisted(() => {
  class ApiErrorMock extends Error {
    status: number;
    body: unknown;
    constructor(status: number, message: string, body: unknown) {
      super(message);
      this.status = status;
      this.body = body;
    }
  }
  return { api: vi.fn(), fetchImageUrl: vi.fn(), toast: { success: vi.fn(), error: vi.fn() }, ApiErrorMock };
});

vi.mock('@/lib/api', () => ({ api, ApiError: ApiErrorMock, fetchImageUrl }));
vi.mock('@/components/ui/toast', () => ({ useToast: () => toast }));

const SHA = 'ab'.repeat(32);
const item = (over: Partial<PreviewImageItem> = {}): PreviewImageItem => ({
  key: 'k1', role: 'primary', position: 0, source: { kind: 'archive', label: 'SKU-1.png' }, status: 'ready', code: null, message: null,
  image: { id: 'img-1', sha256: SHA, mime_type: 'image/png', size: 100, width: 800, height: 600 }, ...over,
});
const images = (items: PreviewImageItem[], over: Partial<PreviewImages> = {}): PreviewImages => ({
  count: items.length, ready: items.filter((i) => i.status === 'ready').length, will_apply: true, status: 'ready', mode: 'new_product',
  existing: { count: 0, update_approved: null }, items, ...over,
});
const result = (over: Partial<ExecutionImage> = {}): ExecutionImage => ({
  key: 'k1', role: 'primary', position: 0, source: { kind: 'archive', label: 'SKU-1.png' }, image_id: 'img-1', status: 'success',
  error_code: null, error_message: null, retryable: false, attempts: 1, product_media_id: 'media-1', ...over,
});

let revoked: string[] = [];
const realCreate = (URL as unknown as { createObjectURL?: unknown }).createObjectURL;
const realRevoke = (URL as unknown as { revokeObjectURL?: unknown }).revokeObjectURL;
beforeEach(() => {
  api.mockReset();
  fetchImageUrl.mockReset();
  toast.success.mockReset();
  toast.error.mockReset();
  revoked = [];
  document.documentElement.lang = 'ar';
  fetchImageUrl.mockImplementation(async (path: string) => `blob:${path}`);
  Object.assign(URL, { createObjectURL: vi.fn(), revokeObjectURL: (url: string) => { revoked.push(url); } });
  vi.stubGlobal('crypto', { randomUUID: () => '22222222-2222-4222-8222-222222222222' });
});
afterEach(() => {
  cleanup();
  // The suite shares one process (singleFork): put back everything this file touched.
  document.documentElement.lang = '';
  vi.unstubAllGlobals();
  Object.assign(URL, { createObjectURL: realCreate, revokeObjectURL: realRevoke });
});

describe('خلية صور المعاينة', () => {
  it('تعرض مصغّرة موثّقة بمسار الإجراء والصورة، مع المصدر والأبعاد والبصمة والحالة', async () => {
    render(<PreviewImagesCell actionId="action-1" images={images([item(), item({ key: 'k2', role: 'additional', position: 1, source: { kind: 'url', label: 'img.example/b.jpg' }, image: { id: 'img-2', sha256: 'cd'.repeat(32), mime_type: 'image/jpeg', size: 1, width: 10, height: 10 } })])} />);

    const thumbs = await screen.findAllByRole('img');
    expect(thumbs.map((img) => img.getAttribute('src'))).toEqual([
      'blob:/ai-actions/action-1/images/img-1/thumbnail',
      'blob:/ai-actions/action-1/images/img-2/thumbnail',
    ]);
    expect(screen.getByText('SKU-1.png')).toBeTruthy();
    expect(screen.getByText('img.example/b.jpg')).toBeTruthy();
    expect(screen.getAllByText('ستُرفق')).toHaveLength(2);
    expect(screen.getByText(/رئيسية · من الأرشيف/).textContent).toContain('800×600');
    expect(screen.getByTitle(SHA).textContent).toBe('abababababab'.slice(0, 10) + '…');
  });

  it('تعرض سبب كل صورة لا تُرفق ولا تدّعي أنها ستُرفق', () => {
    render(<PreviewImagesCell actionId="action-1" images={images([
      item({ status: 'skipped', code: 'existing_product_needs_decision', message: 'منتج موجود: لا تُضاف صور إلا بقرار صريح لهذا الصف.' }),
      item({ key: 'k2', status: 'error', code: 'image_invalid', message: 'محتوى الصورة غير مدعوم.', image: null, source: { kind: 'url', label: 'img.example/x' } }),
      item({ key: 'k3', status: 'unavailable', code: 'remote_fetch_disabled', message: 'جلب الصور من روابط خارجية غير مفعّل.', image: null, source: { kind: 'url', label: 'img.example/y' } }),
    ], { status: 'error', will_apply: false })} />);

    expect(screen.getByText('لن تُرفق')).toBeTruthy();
    expect(screen.getByText('مرفوضة')).toBeTruthy();
    expect(screen.getByText('غير متاحة')).toBeTruthy();
    expect(screen.getByText(/منتج موجود: لا تُضاف صور إلا بقرار صريح/)).toBeTruthy();
    expect(screen.getByText(/محتوى الصورة غير مدعوم/)).toBeTruthy();
    expect(screen.queryByText('ستُرفق')).toBeNull();
    // A source with no staged image never asks the server for a thumbnail.
    expect(fetchImageUrl).toHaveBeenCalledTimes(1);
  });

  it('تذكّر أن صور المنتج الموجود تُضاف ولا تستبدل، وتعرض الإنجليزية عند ضبط اللغة', () => {
    document.documentElement.lang = 'en';
    render(<PreviewImagesCell actionId="action-1" images={images([item()], { mode: 'append_existing', existing: { count: 2, update_approved: true } })} />);

    expect(screen.getByText('1 image')).toBeTruthy();
    expect(screen.getByText('Will attach')).toBeTruthy();
    expect(screen.getByText(/nothing is replaced or deleted/)).toBeTruthy();
  });

  it('لا تعرض شيئاً لصف بلا صور، ولا تنكسر إن فشل جلب المصغّرة', async () => {
    const { container, rerender } = render(<PreviewImagesCell actionId="action-1" images={null} />);
    expect(container.textContent).toBe('—');
    fetchImageUrl.mockResolvedValue(null);
    rerender(<PreviewImagesCell actionId="action-1" images={images([item()])} />);
    await waitFor(() => expect(screen.queryByRole('img')).toBeNull());
    expect(screen.getByText('SKU-1.png')).toBeTruthy();
  });

  it('تحرّر رابط الكائن المحلي عند الفكّ', async () => {
    const { unmount } = render(<PreviewImagesCell actionId="action-1" images={images([item()])} />);
    await screen.findByRole('img');
    unmount();
    expect(revoked).toContain('blob:/ai-actions/action-1/images/img-1/thumbnail');
  });
});

describe('نتائج الصور بعد التنفيذ', () => {
  it('تعرض نتيجة كل صورة منفصلة: أُرفقت، فشلت بسببها وقابليتها لإعادة المحاولة، لم تُرفق', async () => {
    render(<ExecutionImagesList actionId="action-1" images={[
      result(),
      result({ key: 'k2', status: 'failed', error_code: 'image_storage_failed', error_message: 'تعذّر حفظ الصورة في التخزين؛ يمكن إعادة المحاولة.', retryable: true, product_media_id: null, source: { kind: 'archive', label: 'SKU-1__2.jpg' } }),
      result({ key: 'k3', status: 'skipped', error_code: 'already_attached', error_message: 'الصورة موجودة بالفعل ضمن صور المنتج؛ لم تُكرَّر.', product_media_id: null, source: { kind: 'archive', label: 'SKU-1__3.jpg' } }),
    ]} />);

    const list = screen.getByTestId('execution-images');
    expect(within(list).getByText('أُرفقت')).toBeTruthy();
    expect(within(list).getByText('فشلت')).toBeTruthy();
    expect(within(list).getByText('لم تُرفق')).toBeTruthy();
    expect(within(list).getByText(/تعذّر حفظ الصورة في التخزين؛ يمكن إعادة المحاولة\. \(قابلة لإعادة المحاولة\)/)).toBeTruthy();
    expect(within(list).getByText(/لم تُكرَّر/)).toBeTruthy();
  });

  it('لا تعرض شيئاً بلا صور', () => {
    const { container } = render(<ExecutionImagesList actionId="action-1" images={[]} />);
    expect(container.textContent).toBe('');
  });
});

describe('بطاقة رفع أرشيف الصور', () => {
  const staged = { archive: [{ id: 'img-1', label: 'SKU-1.png', sha256: SHA, mime_type: 'image/png', size: 1, width: 1, height: 1 }], remote: 0 };
  const zip = () => new File(['PK'], 'images.zip', { type: 'application/zip' });
  const input = () => screen.getByLabelText('اختر ملف ZIP للصور') as HTMLInputElement;

  it('ترفع الملف بمفتاح idempotency ونسخة المسودة ثم تُبلغ الأب ليعيد تحميل المراجعة', async () => {
    const onStaged = vi.fn();
    api.mockImplementation(async (path: string, options?: { method?: string; body?: unknown }) => {
      if (options?.method === 'POST') return { data: staged };
      return { data: { archive: [], remote: 0 } };
    });
    const user = userEvent.setup();
    render(<ImageArchiveCard actionId="action-1" version={3} dirty={false} locked={false} onStaged={onStaged} />);
    await screen.findByText('لم تُرفع صور بعد');

    await user.upload(input(), zip());

    await waitFor(() => expect(onStaged).toHaveBeenCalledTimes(1));
    const post = api.mock.calls.find(([, options]) => options?.method === 'POST');
    expect(post?.[0]).toBe('/ai-actions/action-1/image-archives');
    expect(post?.[1].headers['Idempotency-Key']).toMatch(/^ai-images-/);
    const form = post?.[1].body as FormData;
    expect(form.get('expected_version')).toBe('3');
    expect((form.get('archive') as File).name).toBe('images.zip');
    expect(await screen.findByText('جُهِّزت 1 صورة للمعاينة')).toBeTruthy();
    expect(toast.success).toHaveBeenCalled();
  });

  it('تعرض رسالة الخادم عند رفض الأرشيف ولا تُبلغ الأب', async () => {
    const onStaged = vi.fn();
    api.mockImplementation(async (_path: string, options?: { method?: string }) => {
      if (options?.method === 'POST') throw new ApiErrorMock(422, 'x', { error: { code: 'image_archive_invalid', message: 'يحتوي ZIP على مسار غير آمن (Zip Slip).' } });
      return { data: { archive: [], remote: 0 } };
    });
    const user = userEvent.setup();
    render(<ImageArchiveCard actionId="action-1" version={1} dirty={false} locked={false} onStaged={onStaged} />);
    await screen.findByText('لم تُرفع صور بعد');

    await user.upload(input(), zip());

    await waitFor(() => expect(toast.error).toHaveBeenCalledWith('يحتوي ZIP على مسار غير آمن (Zip Slip).'));
    expect(onStaged).not.toHaveBeenCalled();
  });

  it('تمنع الرفع مع تعديلات غير محفوظة أو بعد بدء التنفيذ وتشرح السبب', async () => {
    api.mockResolvedValue({ data: { archive: [], remote: 0 } });
    const { rerender } = render(<ImageArchiveCard actionId="action-1" version={1} dirty locked={false} onStaged={vi.fn()} />);
    expect(input().disabled).toBe(true);
    expect(screen.getByText('احفظ تعديلاتك أولاً ثم ارفع الصور.')).toBeTruthy();
    rerender(<ImageArchiveCard actionId="action-1" version={1} dirty={false} locked onStaged={vi.fn()} />);
    expect(input().disabled).toBe(true);
    expect(screen.getByText('لا يمكن إضافة صور بعد بدء التنفيذ.')).toBeTruthy();
    expect(api.mock.calls.some(([, options]) => options?.method === 'POST')).toBe(false);
  });

  it('تمنع الرفع المزدوج قبل أن تكتمل الأولى', async () => {
    let release: (value: unknown) => void = () => undefined;
    api.mockImplementation((_path: string, options?: { method?: string }) => options?.method === 'POST'
      ? new Promise((resolve) => { release = resolve; })
      : Promise.resolve({ data: { archive: [], remote: 0 } }));
    const user = userEvent.setup();
    render(<ImageArchiveCard actionId="action-1" version={1} dirty={false} locked={false} onStaged={vi.fn()} />);
    await screen.findByText('لم تُرفع صور بعد');

    await user.upload(input(), zip());
    await user.upload(input(), zip());

    expect(api.mock.calls.filter(([, options]) => options?.method === 'POST')).toHaveLength(1);
    release({ data: staged });
    await screen.findByText('جُهِّزت 1 صورة للمعاينة');
  });

  it('تعرض نصوص الإنجليزية عند ضبط لغة الصفحة', async () => {
    document.documentElement.lang = 'en';
    api.mockResolvedValue({ data: { archive: [], remote: 0 } });
    render(<ImageArchiveCard actionId="action-1" version={1} dirty={false} locked={false} onStaged={vi.fn()} />);
    expect(await screen.findByText('No images uploaded yet')).toBeTruthy();
    expect(screen.getByText('Product images')).toBeTruthy();
  });
});
