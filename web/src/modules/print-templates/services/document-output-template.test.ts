import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { getTemplate } from '@/modules/documents/registry/templates';
import {
  invoiceCatalogDocumentType,
  resolveDocumentOutputTemplates,
  resolvedTemplatesEqual,
  thermalPaperForTemplate,
} from './document-output-template';
import type { LivePrintTemplateAssignment, LiveTemplateRevision } from './live-template-definition';

function revision(id: string, templateId: string, extra: Record<string, unknown> = {}): LiveTemplateRevision {
  return {
    id,
    definition: {
      template_id: templateId,
      theme_id: 'blue',
      footer_text: `${id}-footer`,
      stamp: `${id}-stamp`,
      signature: `${id}-signature`,
      logo_height: 42,
      ...extra,
    },
  };
}

function assignment(revisionId: string, templateId: string, extra: Record<string, unknown> = {}): LivePrintTemplateAssignment {
  return {
    print_template_revision_id: revisionId,
    revision: revision(revisionId, templateId, extra),
  };
}

describe('invoiceCatalogDocumentType', () => {
  it('يربط الفاتورة المبسطة بنوع الكتالوج المستقل', () => {
    expect(invoiceCatalogDocumentType('simplified')).toBe('simplified_tax_invoice');
  });

  it('يربط الضريبية القياسية وأي قيمة أخرى بـ tax_invoice', () => {
    expect(invoiceCatalogDocumentType('standard')).toBe('tax_invoice');
    expect(invoiceCatalogDocumentType(null)).toBe('tax_invoice');
    expect(invoiceCatalogDocumentType(undefined)).toBe('tax_invoice');
  });
});

describe('resolveDocumentOutputTemplates', () => {
  it('يحل تعيين print الحي للمسودة', () => {
    const outputs = resolveDocumentOutputTemplates({
      documentType: 'tax_invoice',
      isPosted: false,
      livePrint: assignment('print-1', 'tax-invoice-classic'),
    });
    expect(outputs.print?.templateId).toBe('tax-invoice-classic');
    expect(outputs.print?.footerText).toBe('print-1-footer');
    expect(outputs.print?.stampUrl).toBe('print-1-stamp');
    expect(outputs.pdfSharesPrintRoot).toBe(true);
  });

  it('يحل تعيين PDF المستقل للمسودة ولا يخلطه بالطباعة', () => {
    const outputs = resolveDocumentOutputTemplates({
      documentType: 'tax_invoice',
      isPosted: false,
      livePrint: assignment('print-1', 'tax-invoice-classic'),
      livePdf: assignment('pdf-1', 'tax-invoice-minimal', { footer_text: 'تذييل PDF' }),
    });
    expect(outputs.print?.templateId).toBe('tax-invoice-classic');
    expect(outputs.pdf?.templateId).toBe('tax-invoice-minimal');
    expect(outputs.pdf?.footerText).toBe('تذييل PDF');
    expect(outputs.pdfSharesPrintRoot).toBe(false);
  });

  it('يسقط PDF المسودة إلى تعيين print عند غياب تعيين pdf', () => {
    const outputs = resolveDocumentOutputTemplates({
      documentType: 'tax_invoice',
      isPosted: false,
      livePrint: assignment('print-1', 'tax-invoice-modern'),
    });
    expect(outputs.pdf?.templateId).toBe('tax-invoice-modern');
    expect(outputs.pdfSharesPrintRoot).toBe(true);
  });

  it('يحل التعيين الحراري الحي للمسودة دون سقوط إلى print', () => {
    const outputs = resolveDocumentOutputTemplates({
      documentType: 'tax_invoice',
      isPosted: false,
      livePrint: assignment('print-1', 'tax-invoice-classic'),
      liveThermal: assignment('thermal-1', 'tax-invoice-thermal80'),
    });
    expect(outputs.thermal?.templateId).toBe('tax-invoice-thermal80');
    expect(outputs.thermal).not.toEqual(outputs.print);
  });

  it('لا يخترع قالباً حرارياً عند غياب التعيين', () => {
    const outputs = resolveDocumentOutputTemplates({
      documentType: 'tax_invoice',
      isPosted: false,
      livePrint: assignment('print-1', 'tax-invoice-classic'),
    });
    expect(outputs.thermal).toBeNull();
  });

  it('يثبّت المراجعات الثلاث للفاتورة المرحّلة ويتجاهل التعيين الحي', () => {
    const outputs = resolveDocumentOutputTemplates({
      documentType: 'tax_invoice',
      isPosted: true,
      frozenPrint: revision('frozen-print', 'tax-invoice-classic'),
      frozenPdf: revision('frozen-pdf', 'tax-invoice-minimal'),
      frozenThermal: revision('frozen-thermal', 'tax-invoice-thermal58'),
      livePrint: assignment('live-print', 'tax-invoice-modern'),
      livePdf: assignment('live-pdf', 'tax-invoice-erp'),
      liveThermal: assignment('live-thermal', 'tax-invoice-thermal80'),
    });
    expect(outputs.print?.templateId).toBe('tax-invoice-classic');
    expect(outputs.print?.stampUrl).toBe('frozen-print-stamp');
    expect(outputs.print?.logoHeight).toBe(42);
    expect(outputs.pdf?.templateId).toBe('tax-invoice-minimal');
    expect(outputs.thermal?.templateId).toBe('tax-invoice-thermal58');
    expect(outputs.pdfSharesPrintRoot).toBe(false);
  });

  it('يسقط PDF المرحّل إلى لقطة print التاريخية عند غياب لقطة pdf', () => {
    const outputs = resolveDocumentOutputTemplates({
      documentType: 'tax_invoice',
      isPosted: true,
      frozenPrint: revision('frozen-print', 'tax-invoice-erp'),
    });
    expect(outputs.pdf?.templateId).toBe('tax-invoice-erp');
    expect(outputs.pdfSharesPrintRoot).toBe(true);
    expect(outputs.thermal).toBeNull();
  });

  it('لا يعيد تفسير فاتورة مرحّلة بتعيين حي لاحق', () => {
    const outputs = resolveDocumentOutputTemplates({
      documentType: 'tax_invoice',
      isPosted: true,
      frozenPrint: revision('frozen-print', 'tax-invoice-classic'),
      livePrint: assignment('newer-print', 'tax-invoice-modern'),
    });
    expect(outputs.print?.templateId).toBe('tax-invoice-classic');
    expect(outputs.print?.footerText).toBe('frozen-print-footer');
  });

  it('يستخدم تعيين tax_invoice الاحتياطي للمسودة المبسطة بلا تعيين صريح', () => {
    const outputs = resolveDocumentOutputTemplates({
      documentType: 'simplified_tax_invoice',
      isPosted: false,
      fallbackLivePrint: assignment('legacy-print', 'tax-invoice-retail'),
      fallbackLivePdf: assignment('legacy-pdf', 'tax-invoice-minimal'),
      fallbackLiveThermal: assignment('legacy-thermal', 'tax-invoice-thermal80'),
    });
    expect(outputs.print?.templateId).toBe('tax-invoice-retail');
    expect(outputs.pdf?.templateId).toBe('tax-invoice-minimal');
    expect(outputs.thermal?.templateId).toBe('tax-invoice-thermal80');
  });

  it('يفضّل تعيين المبسطة الصريح على احتياطي tax_invoice', () => {
    const outputs = resolveDocumentOutputTemplates({
      documentType: 'simplified_tax_invoice',
      isPosted: false,
      livePrint: assignment('simple-print', 'tax-invoice-modern'),
      fallbackLivePrint: assignment('legacy-print', 'tax-invoice-classic'),
    });
    expect(outputs.print?.templateId).toBe('tax-invoice-modern');
  });
});

describe('thermalPaperForTemplate', () => {
  it('يدعم 58mm و80mm ويرفض القالب غير الحراري', () => {
    expect(thermalPaperForTemplate('tax-invoice-thermal58')?.paperId).toBe('thermal_58');
    expect(thermalPaperForTemplate('tax-invoice-thermal80')?.paper.widthMm).toBe(80);
    expect(thermalPaperForTemplate('tax-invoice-classic')).toBeNull();
    expect(thermalPaperForTemplate(null)).toBeNull();
  });
});

describe('resolveDocumentOutputTemplates for quotation and purchase_order', () => {
  it('يحل print وpdf المستقلين لمسودة عرض السعر', () => {
    const outputs = resolveDocumentOutputTemplates({
      documentType: 'quotation',
      isPosted: false,
      livePrint: assignment('quote-print', 'tax-invoice-classic'),
      livePdf: assignment('quote-pdf', 'tax-invoice-minimal', { footer_text: 'PDF عرض' }),
    });
    expect(outputs.print?.templateId).toBe('tax-invoice-classic');
    expect(outputs.pdf?.templateId).toBe('tax-invoice-minimal');
    expect(outputs.pdf?.footerText).toBe('PDF عرض');
    expect(outputs.pdfSharesPrintRoot).toBe(false);
    expect(outputs.thermal).toBeNull();
  });

  it('يسقط PDF عرض السعر إلى print عند غياب تعيين pdf', () => {
    const outputs = resolveDocumentOutputTemplates({
      documentType: 'quotation',
      isPosted: false,
      livePrint: assignment('quote-print', 'tax-invoice-modern'),
    });
    expect(outputs.pdf?.templateId).toBe('tax-invoice-modern');
    expect(outputs.pdfSharesPrintRoot).toBe(true);
  });

  it('يثبّت لقطات عرض السعر الصادر ويتجاهل التعيين الحي', () => {
    const outputs = resolveDocumentOutputTemplates({
      documentType: 'quotation',
      isPosted: true,
      frozenPrint: revision('issued-print', 'tax-invoice-classic'),
      frozenPdf: revision('issued-pdf', 'tax-invoice-erp'),
      livePrint: assignment('newer-print', 'tax-invoice-retail'),
      livePdf: assignment('newer-pdf', 'tax-invoice-minimal'),
    });
    expect(outputs.print?.templateId).toBe('tax-invoice-classic');
    expect(outputs.print?.stampUrl).toBe('issued-print-stamp');
    expect(outputs.pdf?.templateId).toBe('tax-invoice-erp');
    expect(outputs.pdfSharesPrintRoot).toBe(false);
  });

  it('يحل print وpdf المستقلين لمسودة أمر الشراء', () => {
    const outputs = resolveDocumentOutputTemplates({
      documentType: 'purchase_order',
      isPosted: false,
      livePrint: assignment('po-print', 'tax-invoice-classic'),
      livePdf: assignment('po-pdf', 'tax-invoice-minimal'),
    });
    expect(outputs.print?.templateId).toBe('tax-invoice-classic');
    expect(outputs.pdf?.templateId).toBe('tax-invoice-minimal');
    expect(outputs.pdfSharesPrintRoot).toBe(false);
  });

  it('يثبّت لقطات أمر الشراء الصادر بلا سقوط حراري إلى print', () => {
    const outputs = resolveDocumentOutputTemplates({
      documentType: 'purchase_order',
      isPosted: true,
      frozenPrint: revision('po-frozen-print', 'tax-invoice-modern'),
      livePrint: assignment('po-live', 'tax-invoice-classic'),
    });
    expect(outputs.print?.templateId).toBe('tax-invoice-modern');
    expect(outputs.pdf?.templateId).toBe('tax-invoice-modern');
    expect(outputs.pdfSharesPrintRoot).toBe(true);
    expect(outputs.thermal).toBeNull();
  });
});

describe('resolveDocumentOutputTemplates for credit_note', () => {
  it('يحل print وpdf المستقلين لمسودة الإشعار الدائن', () => {
    const outputs = resolveDocumentOutputTemplates({
      documentType: 'credit_note',
      isPosted: false,
      livePrint: assignment('cn-print', 'tax-invoice-classic'),
      livePdf: assignment('cn-pdf', 'tax-invoice-minimal', { footer_text: 'PDF إشعار' }),
    });
    expect(outputs.print?.templateId).toBe('tax-invoice-classic');
    expect(outputs.pdf?.templateId).toBe('tax-invoice-minimal');
    expect(outputs.pdf?.footerText).toBe('PDF إشعار');
    expect(outputs.pdfSharesPrintRoot).toBe(false);
    expect(outputs.thermal).toBeNull();
  });

  it('يسقط PDF الإشعار الدائن إلى print عند غياب تعيين pdf', () => {
    const outputs = resolveDocumentOutputTemplates({
      documentType: 'credit_note',
      isPosted: false,
      livePrint: assignment('cn-print', 'tax-invoice-modern'),
    });
    expect(outputs.pdf?.templateId).toBe('tax-invoice-modern');
    expect(outputs.pdfSharesPrintRoot).toBe(true);
  });

  it('يثبّت لقطات الإشعار الدائن المرحّل ويتجاهل التعيين الحي', () => {
    const outputs = resolveDocumentOutputTemplates({
      documentType: 'credit_note',
      isPosted: true,
      frozenPrint: revision('posted-print', 'tax-invoice-classic'),
      frozenPdf: revision('posted-pdf', 'tax-invoice-erp'),
      livePrint: assignment('newer-print', 'tax-invoice-retail'),
      livePdf: assignment('newer-pdf', 'tax-invoice-minimal'),
    });
    expect(outputs.print?.templateId).toBe('tax-invoice-classic');
    expect(outputs.print?.stampUrl).toBe('posted-print-stamp');
    expect(outputs.pdf?.templateId).toBe('tax-invoice-erp');
    expect(outputs.pdfSharesPrintRoot).toBe(false);
  });

  it('يسقط PDF المرحّل إلى لقطة print التاريخية عند غياب لقطة pdf', () => {
    const outputs = resolveDocumentOutputTemplates({
      documentType: 'credit_note',
      isPosted: true,
      frozenPrint: revision('posted-print-only', 'tax-invoice-modern'),
      livePrint: assignment('live-after-post', 'tax-invoice-classic'),
    });
    expect(outputs.print?.templateId).toBe('tax-invoice-modern');
    expect(outputs.pdf?.templateId).toBe('tax-invoice-modern');
    expect(outputs.pdfSharesPrintRoot).toBe(true);
    expect(outputs.thermal).toBeNull();
  });
});

describe('resolveDocumentOutputTemplates for debit_note', () => {
  it('يحل print وpdf المستقلين لمسودة الإشعار المدين', () => {
    const outputs = resolveDocumentOutputTemplates({
      documentType: 'debit_note',
      isPosted: false,
      livePrint: assignment('dn-print', 'tax-invoice-classic'),
      livePdf: assignment('dn-pdf', 'tax-invoice-minimal', { footer_text: 'PDF إشعار مدين' }),
    });
    expect(outputs.print?.templateId).toBe('tax-invoice-classic');
    expect(outputs.pdf?.templateId).toBe('tax-invoice-minimal');
    expect(outputs.pdf?.footerText).toBe('PDF إشعار مدين');
    expect(outputs.pdfSharesPrintRoot).toBe(false);
    expect(outputs.thermal).toBeNull();
  });

  it('يسقط PDF الإشعار المدين إلى print عند غياب تعيين pdf', () => {
    const outputs = resolveDocumentOutputTemplates({
      documentType: 'debit_note',
      isPosted: false,
      livePrint: assignment('dn-print', 'tax-invoice-modern'),
    });
    expect(outputs.pdf?.templateId).toBe('tax-invoice-modern');
    expect(outputs.pdfSharesPrintRoot).toBe(true);
  });

  it('يثبّت لقطات الإشعار المدين المرحّل ويتجاهل التعيين الحي', () => {
    const outputs = resolveDocumentOutputTemplates({
      documentType: 'debit_note',
      isPosted: true,
      frozenPrint: revision('posted-print', 'tax-invoice-classic'),
      frozenPdf: revision('posted-pdf', 'tax-invoice-erp'),
      livePrint: assignment('newer-print', 'tax-invoice-retail'),
      livePdf: assignment('newer-pdf', 'tax-invoice-minimal'),
    });
    expect(outputs.print?.templateId).toBe('tax-invoice-classic');
    expect(outputs.print?.stampUrl).toBe('posted-print-stamp');
    expect(outputs.pdf?.templateId).toBe('tax-invoice-erp');
    expect(outputs.pdfSharesPrintRoot).toBe(false);
  });

  it('يسقط PDF المرحّل إلى لقطة print التاريخية عند غياب لقطة pdf', () => {
    const outputs = resolveDocumentOutputTemplates({
      documentType: 'debit_note',
      isPosted: true,
      frozenPrint: revision('posted-print-only', 'tax-invoice-modern'),
      livePrint: assignment('live-after-post', 'tax-invoice-classic'),
    });
    expect(outputs.print?.templateId).toBe('tax-invoice-modern');
    expect(outputs.pdf?.templateId).toBe('tax-invoice-modern');
    expect(outputs.pdfSharesPrintRoot).toBe(true);
    expect(outputs.thermal).toBeNull();
  });
});

describe('تجميد Modern التاريخي مقابل Modern V2', () => {
  it('لا يعيد تفسير قالب A4 ولا يضيف alias من modern إلى v2', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/modules/print-templates/services/document-output-template.ts'), 'utf8');
    expect(source).not.toContain('tax-invoice-modern-v2');
    expect(source).not.toMatch(/modern['"]\s*\?\s*['"]tax-invoice-modern-v2/);
  });

  it('يثبّت فاتورة مرحّلة على tax-invoice-modern ولا يتبع تعيين V2 الحي', () => {
    const outputs = resolveDocumentOutputTemplates({
      documentType: 'tax_invoice',
      isPosted: true,
      frozenPrint: revision('frozen-legacy-modern', 'tax-invoice-modern'),
      livePrint: assignment('live-v2', 'tax-invoice-modern-v2'),
      livePdf: assignment('live-v2-pdf', 'tax-invoice-modern-v2'),
    });
    expect(outputs.print?.templateId).toBe('tax-invoice-modern');
    expect(outputs.pdf?.templateId).toBe('tax-invoice-modern');
    expect(getTemplate(outputs.print?.templateId).id).toBe('tax-invoice-modern');
    expect(getTemplate(outputs.print?.templateId).component).not.toBe(getTemplate('tax-invoice-modern-v2').component);
  });

  it('يثبّت فاتورة مرحّلة على tax-invoice-modern-v2 ولا يرجع إلى التاريخي الحي', () => {
    const outputs = resolveDocumentOutputTemplates({
      documentType: 'tax_invoice',
      isPosted: true,
      frozenPrint: revision('frozen-v2', 'tax-invoice-modern-v2'),
      livePrint: assignment('live-legacy', 'tax-invoice-modern'),
    });
    expect(outputs.print?.templateId).toBe('tax-invoice-modern-v2');
    expect(outputs.pdf?.templateId).toBe('tax-invoice-modern-v2');
    expect(getTemplate(outputs.print?.templateId).id).toBe('tax-invoice-modern-v2');
  });

  it('يجعل المسودة تتبع التعيين الحي: modern التاريخي أو V2', () => {
    const legacyDraft = resolveDocumentOutputTemplates({
      documentType: 'tax_invoice',
      isPosted: false,
      livePrint: assignment('draft-legacy', 'tax-invoice-modern'),
    });
    expect(legacyDraft.print?.templateId).toBe('tax-invoice-modern');

    const v2Draft = resolveDocumentOutputTemplates({
      documentType: 'tax_invoice',
      isPosted: false,
      livePrint: assignment('draft-v2', 'tax-invoice-modern-v2'),
    });
    expect(v2Draft.print?.templateId).toBe('tax-invoice-modern-v2');
    expect(v2Draft.pdf?.templateId).toBe('tax-invoice-modern-v2');
    expect(v2Draft.pdfSharesPrintRoot).toBe(true);
  });
});

describe('تجميد ERP التاريخي مقابل ERP V2', () => {
  it('لا يعيد تفسير قالب A4 ولا يضيف alias من erp إلى v2', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/modules/print-templates/services/document-output-template.ts'), 'utf8');
    expect(source).not.toContain('tax-invoice-erp-v2');
    expect(source).not.toMatch(/erp['"]\s*\?\s*['"]tax-invoice-erp-v2/);
  });

  it('يثبّت فاتورة مرحّلة على tax-invoice-erp ولا يتبع تعيين V2 الحي', () => {
    const outputs = resolveDocumentOutputTemplates({
      documentType: 'tax_invoice',
      isPosted: true,
      frozenPrint: revision('frozen-legacy-erp', 'tax-invoice-erp'),
      livePrint: assignment('live-erp-v2', 'tax-invoice-erp-v2'),
      livePdf: assignment('live-erp-v2-pdf', 'tax-invoice-erp-v2'),
    });
    expect(outputs.print?.templateId).toBe('tax-invoice-erp');
    expect(outputs.pdf?.templateId).toBe('tax-invoice-erp');
    expect(getTemplate(outputs.print?.templateId).id).toBe('tax-invoice-erp');
    expect(getTemplate(outputs.print?.templateId).component).not.toBe(getTemplate('tax-invoice-erp-v2').component);
  });

  it('يثبّت فاتورة مرحّلة على tax-invoice-erp-v2 ولا يرجع إلى التاريخي الحي', () => {
    const outputs = resolveDocumentOutputTemplates({
      documentType: 'tax_invoice',
      isPosted: true,
      frozenPrint: revision('frozen-erp-v2', 'tax-invoice-erp-v2'),
      livePrint: assignment('live-legacy-erp', 'tax-invoice-erp'),
    });
    expect(outputs.print?.templateId).toBe('tax-invoice-erp-v2');
    expect(outputs.pdf?.templateId).toBe('tax-invoice-erp-v2');
    expect(getTemplate(outputs.print?.templateId).id).toBe('tax-invoice-erp-v2');
  });

  it('يجعل المسودة تتبع التعيين الحي: erp التاريخي أو V2', () => {
    const legacyDraft = resolveDocumentOutputTemplates({
      documentType: 'tax_invoice',
      isPosted: false,
      livePrint: assignment('draft-legacy-erp', 'tax-invoice-erp'),
    });
    expect(legacyDraft.print?.templateId).toBe('tax-invoice-erp');

    const v2Draft = resolveDocumentOutputTemplates({
      documentType: 'tax_invoice',
      isPosted: false,
      livePrint: assignment('draft-erp-v2', 'tax-invoice-erp-v2'),
    });
    expect(v2Draft.print?.templateId).toBe('tax-invoice-erp-v2');
    expect(v2Draft.pdf?.templateId).toBe('tax-invoice-erp-v2');
    expect(v2Draft.pdfSharesPrintRoot).toBe(true);
  });
});

describe('تجميد Classic التاريخي مقابل Classic V2', () => {
  it('لا يعيد تفسير قالب A4 ولا يضيف alias من classic إلى v2', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/modules/print-templates/services/document-output-template.ts'), 'utf8');
    expect(source).not.toContain('tax-invoice-classic-v2');
    expect(source).not.toMatch(/classic['"]\s*\?\s*['"]tax-invoice-classic-v2/);
  });

  it('يثبّت فاتورة مرحّلة على tax-invoice-classic ولا يتبع تعيين V2 الحي', () => {
    const outputs = resolveDocumentOutputTemplates({
      documentType: 'tax_invoice',
      isPosted: true,
      frozenPrint: revision('frozen-legacy-classic', 'tax-invoice-classic'),
      livePrint: assignment('live-classic-v2', 'tax-invoice-classic-v2'),
      livePdf: assignment('live-classic-v2-pdf', 'tax-invoice-classic-v2'),
    });
    expect(outputs.print?.templateId).toBe('tax-invoice-classic');
    expect(outputs.pdf?.templateId).toBe('tax-invoice-classic');
    expect(getTemplate(outputs.print?.templateId).id).toBe('tax-invoice-classic');
    expect(getTemplate(outputs.print?.templateId).component).not.toBe(getTemplate('tax-invoice-classic-v2').component);
  });

  it('يثبّت فاتورة مرحّلة على tax-invoice-classic-v2 ولا يرجع إلى التاريخي الحي', () => {
    const outputs = resolveDocumentOutputTemplates({
      documentType: 'tax_invoice',
      isPosted: true,
      frozenPrint: revision('frozen-classic-v2', 'tax-invoice-classic-v2'),
      livePrint: assignment('live-legacy-classic', 'tax-invoice-classic'),
    });
    expect(outputs.print?.templateId).toBe('tax-invoice-classic-v2');
    expect(outputs.pdf?.templateId).toBe('tax-invoice-classic-v2');
    expect(getTemplate(outputs.print?.templateId).id).toBe('tax-invoice-classic-v2');
  });

  it('يجعل المسودة تتبع التعيين الحي: classic التاريخي أو V2', () => {
    const legacyDraft = resolveDocumentOutputTemplates({
      documentType: 'tax_invoice',
      isPosted: false,
      livePrint: assignment('draft-legacy-classic', 'tax-invoice-classic'),
    });
    expect(legacyDraft.print?.templateId).toBe('tax-invoice-classic');

    const v2Draft = resolveDocumentOutputTemplates({
      documentType: 'tax_invoice',
      isPosted: false,
      livePrint: assignment('draft-classic-v2', 'tax-invoice-classic-v2'),
    });
    expect(v2Draft.print?.templateId).toBe('tax-invoice-classic-v2');
    expect(v2Draft.pdf?.templateId).toBe('tax-invoice-classic-v2');
    expect(v2Draft.pdfSharesPrintRoot).toBe(true);
  });
});

describe('تجميد Minimal التاريخي مقابل Minimal V2', () => {
  it('لا يعيد تفسير قالب A4 ولا يضيف alias من minimal إلى v2', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/modules/print-templates/services/document-output-template.ts'), 'utf8');
    expect(source).not.toContain('tax-invoice-minimal-v2');
    expect(source).not.toMatch(/minimal['"]\s*\?\s*['"]tax-invoice-minimal-v2/);
  });

  it('يثبّت فاتورة مرحّلة على tax-invoice-minimal ولا يتبع تعيين V2 الحي', () => {
    const outputs = resolveDocumentOutputTemplates({
      documentType: 'tax_invoice',
      isPosted: true,
      frozenPrint: revision('frozen-legacy-minimal', 'tax-invoice-minimal'),
      livePrint: assignment('live-minimal-v2', 'tax-invoice-minimal-v2'),
      livePdf: assignment('live-minimal-v2-pdf', 'tax-invoice-minimal-v2'),
    });
    expect(outputs.print?.templateId).toBe('tax-invoice-minimal');
    expect(outputs.pdf?.templateId).toBe('tax-invoice-minimal');
    expect(getTemplate(outputs.print?.templateId).id).toBe('tax-invoice-minimal');
    expect(getTemplate(outputs.print?.templateId).component).not.toBe(getTemplate('tax-invoice-minimal-v2').component);
  });

  it('يثبّت فاتورة مرحّلة على tax-invoice-minimal-v2 ولا يرجع إلى التاريخي الحي', () => {
    const outputs = resolveDocumentOutputTemplates({
      documentType: 'tax_invoice',
      isPosted: true,
      frozenPrint: revision('frozen-minimal-v2', 'tax-invoice-minimal-v2'),
      livePrint: assignment('live-legacy-minimal', 'tax-invoice-minimal'),
    });
    expect(outputs.print?.templateId).toBe('tax-invoice-minimal-v2');
    expect(outputs.pdf?.templateId).toBe('tax-invoice-minimal-v2');
    expect(getTemplate(outputs.print?.templateId).id).toBe('tax-invoice-minimal-v2');
  });

  it('يجعل المسودة تتبع التعيين الحي: minimal التاريخي أو V2', () => {
    const legacyDraft = resolveDocumentOutputTemplates({
      documentType: 'tax_invoice',
      isPosted: false,
      livePrint: assignment('draft-legacy-minimal', 'tax-invoice-minimal'),
    });
    expect(legacyDraft.print?.templateId).toBe('tax-invoice-minimal');

    const v2Draft = resolveDocumentOutputTemplates({
      documentType: 'tax_invoice',
      isPosted: false,
      livePrint: assignment('draft-minimal-v2', 'tax-invoice-minimal-v2'),
    });
    expect(v2Draft.print?.templateId).toBe('tax-invoice-minimal-v2');
    expect(v2Draft.pdf?.templateId).toBe('tax-invoice-minimal-v2');
    expect(v2Draft.pdfSharesPrintRoot).toBe(true);
  });
});

describe('تجميد Retail التاريخي مقابل Retail V2', () => {
  it('لا يعيد تفسير قالب A4 ولا يضيف alias من retail إلى v2', () => {
    const source = readFileSync(resolve(process.cwd(), 'src/modules/print-templates/services/document-output-template.ts'), 'utf8');
    expect(source).not.toContain('tax-invoice-retail-v2');
    expect(source).not.toMatch(/retail['"]\s*\?\s*['"]tax-invoice-retail-v2/);
  });

  it('يثبّت فاتورة مرحّلة على tax-invoice-retail ولا يتبع تعيين V2 الحي', () => {
    const outputs = resolveDocumentOutputTemplates({
      documentType: 'tax_invoice',
      isPosted: true,
      frozenPrint: revision('frozen-legacy-retail', 'tax-invoice-retail'),
      livePrint: assignment('live-retail-v2', 'tax-invoice-retail-v2'),
      livePdf: assignment('live-retail-v2-pdf', 'tax-invoice-retail-v2'),
    });
    expect(outputs.print?.templateId).toBe('tax-invoice-retail');
    expect(outputs.pdf?.templateId).toBe('tax-invoice-retail');
    expect(getTemplate(outputs.print?.templateId).id).toBe('tax-invoice-retail');
    expect(getTemplate(outputs.print?.templateId).component).not.toBe(getTemplate('tax-invoice-retail-v2').component);
  });

  it('يثبّت فاتورة مرحّلة على tax-invoice-retail-v2 ولا يرجع إلى التاريخي الحي', () => {
    const outputs = resolveDocumentOutputTemplates({
      documentType: 'tax_invoice',
      isPosted: true,
      frozenPrint: revision('frozen-retail-v2', 'tax-invoice-retail-v2'),
      livePrint: assignment('live-legacy-retail', 'tax-invoice-retail'),
    });
    expect(outputs.print?.templateId).toBe('tax-invoice-retail-v2');
    expect(outputs.pdf?.templateId).toBe('tax-invoice-retail-v2');
    expect(getTemplate(outputs.print?.templateId).id).toBe('tax-invoice-retail-v2');
  });

  it('يجعل المسودة تتبع التعيين الحي: retail التاريخي أو V2', () => {
    const legacyDraft = resolveDocumentOutputTemplates({
      documentType: 'tax_invoice',
      isPosted: false,
      livePrint: assignment('draft-legacy-retail', 'tax-invoice-retail'),
    });
    expect(legacyDraft.print?.templateId).toBe('tax-invoice-retail');

    const v2Draft = resolveDocumentOutputTemplates({
      documentType: 'tax_invoice',
      isPosted: false,
      livePrint: assignment('draft-retail-v2', 'tax-invoice-retail-v2'),
    });
    expect(v2Draft.print?.templateId).toBe('tax-invoice-retail-v2');
    expect(v2Draft.pdf?.templateId).toBe('tax-invoice-retail-v2');
    expect(v2Draft.pdfSharesPrintRoot).toBe(true);
  });
});

describe('resolvedTemplatesEqual', () => {
  it('يميّز تعريفين مختلفين', () => {
    const classic = resolveDocumentOutputTemplates({
      documentType: 'tax_invoice',
      isPosted: false,
      livePrint: assignment('a', 'tax-invoice-classic'),
    }).print;
    const minimal = resolveDocumentOutputTemplates({
      documentType: 'tax_invoice',
      isPosted: false,
      livePrint: assignment('b', 'tax-invoice-minimal'),
    }).print;
    expect(resolvedTemplatesEqual(classic, classic)).toBe(true);
    expect(resolvedTemplatesEqual(classic, minimal)).toBe(false);
  });
});
