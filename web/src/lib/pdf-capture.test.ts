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

/** يسجّل خيارات إنشاء jsPDF واستدعاءات addImage (ضغط الصور بلا فقد — AWJ-DOC-V2-PR1). */
const pdfCalls: { ctor: Array<Record<string, unknown>>; images: Array<{ format: unknown; w: unknown; h: unknown }>; pages: number } = {
  ctor: [], images: [], pages: 0,
};

vi.mock('jspdf', () => ({
  jsPDF: class {
    constructor(options: Record<string, unknown>) { pdfCalls.ctor.push(options); }
    addImage(_data: unknown, format: unknown, _x: unknown, _y: unknown, w: unknown, h: unknown) { pdfCalls.images.push({ format, w, h }); }
    addPage() { pdfCalls.pages += 1; }
    output() { return new Blob(['pdf'], { type: 'application/pdf' }); }
  },
}));

import { downloadPdf } from './pdf';

beforeEach(() => {
  captured.minHeightDuringCapture = '';
  captured.boxShadowDuringCapture = '';
  captured.options = undefined;
  pdfCalls.ctor = []; pdfCalls.images = []; pdfCalls.pages = 0;
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

describe('elementToPdfBlob — الضغط والمقاسات (AWJ-DOC-V2-PR1)', () => {
  it('يُنشئ jsPDF بـ compress:true ويبقى A4 (210×297) لورق الصفحات', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    await downloadPdf(el, 'doc');
    expect(pdfCalls.ctor).toHaveLength(1);
    expect(pdfCalls.ctor[0]).toMatchObject({ unit: 'mm', format: [210, 297], orientation: 'portrait', compress: true });
    expect(pdfCalls.images).toHaveLength(1);
    expect(pdfCalls.images[0].format).toBe('PNG'); // بلا فقد: لا JPEG
  });

  it('الحراري (ارتفاع مفتوح): صفحة بعرض الورق وارتفاع المحتوى، ومضغوطة', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    await downloadPdf(el, 'receipt', { widthMm: 80, heightMm: 0 });
    expect(pdfCalls.ctor[0]).toMatchObject({ unit: 'mm', orientation: 'portrait', compress: true });
    const format = pdfCalls.ctor[0].format as number[];
    expect(format[0]).toBe(80);
    expect(format[1]).toBeCloseTo((400 * 80) / 800, 5); // الكانفاس الوهمي 800×400
    expect(pdfCalls.pages).toBe(0);
  });
});
