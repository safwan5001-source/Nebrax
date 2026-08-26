// @vitest-environment jsdom
/**
 * انحدار: وضع المعاينة لا ينزّل ملفاً — ويقول ذلك صراحةً.
 *
 * كان `downloadFile` يعود صامتاً في المعاينة، فيرى المستدعي وعداً ناجحاً
 * فيعلن للمستخدم أن الملف «جُهّز وبدأ التنزيل». هذه الاختبارات تثبّت العقد
 * المُنمَّط: لا اتصال، ولا نقرة تنزيل، ونتيجة `demo-unavailable` صريحة.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadFile } from './api';

const createObjectURL = vi.fn(() => 'blob:nebrax/test');
const revokeObjectURL = vi.fn();

beforeEach(() => {
  localStorage.clear();
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  // jsdom لا يوفّر واجهة الكائنات الثنائية؛ نثبّتها كي تُرصد لا كي تعمل.
  Object.assign(URL, { createObjectURL, revokeObjectURL });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('downloadFile', () => {
  it('لا يتصل ولا ينقر تنزيلاً في وضع المعاينة، ويعيد نتيجة عدم التوفّر', async () => {
    localStorage.setItem('demo', 'true');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});

    const outcome = await downloadFile('/products/export?scope=all&format=xlsx', 'nebrax-products.xlsx');

    expect(outcome).toBe('demo-unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(click).not.toHaveBeenCalled();
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(document.querySelector('a[download]')).toBeNull();
  });

  it('ينزّل فعلاً خارج وضع المعاينة ويعيد نتيجة التنزيل', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => 'attachment; filename="nebrax-products-2026.xlsx"' },
      blob: async () => new Blob(['x']),
    });
    vi.stubGlobal('fetch', fetchMock);
    const downloads: string[] = [];
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloads.push(this.download);
      });

    const outcome = await downloadFile('/products/export?scope=all&format=xlsx', 'fallback.xlsx');

    expect(outcome).toBe('downloaded');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    // الاسم من ترويسة الخادم لا من الاسم الاحتياطي.
    expect(downloads).toEqual(['nebrax-products-2026.xlsx']);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:nebrax/test');
  });
});
