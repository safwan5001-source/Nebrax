import type { DocSectionLayoutItem, ThemeId } from '@/modules/documents/types';
import { getTemplate } from '@/modules/documents/registry/templates';

export interface CreditNoteTemplateDefinition {
  template_id?: string;
  theme_id?: ThemeId;
  footer_text?: string;
  show_logo?: boolean;
  logo?: string;
  logo_height?: number;
  layout?: DocSectionLayoutItem[];
  terms_text?: string;
  bank_text?: string;
  stamp?: string;
  signature?: string;
}

export interface LegacyCreditNoteDesign {
  template?: string;
  theme?: ThemeId;
  footer_text?: string;
  show_logo?: boolean;
  logo?: string;
  logo_height?: number;
  sections?: DocSectionLayoutItem[];
  terms_text?: string;
  bank_text?: string;
  stamp?: string;
  signature?: string;
}

export interface ResolvedCreditNoteTemplateDesign {
  templateId: string;
  themeId: ThemeId | null;
  footerText: string | null;
  showLogo: boolean;
  logoUrl: string | null;
  logoHeight: number | null;
  layout: DocSectionLayoutItem[] | null;
  termsText: string | null;
  bankText: string | null;
  stampUrl: string | null;
  signatureUrl: string | null;
  frozen: boolean;
}

const DEFAULT_TEMPLATE_ID = 'tax-invoice-classic';

function nonEmpty(value: string | undefined): string | null {
  return value?.trim() ? value : null;
}

function validLayout(value: DocSectionLayoutItem[] | undefined): DocSectionLayoutItem[] | null {
  return Array.isArray(value) && value.length > 0 ? value : null;
}

/**
 * المرجع المثبت هو حد تاريخي: عند وجوده لا ندمجه مع إعدادات حية لأن قيمة حية
 * لاحقة قد تعيد تفسير مستند صدر بالفعل. التوافق مع التصميم القديم يطبّق فقط
 * حين لا يوجد المرجع أصلاً.
 */
export function resolveCreditNoteTemplateDesign(
  frozenDefinition: CreditNoteTemplateDefinition | null | undefined,
  legacyDesign: LegacyCreditNoteDesign | null | undefined,
): ResolvedCreditNoteTemplateDesign {
  if (frozenDefinition) {
    return {
      templateId: frozenDefinition.template_id ?? DEFAULT_TEMPLATE_ID,
      themeId: frozenDefinition.theme_id ?? null,
      footerText: nonEmpty(frozenDefinition.footer_text),
      showLogo: frozenDefinition.show_logo !== false,
      logoUrl: nonEmpty(frozenDefinition.logo),
      logoHeight: frozenDefinition.logo_height ?? null,
      layout: validLayout(frozenDefinition.layout),
      termsText: nonEmpty(frozenDefinition.terms_text),
      bankText: nonEmpty(frozenDefinition.bank_text),
      stampUrl: nonEmpty(frozenDefinition.stamp),
      signatureUrl: nonEmpty(frozenDefinition.signature),
      frozen: true,
    };
  }

  const legacy = legacyDesign ?? {};
  return {
    templateId: getTemplate(`tax-invoice-${legacy.template ?? ''}`).id,
    themeId: legacy.theme ?? null,
    footerText: nonEmpty(legacy.footer_text),
    showLogo: legacy.show_logo !== false,
    logoUrl: nonEmpty(legacy.logo),
    logoHeight: legacy.logo_height ?? null,
    layout: validLayout(legacy.sections),
    termsText: nonEmpty(legacy.terms_text),
    bankText: nonEmpty(legacy.bank_text),
    stampUrl: nonEmpty(legacy.stamp),
    signatureUrl: nonEmpty(legacy.signature),
    frozen: false,
  };
}
