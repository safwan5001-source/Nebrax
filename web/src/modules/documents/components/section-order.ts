import type { DocSectionKey, DocSectionLayoutItem, TemplateSectionsConfig } from '../types';
import { DEFAULT_SECTION_ORDER } from '../types';

/**
 * مفردات الأقسام المشتركة — مصدر واحد لأعلام الإظهار الافتراضية وحساب التخطيط،
 * يستهلكه تركيب A4 (`DocumentBody`) والإيصال الحراري معاً فيتّحد سلوك الأقسام.
 */

/** الأقسام الظاهرة افتراضياً (فاتورة ضريبية كاملة). */
export const DEFAULT_SECTIONS: TemplateSectionsConfig = {
  logo: true, header: true, seller: true, buyer: true, meta: true,
  items: true, summary: true, voucher: false, amountWords: false, qr: true, barcode: false,
  terms: false, notes: false, bank: false, stamp: false, signature: false,
  footer: true,
};

/** هل القسم ظاهر وفق أعلام الإعداد (للترتيب الافتراضي). */
export function isVisible(key: DocSectionKey, s: TemplateSectionsConfig): boolean {
  switch (key) {
    case 'header': return s.header;
    case 'barcode': return s.barcode;
    case 'parties': return s.seller || s.buyer || s.meta;
    case 'items': return s.items;
    case 'summary': return s.summary;
    case 'voucher': return s.voucher;
    case 'amountWords': return s.amountWords;
    case 'notes': return s.notes;
    case 'terms': return s.terms;
    case 'bank': return s.bank;
    case 'stamp': return s.stamp;
    case 'signature': return s.signature;
    case 'footer': return s.footer;
  }
}

/**
 * يحسب تخطيط الأقسام النهائي: إمّا `layout` المخصّص (من المصمّم) أو الترتيب
 * الافتراضي مصفّى بأعلام الإظهار. مصدر واحد لكل القوالب.
 */
export function resolveLayout(
  layout: DocSectionLayoutItem[] | null | undefined,
  sections: Partial<TemplateSectionsConfig> | undefined
): { items: DocSectionLayoutItem[]; sections: TemplateSectionsConfig } {
  const s = { ...DEFAULT_SECTIONS, ...sections };
  const items =
    layout && layout.length > 0
      ? layout
      : DEFAULT_SECTION_ORDER.map((key) => ({ key, visible: isVisible(key, s) }));
  return { items, sections: s };
}
