import type { DocumentModel } from '@/modules/documents/types';
import { documentLanguageDirection, type DocumentLanguageMode } from './document-language';

/**
 * يطبّق وضع لغة القالب على نسخة معاينة فقط.
 * لا يعيد حساب أي قيمة مالية ولا يغير نوع المستند أو محتوى السجل.
 */
export function applyDocumentLanguageToPreview(
  model: DocumentModel,
  mode: DocumentLanguageMode,
): DocumentModel {
  return {
    ...model,
    direction: documentLanguageDirection(mode),
  };
}
