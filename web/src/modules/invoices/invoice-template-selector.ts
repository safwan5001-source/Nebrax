import { getTemplate, templateSupportsDocumentType } from '@/modules/documents/registry/templates';
import type { DocumentTypeId } from '@/modules/documents/types';
import {
  invoiceCatalogDocumentType,
  thermalPaperForTemplate,
  type InvoiceZatcaDocumentType,
} from '@/modules/print-templates/services/document-output-template';

export interface InvoiceDesignDefinition {
  template_id?: string;
  theme_id?: string;
  show_logo?: boolean;
  layout?: unknown;
  footer_text?: string;
}

export interface InvoiceDesignRevision {
  id: string;
  version?: number;
  status?: string;
  document_types?: string[];
  definition?: InvoiceDesignDefinition | null;
}

export interface InvoiceLibraryTemplate {
  id: string;
  name: string;
  status?: string;
  document_types?: string[];
  published_revision_id?: string | null;
  published_revision?: InvoiceDesignRevision | null;
}

/** أنواع الكتالوج المقبولة لتجاوز تصميم فاتورة: المبسطة تقبل قوالب tax_invoice كما يسقط التعيين الحي. */
export function invoiceDesignCompatibleTypes(catalog: DocumentTypeId): DocumentTypeId[] {
  return catalog === 'simplified_tax_invoice'
    ? ['simplified_tax_invoice', 'tax_invoice']
    : ['tax_invoice'];
}

export function invoiceDesignCatalogType(zatca: InvoiceZatcaDocumentType): DocumentTypeId {
  return invoiceCatalogDocumentType(zatca);
}

export function isThermalPrintDefinition(definition: InvoiceDesignDefinition | null | undefined): boolean {
  const id = definition?.template_id;
  return !!id && thermalPaperForTemplate(id) !== null;
}

export function revisionSupportsInvoiceDesign(
  documentTypes: readonly string[] | null | undefined,
  definition: InvoiceDesignDefinition | null | undefined,
  catalog: DocumentTypeId,
): boolean {
  if (isThermalPrintDefinition(definition)) return false;
  const types = documentTypes ?? [];
  const compatible = invoiceDesignCompatibleTypes(catalog);
  if (!compatible.some((type) => types.includes(type))) return false;
  const templateId = definition?.template_id;
  if (!templateId) return true;
  return compatible.some((type) => templateSupportsDocumentType(getTemplate(templateId), type));
}

export function publishedInvoiceDesignTemplates(
  templates: readonly InvoiceLibraryTemplate[],
  catalog: DocumentTypeId,
): InvoiceLibraryTemplate[] {
  return templates.filter((template) => {
    const revision = template.published_revision;
    if (!revision || !template.published_revision_id) return false;
    if (revision.status && revision.status !== 'published') return false;
    return revisionSupportsInvoiceDesign(
      revision.document_types ?? template.document_types,
      revision.definition,
      catalog,
    );
  });
}

export function selectedInvoiceDesignIsCompatible(
  templates: readonly InvoiceLibraryTemplate[],
  catalog: DocumentTypeId,
  overrideRevisionId: string | null,
): boolean {
  if (!overrideRevisionId) return true;
  return publishedInvoiceDesignTemplates(templates, catalog).some((template) => (
    template.published_revision_id === overrideRevisionId
    || template.published_revision?.id === overrideRevisionId
  ));
}

export function findInvoiceDesignTemplate(
  templates: readonly InvoiceLibraryTemplate[],
  revisionId: string | null | undefined,
): InvoiceLibraryTemplate | null {
  if (!revisionId) return null;
  return templates.find((template) => (
    template.published_revision_id === revisionId
    || template.published_revision?.id === revisionId
  )) ?? null;
}
