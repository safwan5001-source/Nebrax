import { getDocumentPreviewModel } from '@/modules/documents/registry/document-samples';
import { getDefaultDocumentLayout, DOCUMENT_TYPE_REGISTRY } from '@/modules/documents/registry/document-types';
import { THEME_IDS } from '@/modules/documents/themes';
import type { DocSectionLayoutItem, DocumentModel, DocumentTypeId, ThemeId } from '@/modules/documents/types';

export interface RevisionVisualPreviewSource {
  id: string;
  version: number;
  document_types: string[];
  definition: object;
}

export interface RevisionVisualPreview {
  documentType: DocumentTypeId;
  model: DocumentModel;
  templateId: string;
  themeId: ThemeId;
  showLogo: boolean;
  layout: DocSectionLayoutItem[];
  rootId: string;
}

interface PreviewDefinition {
  template_id?: unknown;
  theme_id?: unknown;
  show_logo?: unknown;
  layout?: unknown;
  footer_text?: unknown;
}

function isDocumentTypeId(value: string | undefined): value is DocumentTypeId {
  return value !== undefined && Object.hasOwn(DOCUMENT_TYPE_REGISTRY, value);
}

function isThemeId(value: unknown): value is ThemeId {
  return typeof value === 'string' && THEME_IDS.includes(value as ThemeId);
}

function isLayout(value: unknown): value is DocSectionLayoutItem[] {
  return Array.isArray(value);
}

/**
 * يحوّل مراجعة محفوظة إلى بيانات آمنة لمعاينة المقارنة فقط. لا يقرأ بيانات
 * مستند أو عميل حقيقي، ولا يكتب على المراجعة، وتبقى القيم غير الموجودة على
 * بدائل السجل حتى تظل المراجعات القديمة قابلة للعرض.
 */
export function getRevisionVisualPreview(revision: RevisionVisualPreviewSource): RevisionVisualPreview {
  const documentType = isDocumentTypeId(revision.document_types[0])
    ? revision.document_types[0]
    : 'tax_invoice';
  const definition = revision.definition as PreviewDefinition;
  const model = getDocumentPreviewModel(documentType);
  const footerText = typeof definition.footer_text === 'string' ? definition.footer_text : undefined;

  return {
    documentType,
    model: footerText ? { ...model, footerText } : model,
    templateId: typeof definition.template_id === 'string' ? definition.template_id : 'tax-invoice-classic',
    themeId: isThemeId(definition.theme_id) ? definition.theme_id : 'blue',
    showLogo: definition.show_logo !== false,
    layout: isLayout(definition.layout) ? definition.layout : getDefaultDocumentLayout(documentType),
    rootId: `print-template-revision-preview-${revision.id}`,
  };
}
