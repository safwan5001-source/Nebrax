import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('عزل قواعد طباعة Modern V2', () => {
  it('يقيّد تكرار thead وتجنّب orphan بتركيب modern_v2 فقط', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');
    expect(css).toContain('[data-doc-composition="modern_v2"] thead');
    expect(css).toContain('[data-doc-composition="modern_v2"] [data-doc-keep="summary"]');
    expect(css).not.toMatch(/^\s*thead\s*\{\s*display:\s*table-header-group/m);
  });

  it('لا يمس عقد التصدير ولا يضيف محرّك عارض ثانٍ', () => {
    const header = readFileSync(resolve(process.cwd(), 'src/modules/documents/components/sections/doc-header.tsx'), 'utf8');
    const layout = readFileSync(resolve(process.cwd(), 'src/modules/documents/components/sections/doc-layout.tsx'), 'utf8');
    const exporter = readFileSync(resolve(process.cwd(), 'src/modules/print-templates/services/document-output-template.ts'), 'utf8');
    expect(layout).toContain('data-doc-composition={style.composition}');
    expect(header).toContain("style.composition === 'modern_v2'");
    expect(header).toContain("style.composition === 'modern'");
    expect(header).toContain("style.composition === 'erp'");
    expect(header).toContain("style.composition === 'erp_v2'");
    expect(header).toContain("style.composition === 'classic_v2'");
    expect(header).toContain("style.composition === 'minimal_v2'");
    expect(header).toContain("style.composition === 'retail_v2'");
    expect(header).toContain("style.composition === 'quotation_proposal'");
    expect(header).toContain("style.composition === 'purchase_order_formal'");
    expect(exporter).toContain('pdfSharesPrintRoot');
  });
});

describe('عزل قواعد طباعة ERP V2', () => {
  it('يقيّد تكرار thead بتركيب erp_v2 دون لمس erp التاريخي أو modern_v2', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');
    expect(css).toContain('[data-doc-composition="erp_v2"] thead');
    expect(css).toContain('[data-doc-composition="modern_v2"] thead');
    expect(css).not.toContain('[data-doc-composition="erp"] thead');
  });
});

describe('عزل قواعد طباعة Classic V2', () => {
  it('يقيّد تكرار thead بتركيب classic_v2 دون لمس classic التاريخي أو V2 الأخرى', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');
    expect(css).toContain('[data-doc-composition="classic_v2"] thead');
    expect(css).toContain('[data-doc-composition="modern_v2"] thead');
    expect(css).toContain('[data-doc-composition="erp_v2"] thead');
    expect(css).not.toContain('[data-doc-composition="classic"] thead');
  });
});

describe('عزل قواعد طباعة Minimal V2', () => {
  it('يقيّد تكرار thead بتركيب minimal_v2 دون لمس minimal التاريخي أو V2 الأخرى', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');
    expect(css).toContain('[data-doc-composition="minimal_v2"] thead');
    expect(css).toContain('[data-doc-composition="modern_v2"] thead');
    expect(css).toContain('[data-doc-composition="erp_v2"] thead');
    expect(css).toContain('[data-doc-composition="classic_v2"] thead');
    expect(css).not.toContain('[data-doc-composition="minimal"] thead');
  });
});

describe('عزل قواعد طباعة Retail V2', () => {
  it('يقيّد تكرار thead بتركيب retail_v2 دون لمس retail التاريخي أو V2 الأخرى', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');
    expect(css).toContain('[data-doc-composition="retail_v2"] thead');
    expect(css).toContain('[data-doc-composition="modern_v2"] thead');
    expect(css).toContain('[data-doc-composition="erp_v2"] thead');
    expect(css).toContain('[data-doc-composition="classic_v2"] thead');
    expect(css).toContain('[data-doc-composition="minimal_v2"] thead');
    expect(css).not.toContain('[data-doc-composition="retail"] thead');
  });
});

describe('عزل قواعد طباعة Quotation Proposal', () => {
  it('يقيّد تكرار thead بتركيب quotation_proposal دون لمس قوالب الفاتورة', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');
    expect(css).toContain('[data-doc-composition="quotation_proposal"] thead');
    expect(css).toContain('[data-doc-composition="modern_v2"] thead');
    expect(css).toContain('[data-doc-composition="retail_v2"] thead');
    expect(css).not.toContain('[data-doc-composition="classic"] thead');
  });
});

describe('عزل قواعد طباعة Purchase Order Formal', () => {
  it('يقيّد تكرار thead بتركيب purchase_order_formal دون لمس عرض السعر أو قوالب الفاتورة', () => {
    const css = readFileSync(resolve(process.cwd(), 'src/app/globals.css'), 'utf8');
    expect(css).toContain('[data-doc-composition="purchase_order_formal"] thead');
    expect(css).toContain('[data-doc-composition="quotation_proposal"] thead');
    expect(css).toContain('[data-doc-composition="modern_v2"] thead');
    expect(css).not.toContain('[data-doc-composition="classic"] thead');
  });
});

describe('تحييد PDF يوازي الطباعة (A4 regression)', () => {
  it('DocLayout يحمل print:min-h-0 و print:shadow-none (شرط مسار الطباعة)', () => {
    const layout = readFileSync(resolve(process.cwd(), 'src/modules/documents/components/sections/doc-layout.tsx'), 'utf8');
    expect(layout).toContain('print:min-h-0');
    expect(layout).toContain('print:shadow-none');
  });

  it('مسار PDF يحيّد min-height و box-shadow يدوياً (html2canvas لا يطبّق @media print)', () => {
    const pdf = readFileSync(resolve(process.cwd(), 'src/lib/pdf.ts'), 'utf8');
    expect(pdf).toContain("el.style.minHeight = 'auto'");
    expect(pdf).toContain("el.style.boxShadow = 'none'");
  });

  it('مسار PDF يتخطّى التقطيع عندما يتّسع المحتوى في صفحة واحدة', () => {
    const pdf = readFileSync(resolve(process.cwd(), 'src/lib/pdf.ts'), 'utf8');
    expect(pdf).toContain('canvas.height <= pageHeightCanvas');
  });
});
