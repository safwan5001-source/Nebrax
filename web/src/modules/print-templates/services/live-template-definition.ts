import { getDefaultDocumentLayout } from '@/modules/documents/registry/document-types';
import { getTemplate } from '@/modules/documents/registry/templates';
import type { DocSectionLayoutItem, DocumentTypeId, ThemeId } from '@/modules/documents/types';

export interface LiveTemplateDefinition {
  template_id?: string;
  theme_id?: ThemeId;
  show_logo?: boolean;
  logo_height?: number;
  layout?: DocSectionLayoutItem[];
  footer_text?: string;
  terms_text?: string;
  bank_text?: string;
  stamp?: string;
  signature?: string;
}

export interface LiveTemplateRevision {
  id: string;
  definition?: LiveTemplateDefinition | Record<string, unknown>;
}

export interface LivePrintTemplateAssignment {
  print_template_revision_id: string;
  revision?: LiveTemplateRevision | null;
}

export interface ResolvedLiveTemplate {
  templateId: string;
  themeId: ThemeId;
  showLogo: boolean;
  logoHeight: number | null;
  layout: DocSectionLayoutItem[];
  footerText: string | null;
  termsText: string | null;
  bankText: string | null;
  stampUrl: string | null;
  signatureUrl: string | null;
}

function isCurrentDefinition(value: unknown): value is LiveTemplateDefinition {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  return ['template_id', 'theme_id', 'show_logo', 'logo_height', 'layout', 'footer_text', 'terms_text', 'bank_text', 'stamp', 'signature']
    .some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

/**
 * يحول مراجعة منشورة من API إلى القيم التي يستهلكها عارض المستند. تعريف الهجرة
 * القديم (`legacy_sales_designs`) ليس عقداً حديثاً، لذلك يعود `null` صراحةً كي
 * تستخدم الصفحة عارضها الافتراضي الآمن بدلاً من تفسيره جزئياً أو إظهار قالب كاذب.
 */
/** يحول snapshot مراجعة منشورة مباشرةً من مورد المستند إلى قيم العارض. */
export function resolveTemplateRevisionDefinition(
  revision: LiveTemplateRevision | null | undefined,
  documentType: DocumentTypeId,
): ResolvedLiveTemplate | null {
  const definition = revision?.definition;
  if (!isCurrentDefinition(definition)) return null;

  const template = getTemplate(definition.template_id);
  return {
    templateId: template.id,
    themeId: definition.theme_id ?? template.defaultTheme,
    showLogo: definition.show_logo !== false,
    logoHeight: typeof definition.logo_height === 'number' && Number.isFinite(definition.logo_height)
      ? definition.logo_height
      : null,
    layout: Array.isArray(definition.layout) && definition.layout.length
      ? definition.layout
      : getDefaultDocumentLayout(documentType),
    footerText: definition.footer_text?.trim() || null,
    termsText: definition.terms_text?.trim() || null,
    bankText: definition.bank_text?.trim() || null,
    stampUrl: definition.stamp?.trim() || null,
    signatureUrl: definition.signature?.trim() || null,
  };
}

/** يحول التعيين الحي العام إلى قيم العارض، مع بقاء الواجهات القديمة متوافقة. */
export function resolveLiveTemplateDefinition(
  assignment: LivePrintTemplateAssignment | null | undefined,
  documentType: DocumentTypeId,
): ResolvedLiveTemplate | null {
  return resolveTemplateRevisionDefinition(assignment?.revision, documentType);
}
