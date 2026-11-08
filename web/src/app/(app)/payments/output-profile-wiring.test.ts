import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * حراس ساكنة لثوابت AWJ-DOC-V2-PR4 على صفحتي السند الرسمي وفاتورة المشتريات:
 * المحرك المتجهي للسند يبقى مرجعاً عند غياب الملف، ولا يُلتقَط الجذر إلا بملف مطبَّق، ولا يُلمس الحساب.
 */
const read = (file: string) => readFileSync(resolve(process.cwd(), file), 'utf8');

describe('/payments/[id] — ملف الإخراج', () => {
  const source = read('src/app/(app)/payments/[id]/page.tsx');

  it('المحرك المتجهي createPaymentPdf يبقى المسار الافتراضي ولا يُلتقَط الجذر إلا حين يوجد ملف مطبَّق', () => {
    expect(source).toMatch(/capturePdf = Boolean\(pdfOutput && pdfSpec\.profile\)/);
    expect(source).toMatch(/capturePdf \? captureElement\(\) : null/);
    // الالتقاط من جذر PDF المخصَّص بتخطيط مراجعة PDF، لا من جذر الطباعة الثابت.
    expect(source).toMatch(/getElementById\('pdf-print-root'\)/);
    expect(source).toMatch(/layout=\{pdfOutput\.layout\}/);
    // حالة السند (مسودة/ملغى) تصل جذر PDF الملتقَط كما كان المتجهي يطبعها.
    expect(source).toMatch(/status=\{payment\.status\}/);
    // شعار المنشأة كما كان المتجهي يرجع إلى company.logo.
    expect(source).toMatch(/logoUrl=\{logoUrl \?\? company\?\.logo \?\? null\}/);
    expect(source).toMatch(/downloadPaymentPdf\(await createPdf\(\), payment\.number\)/);
    expect(source).toMatch(/sharePaymentPdf\(await createPdf\(\)/);
  });

  it('أي لقطة مثبتة (ولو PDF وحدها) تعني مستنداً مرحَّلاً', () => {
    expect(source).toMatch(/isPosted: Boolean\(r\.data\.print_template_revision \|\| r\.data\.pdf_template_revision \|\| r\.data\.thermal_template_revision\)/);
  });

  it('الملف يُقرأ من المراجعة المثبتة أولاً ثم التعيين الحي، ولا يُكتب شيء للخادم', () => {
    expect(source).toMatch(/readOutputProfile\(frozen\)/);
    expect(source).toMatch(/setOutputProfile\(resolved\.outputProfile\)/);
    expect(source).not.toMatch(/method:\s*'(POST|PUT|PATCH|DELETE)'/);
  });
});

describe('/purchases/[id] — ملف الإخراج', () => {
  const source = read('src/app/(app)/purchases/[id]/page.tsx');

  it('المقاس من resolveDocumentOutputSpec بملف المراجعة المثبتة (أو الحي) ولا يبقى supportedPaper[0] وحده', () => {
    expect(source).toMatch(/const paper = resolveDocumentOutputSpec\(templateId, outputProfile\)\.paper/);
    expect(source).toMatch(/setOutputProfile\(readOutputProfile\(frozen\)\)/);
    expect(source).toMatch(/setOutputProfile\(resolved\.outputProfile\)/);
  });
});
