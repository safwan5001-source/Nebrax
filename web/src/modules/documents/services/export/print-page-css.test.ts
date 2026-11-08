// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPrintPageCss, measureRollHeightMm, printDocument } from './index';

const T80 = { widthMm: 80, heightMm: 0 };
const T58 = { widthMm: 58, heightMm: 0 };
const A4 = { widthMm: 210, heightMm: 297 };
const sizeOf = (css: string) => /@page\s*\{\s*size:\s*([\d.]+)mm\s+([\d.]+)mm/.exec(css);

describe('buildPrintPageCss — إعلان @page صالح (AWJ-DOC-V2-PR2)', () => {
  it('الحراري: size بطولين (عرض الرول × ارتفاع المحتوى) لا `auto` — الإعلان القديم غير صالح ويُسقطه Chromium', () => {
    const css = buildPrintPageCss(T80, 120.3);
    expect(sizeOf(css)?.slice(1)).toEqual(['80', '123']); // ceil(120.3) + 2mm تغذية
    expect(css).not.toMatch(/\bauto\b/);
    expect(css).toMatch(/margin:\s*0;/);
    expect(buildPrintPageCss(T58, 200)).toMatch(/size:\s*58mm\s+202mm/);
  });

  it('الحراري: يقيّد html/body بارتفاع الصفحة كي لا تتولد صفحات رول فارغة من بقية الصفحة', () => {
    const css = buildPrintPageCss(T80, 100);
    expect(css).toMatch(/html,\s*body\s*\{\s*height:\s*102mm !important;\s*max-height:\s*102mm !important;\s*overflow:\s*hidden !important;/);
  });

  it('الحراري: عند تعذّر القياس يسقط إلى ارتفاع آمن (297mm) بلا تقييد لـ html/body (لا قصّ)', () => {
    for (const bad of [null, undefined, 0, -5]) {
      const css = buildPrintPageCss(T80, bad);
      expect(sizeOf(css)?.slice(1)).toEqual(['80', '297']);
      expect(css).not.toMatch(/overflow:\s*hidden/);
    }
  });

  it('الحراري: حدّ أدنى لارتفاع الصفحة، والأقصى 5000mm', () => {
    expect(sizeOf(buildPrintPageCss(T58, 3))?.[2]).toBe('20');
    expect(sizeOf(buildPrintPageCss(T58, 99_999))?.[2]).toBe('5000');
  });

  it('الحراري: الإيصال الأطول من الحد الأقصى لا يُقصّ — بلا overflow:hidden فيُقسَّم على صفحات (ملاحظة مراجعة PR2)', () => {
    for (const mm of [4_999, 5_000, 99_999]) {
      const css = buildPrintPageCss(T58, mm);
      expect(sizeOf(css)?.[2]).toBe('5000');
      expect(css, `${mm}mm`).not.toMatch(/overflow:\s*hidden|max-height/);
    }
    // ما يتّسع (≤ 5000 بعد التغذية) يحتفظ بالتقييد
    expect(buildPrintPageCss(T58, 4_900)).toMatch(/overflow:\s*hidden/);
  });

  it('ورق ثابت (A4/Letter): النص حرفياً كما كان (لا تغيير في طباعة A4)', () => {
    expect(buildPrintPageCss(A4)).toBe('@media print { @page { size: 210mm 297mm; } }');
    expect(buildPrintPageCss({ widthMm: 216, heightMm: 279 })).toBe('@media print { @page { size: 216mm 279mm; } }');
    // الارتفاع المقيس لا يؤثر على الورق الثابت
    expect(buildPrintPageCss(A4, 500)).toBe('@media print { @page { size: 210mm 297mm; } }');
  });

  it('حارس ساكن: المصدر لا يحقن `Wmm auto` أبداً', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/modules/documents/services/export/index.ts'), 'utf8');
    // يتجاهل التعليقات التوضيحية: يفحص قوالب CSS الفعلية (`size: ${w}mm auto` / `size: 80mm auto`)
    expect(source).not.toMatch(/size:\s*(?:\$\{[^}]+\}|[\d.]+)mm\s+auto\s*[;}`]/);
  });
});

describe('measureRollHeightMm / printDocument', () => {
  let printSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    printSpy = vi.fn();
    window.print = printSpy as unknown as typeof window.print;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    document.head.querySelectorAll('#nebrax-doc-print-page').forEach((node) => node.remove());
  });

  function mountReceipt(id = 'thermal-print-root') {
    const root = document.createElement('div');
    root.id = id;
    root.style.display = 'none'; // كجذر الحراري المخفي على الشاشة
    root.innerHTML = '<p>إيصال</p>';
    document.body.appendChild(root);
    return root;
  }

  it('يقيس نسخة بعرض الورق (لا الجذر الأصلي)، بلا معرّف مكرر، ويزيلها بعد القياس', () => {
    const root = mountReceipt();
    const seen: { ids: number; display: string; width: string }[] = [];
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      if (this !== root) {
        seen.push({ ids: document.querySelectorAll('#thermal-print-root').length, display: this.style.display, width: (this.parentElement as HTMLElement).style.width });
      }
      return { width: 302, height: 400, top: 0, left: 0, right: 302, bottom: 400, x: 0, y: 0, toJSON() {} } as DOMRect;
    });
    const before = document.body.children.length;

    const mm = measureRollHeightMm(root, 80);

    expect(mm).toBeCloseTo((400 * 25.4) / 96, 5);
    expect(seen).toEqual([{ ids: 1, display: 'block', width: '80mm' }]); // النسخة ظاهرة (block) حتى لو الأصل مخفي
    expect(document.body.children.length).toBe(before); // الحاوية المؤقتة أُزيلت
    expect(root.style.display).toBe('none'); // الأصل لم يُمَس
  });

  it('جذر حراري → يحقن @page صالحاً بارتفاع المحتوى، ثم يزيله عند afterprint', () => {
    const root = mountReceipt();
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      { width: 302, height: 400, top: 0, left: 0, right: 302, bottom: 400, x: 0, y: 0, toJSON() {} } as DOMRect,
    );

    printDocument(T80, 'thermal-print-root');

    const style = document.getElementById('nebrax-doc-print-page');
    expect(style?.textContent).toMatch(/size:\s*80mm\s+108mm/); // ceil(105.83) + 2
    expect(style?.textContent).not.toMatch(/auto/);
    expect(root.hasAttribute('data-print-target')).toBe(true);
    expect(printSpy).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new Event('afterprint'));
    expect(document.getElementById('nebrax-doc-print-page')).toBeNull();
    expect(root.hasAttribute('data-print-target')).toBe(false);
  });

  it('A4: لا قياس ولا تغيير — النص الحرفي القديم', () => {
    mountReceipt('print-root');
    const rect = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect');

    printDocument(A4);

    expect(document.getElementById('nebrax-doc-print-page')?.textContent).toBe('@media print { @page { size: 210mm 297mm; } }');
    expect(rect).not.toHaveBeenCalled();
  });

  it('بلا تخطيط (jsdom): يسقط إلى 297mm ولا يرمي', () => {
    mountReceipt();
    expect(() => printDocument(T58, 'thermal-print-root')).not.toThrow();
    expect(document.getElementById('nebrax-doc-print-page')?.textContent).toMatch(/size:\s*58mm\s+297mm/);
  });

  it('جذر غير موجود: لا يحقن شيئاً ولا يطبع', () => {
    printDocument(T80, 'missing');
    expect(document.getElementById('nebrax-doc-print-page')).toBeNull();
    expect(printSpy).not.toHaveBeenCalled();
  });
});

describe('buildPrintPageCss — هوامش Output Profile (AWJ-DOC-V2-PR3B)', () => {
  it('بلا هوامش: الصياغة السابقة حرفياً (يبقى هامش @page العام)', () => {
    expect(buildPrintPageCss(A4)).toBe('@media print { @page { size: 210mm 297mm; } }');
  });

  it('مع هوامش: تُعلَن top right bottom left بالمليمتر على @page', () => {
    const css = buildPrintPageCss({ widthMm: 148, heightMm: 210, marginsMm: { top: 10, right: 11, bottom: 12, left: 13 } });
    expect(css).toBe('@media print { @page { size: 148mm 210mm; margin: 10mm 11mm 12mm 13mm; } }');
  });

  it('الأفقي: size بالعرض×الارتفاع المقلوبين صراحةً', () => {
    expect(buildPrintPageCss({ widthMm: 210, heightMm: 148, marginsMm: { top: 10, right: 10, bottom: 10, left: 10 } }))
      .toContain('size: 210mm 148mm;');
  });

  it('الرول يتجاهل الهوامش (يبقى margin:0 كما أُصلح في PR2)', () => {
    const css = buildPrintPageCss({ widthMm: 80, heightMm: 0, marginsMm: { top: 9, right: 9, bottom: 9, left: 9 } }, 100);
    expect(css).toMatch(/margin:\s*0;/);
    expect(css).not.toContain('9mm');
  });
});
