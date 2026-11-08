import { getDefaultDocumentLayout } from '@/modules/documents/registry/document-types';
import type { DocSectionLayoutItem, DocumentTypeId, ThemeId } from '@/modules/documents/types';

/** تعريف القالب كما يعرفه المحرر؛ ما عداه من مفاتيح (ختم، توقيع، شروط…) يُحفظ كما هو. */
export interface TemplateDefinition {
  template_id?: string;
  theme_id?: ThemeId;
  show_logo?: boolean;
  layout?: DocSectionLayoutItem[];
  footer_text?: string;
  /** ملف إخراج اختياري (AWJ-DOC-V2-PR3A/B). */
  output_profile?: unknown;
}

/**
 * يبني التعريف الذي يُرسَل عند الحفظ من مراجعة. **لا يُسقط أي مفتاح**: كل مفاتيح التعريف القائمة
 * (ختم، توقيع، شروط، بنك، ارتفاع الشعار، ملف الإخراج، وأي مفتاح قادم) تُحفظ كما هي، ثم تُكتب فوقها
 * الحقول المعروفة بقيمها أو افتراضاتها. المحرر لا يملك إلا المعروفة؛ إسقاط غيرها كان يمحو
 * ختم/توقيع قالب مهاجَر عند أول حفظ (AWJ-DOC-V2-PR3B).
 */
export function normalizeDefinition(
  revision: { definition?: TemplateDefinition | null },
  type: DocumentTypeId,
): TemplateDefinition & Required<Omit<TemplateDefinition, 'output_profile'>> {
  const definition = revision.definition ?? {};
  return {
    ...definition,
    template_id: definition.template_id ?? 'tax-invoice-classic',
    theme_id: definition.theme_id ?? 'blue',
    show_logo: definition.show_logo ?? true,
    layout: definition.layout ?? getDefaultDocumentLayout(type),
    footer_text: definition.footer_text ?? '',
  };
}
