import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('تحييد خصائص العرض أثناء التقاط PDF (regression)', () => {
  const pdfSource = readFileSync(resolve(process.cwd(), 'src/lib/pdf.ts'), 'utf8');
  const layoutSource = readFileSync(resolve(process.cwd(), 'src/modules/documents/components/sections/doc-layout.tsx'), 'utf8');

  it('يحيّد min-height قبل التقاط html2canvas كما تفعل print:min-h-0', () => {
    expect(pdfSource).toContain("el.style.minHeight = 'auto'");
  });

  it('يحيّد box-shadow قبل التقاط html2canvas كما تفعل print:shadow-none', () => {
    expect(pdfSource).toContain("el.style.boxShadow = 'none'");
  });

  it('DocLayout يحتفظ بـ print:min-h-0 و print:shadow-none للطباعة', () => {
    expect(layoutSource).toContain('print:min-h-0');
    expect(layoutSource).toContain('print:shadow-none');
  });

  it('يرسم المحتوى القصير في صفحة واحدة بلا تقطيع', () => {
    expect(pdfSource).toContain('canvas.height <= pageHeightCanvas');
  });

  it('يضيف العنصر الجذر إلى مصفوفة الاستعادة', () => {
    expect(pdfSource).toContain('restore.push([el, el.getAttribute');
  });

  it('لا يُنشئ محرّك عارض ثانٍ (مسار pdf واحد)', () => {
    expect(pdfSource).not.toMatch(/new\s+(?:PDFDocument|puppeteer)/i);
  });
});
