'use client';

import type { DocumentTemplateProps, TemplateSectionsConfig, TemplateStyle } from '../types';
import { DocLayout } from './sections/doc-layout';
import { DocHeader } from './sections/doc-header';
import { DocParties } from './sections/doc-parties';
import { DocItemsTable } from './sections/doc-items-table';
import { DocSummary } from './sections/doc-summary';
import { DocFooter } from './sections/doc-footer';

/** الأقسام الظاهرة افتراضياً (فاتورة ضريبية كاملة). */
const DEFAULT_SECTIONS: TemplateSectionsConfig = {
  logo: true, header: true, seller: true, buyer: true, meta: true,
  items: true, summary: true, qr: true,
  terms: false, notes: false, bank: false, stamp: false, signature: false,
  footer: true,
};

/**
 * تركيب المستند المشترك — مصدر تركيب واحد لكل القوالب. كل قالب يمرّر أسلوبه
 * (`TemplateStyle`) فقط؛ لا تكرار في ترتيب الأقسام أو منطق الإظهار.
 */
export function DocumentBody({
  model,
  theme,
  formatMoney,
  sections,
  style,
}: DocumentTemplateProps & { style: TemplateStyle }) {
  const s = { ...DEFAULT_SECTIONS, ...sections };

  return (
    <DocLayout
      theme={theme}
      direction={model.direction}
      directionSample={model.seller.name || model.buyer.name}
      style={style}
    >
      {s.header && <DocHeader model={model} />}
      {(s.seller || s.buyer || s.meta) && <DocParties model={model} />}
      {s.items && <DocItemsTable model={model} formatMoney={formatMoney} />}
      {s.summary && <DocSummary model={model} formatMoney={formatMoney} showQr={s.qr} />}
      {s.footer && <DocFooter model={model} />}
    </DocLayout>
  );
}
