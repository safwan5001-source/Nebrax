// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * يلتقط `html2canvas` الوهميّ حالة العنصر أثناء الالتقاط والخيارات الممرَّرة، كي
 * نتحقق من سلوك المُصدِّر القائم (تحييد minHeight/boxShadow — PR #637) ومن ربط
 * طبقة توافق العربية عبر onclone، دون تشغيل html2canvas الحقيقي.
 */
type Captured = {
  minHeightDuringCapture: string;
  boxShadowDuringCapture: string;
  options: Record<string, unknown> | undefined;
};
const captured: Captured = { minHeightDuringCapture: '', boxShadowDuringCapture: '', options: undefined };

vi.mock('html2canvas', () => ({
  default: vi.fn(async (el: HTMLElement, options: Record<string, unknown>) => {
    captured.minHeightDuringCapture = el.style.minHeight;
    captured.boxShadowDuringCapture = el.style.boxShadow;
    captured.options = options;
    return {
      width: 800,
      height: 400, // < ارتفاع صفحة A4 بالكانفاس → مسار الصفحة الواحدة
      toDataURL: () => 'data:image/png;base64,AAAA',
    } as unknown as HTMLCanvasElement;
  }),
}));

vi.mock('jspdf', () => ({
  jsPDF: class {
    addImage() {}
    addPage() {}
    output() { return new Blob(['pdf'], { type: 'application/pdf' }); }
  },
}));

import { downloadPdf } from './pdf';

beforeEach(() => {
  captured.minHeightDuringCapture = '';
  captured.boxShadowDuringCapture = '';
  captured.options = undefined;
  // jsdom لا يوفّر هذه افتراضياً — نُثبّتها بأمان دون الاعتماد على وجود خطأ نوعيّ.
  (URL as unknown as { createObjectURL: () => string }).createObjectURL = vi.fn(() => 'blob:mock');
  (URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = vi.fn();
  HTMLAnchorElement.prototype.click = vi.fn();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('elementToPdfBlob — سلوك المُصدِّر القائم محفوظ', () => {
  it('12/13) يحيّد minHeight وboxShadow أثناء الالتقاط ثم يستعيد نمط العنصر', async () => {
    const el = document.createElement('div');
    el.setAttribute('style', 'min-height:277mm;box-shadow:0 1px 2px #000;color:red');
    document.body.appendChild(el);

    await downloadPdf(el, 'doc');

    // أثناء الالتقاط: مُحيَّدان.
    expect(captured.minHeightDuringCapture).toBe('auto');
    expect(captured.boxShadowDuringCapture).toBe('none');
    // بعد الالتقاط: النمط الأصلي مُستعاد حرفياً.
    expect(el.getAttribute('style')).toBe('min-height:277mm;box-shadow:0 1px 2px #000;color:red');
  });

  it('يمرّر خيارات الالتقاط الثابتة (scale/backgroundColor/useCORS)', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    await downloadPdf(el, 'doc');
    expect(captured.options).toMatchObject({ scale: 2, backgroundColor: '#ffffff', useCORS: true });
  });

  it('يربط طبقة توافق العربية عبر onclone، وتطبّع النسخة عند استدعائها', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    await downloadPdf(el, 'doc');

    const onclone = captured.options?.onclone as
      | ((doc: Document, el: HTMLElement) => void)
      | undefined;
    expect(typeof onclone).toBe('function');

    // نبني نسخة تحمل عيبَي RC1/RC2 على نصّ عربي، ونستدعي onclone كما يفعل html2canvas.
    const clone = document.createElement('div');
    clone.innerHTML =
      '<h1 style="letter-spacing:-0.03em">فاتورة ضريبية</h1>' +
      '<div style="overflow:hidden;max-height:2.6em">شركة نبراكس التجريبية</div>';
    document.body.appendChild(clone);
    onclone!(document, clone);

    expect((clone.querySelector('h1') as HTMLElement).style.letterSpacing).toBe('normal');
    const addr = clone.querySelector('div') as HTMLElement;
    expect(addr.style.overflow).toBe('visible');
    expect(addr.style.maxHeight).toBe('none');
  });
});
