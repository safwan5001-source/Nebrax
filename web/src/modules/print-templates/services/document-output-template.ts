import { PAPER_SIZES } from '@/modules/documents/constants/paper';
import { getTemplate } from '@/modules/documents/registry/templates';
import type { DocumentTypeId } from '@/modules/documents/types';
import { resolveFrozenOutputDefinition, type FrozenOutputTemplateRevision } from './frozen-output-template';
import {
  resolveLiveTemplateDefinition,
  resolveTemplateRevisionDefinition,
  type LivePrintTemplateAssignment,
  type LiveTemplateRevision,
  type ResolvedLiveTemplate,
} from './live-template-definition';

export type InvoiceZatcaDocumentType = 'standard' | 'simplified' | string | null | undefined;

export interface DocumentOutputTemplates {
  print: ResolvedLiveTemplate | null;
  pdf: ResolvedLiveTemplate | null;
  thermal: ResolvedLiveTemplate | null;
  /** إذا تطابق تعريف PDF مع الطباعة يُلتقط `#print-root` دون جذر DOM ثانٍ. */
  pdfSharesPrintRoot: boolean;
}

/**
 * نوع كتالوج القوالب المقابل لنوع فاتورة ZATCA. المبسطة مستقلة عن الضريبية
 * القياسية؛ لا سقوط عبر الأنواع هنا.
 */
export function invoiceCatalogDocumentType(zatca: InvoiceZatcaDocumentType): DocumentTypeId {
  return zatca === 'simplified' ? 'simplified_tax_invoice' : 'tax_invoice';
}

export function resolvedTemplatesEqual(
  left: ResolvedLiveTemplate | null | undefined,
  right: ResolvedLiveTemplate | null | undefined,
): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return JSON.stringify(left) === JSON.stringify(right);
}

function revisionFromDefinition(
  definition: LiveTemplateRevision['definition'] | null | undefined,
): LiveTemplateRevision | null {
  return definition ? { id: 'frozen-output', definition } : null;
}

function frozenRevision(
  revision: LiveTemplateRevision | null | undefined,
): FrozenOutputTemplateRevision<Record<string, unknown>> | null {
  const definition = revision?.definition;
  if (!definition || typeof definition !== 'object') return null;
  return { definition: { ...definition } as Record<string, unknown> };
}

/**
 * يحلّ مراجعات الإخراج الثلاثة لعارض المستند نفسه.
 *
 * المرحّل: اللقطات المثبتة فقط — PDF يفضّل لقطة pdf ثم لقطة print التاريخية.
 * المسودة: تجاوز المستند إن وُجد، وإلا التعيينات الحية لكل usage، وPDF بلا تعيين
 * يسقط إلى print الحي. الحراري لا يسقط إلى print أبداً ولا يقرأ التجاوز.
 *
 * `fallbackLive*` اختياري لتوافق تعيينات `tax_invoice` القائمة حين يكون نوع
 * الكتالوج `simplified_tax_invoice` بلا تعيين صريح بعد.
 *
 * `draftOverridePrint` / `draftOverridePdf` يتجاوزان التعيين الحي للمسودة فقط.
 * المسار المرحّل يتجاهلهما ويقرأ اللقطات المجمّدة حصراً.
 */
export function resolveDocumentOutputTemplates(input: {
  documentType: DocumentTypeId;
  isPosted: boolean;
  frozenPrint?: LiveTemplateRevision | null;
  frozenPdf?: LiveTemplateRevision | null;
  frozenThermal?: LiveTemplateRevision | null;
  livePrint?: LivePrintTemplateAssignment | null;
  livePdf?: LivePrintTemplateAssignment | null;
  liveThermal?: LivePrintTemplateAssignment | null;
  fallbackLivePrint?: LivePrintTemplateAssignment | null;
  fallbackLivePdf?: LivePrintTemplateAssignment | null;
  fallbackLiveThermal?: LivePrintTemplateAssignment | null;
  draftOverridePrint?: LiveTemplateRevision | null;
  draftOverridePdf?: LiveTemplateRevision | null;
}): DocumentOutputTemplates {
  const print = input.isPosted
    ? resolveTemplateRevisionDefinition(input.frozenPrint, input.documentType)
    : resolveTemplateRevisionDefinition(input.draftOverridePrint, input.documentType)
      ?? resolveLiveTemplateDefinition(input.livePrint, input.documentType)
      ?? resolveLiveTemplateDefinition(input.fallbackLivePrint, input.documentType);

  const pdfDirect = input.isPosted
    ? resolveTemplateRevisionDefinition(
      revisionFromDefinition(resolveFrozenOutputDefinition(frozenRevision(input.frozenPdf), frozenRevision(input.frozenPrint))),
      input.documentType,
    )
    : resolveTemplateRevisionDefinition(input.draftOverridePdf, input.documentType)
      ?? resolveLiveTemplateDefinition(input.livePdf, input.documentType)
      ?? resolveLiveTemplateDefinition(input.fallbackLivePdf, input.documentType);

  const pdf = pdfDirect ?? print;
  const thermal = input.isPosted
    ? resolveTemplateRevisionDefinition(input.frozenThermal, input.documentType)
    : resolveLiveTemplateDefinition(input.liveThermal, input.documentType)
      ?? resolveLiveTemplateDefinition(input.fallbackLiveThermal, input.documentType);

  return {
    print,
    pdf,
    thermal,
    pdfSharesPrintRoot: resolvedTemplatesEqual(print, pdf),
  };
}

export function thermalPaperForTemplate(templateId: string | null | undefined): {
  templateId: string;
  paperId: 'thermal_58' | 'thermal_80';
  paper: { widthMm: number; heightMm: number };
} | null {
  if (!templateId) return null;
  const paperId = getTemplate(templateId).supportedPaper.find((candidate) => (
    candidate === 'thermal_58' || candidate === 'thermal_80'
  ));
  if (paperId !== 'thermal_58' && paperId !== 'thermal_80') return null;
  const size = PAPER_SIZES[paperId];
  return {
    templateId,
    paperId,
    paper: { widthMm: size.widthMm, heightMm: size.heightMm },
  };
}
