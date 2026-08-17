import { getDefaultDocumentLayout } from '@/modules/documents/registry/document-types';
import { getTemplate } from '@/modules/documents/registry/templates';
import type { DocSectionLayoutItem, DocumentTypeId, ThemeId } from '@/modules/documents/types';

export interface LiveTemplateDefinition {
  template_id?: string;
  theme_id?: ThemeId;
  show_logo?: boolean;
  layout?: DocSectionLayoutItem[];
  footer_text?: string;
  terms_text?: string;
  bank_text?: string;
}

export interface LivePrintTemplateAssignment {
  print_template_revision_id: string;
  revision?: {
    id: string;
    definition?: LiveTemplateDefinition | Record<string, unknown>;
  } | null;
}

export interface ResolvedLiveTemplate {
  templateId: string;
  themeId: ThemeId;
  showLogo: boolean;
  layout: DocSectionLayoutItem[];
  footerText: string | null;
  termsText: string | null;
  bankText: string | null;
}

function isCurrentDefinition(value: unknown): value is LiveTemplateDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return ['template_id', 'theme_id', 'show_logo', 'layout', 'footer_text', 'terms_text', 'bank_text']
    .some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

/**
 * يحول مراجعة منشورة من API إلى القيم التي يستهلكها عارض المستند. تعريف الهجرة
 * القديم (`legacy_sales_designs`) ليس عقداً حديثاً، لذلك يعود `null` صراحةً كي
 * تختار الصفحة مسار التوافق القديم بدلاً من تفسيره جزئياً أو إظهار قالب كاذب.
 */
export function resolveLiveTemplateDefinition(
  assignment: LivePrintTemplateAssignment | null | undefined,
  documentType: DocumentTypeId,
): ResolvedLiveTemplate | null {
  const definition = assignment?.revision?.definition;
  if (!isCurrentDefinition(definition)) return null;

  const template = getTemplate(definition.template_id);
  return {
    templateId: template.id,
    themeId: definition.theme_id ?? template.defaultTheme,
    showLogo: definition.show_logo !== false,
    layout: Array.isArray(definition.layout) && definition.layout.length
      ? definition.layout
      : getDefaultDocumentLayout(documentType),
    footerText: definition.footer_text?.trim() || null,
    termsText: definition.terms_text?.trim() || null,
    bankText: definition.bank_text?.trim() || null,
  };
}
