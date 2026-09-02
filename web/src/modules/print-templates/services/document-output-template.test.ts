import { describe, expect, it } from 'vitest';
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
