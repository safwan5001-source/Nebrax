import type { DocSectionLayoutItem, DocumentTypeId, ThemeId } from '@/modules/documents/types';
import {
  normalizeDocumentLanguageMode,
  type DocumentLanguageMode,
} from './document-language';
import { getDefaultDocumentLayout } from '@/modules/documents/registry/document-types';

export interface LanguageAwareTemplateDefinition {
  template_id?: string;
  theme_id?: ThemeId;
  show_logo?: boolean;
  layout?: DocSectionLayoutItem[];
  footer_text?: string;
  language_mode?: DocumentLanguageMode;
}

export function normalizeLanguageAwareTemplateDefinition(
  definition: LanguageAwareTemplateDefinition | null | undefined,
  type: DocumentTypeId,
  fallbackLocale: string,
): Required<LanguageAwareTemplateDefinition> {
  const current = definition ?? {};
  return {
    template_id: current.template_id ?? 'tax-invoice-classic',
    theme_id: current.theme_id ?? 'blue',
    show_logo: current.show_logo ?? true,
    layout: current.layout ?? getDefaultDocumentLayout(type),
    footer_text: current.footer_text ?? '',
    language_mode: normalizeDocumentLanguageMode(current.language_mode, fallbackLocale),
  };
}
