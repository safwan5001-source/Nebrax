'use client';

import type { DocumentTemplateProps, TemplateSectionsConfig } from '../types';
import { DocLayout } from '../components/sections/doc-layout';
import { DocHeader } from '../components/sections/doc-header';
import { DocParties } from '../components/sections/doc-parties';
import { DocItemsTable } from '../components/sections/doc-items-table';
import { DocQr } from '../components/sections/doc-qr';
import { DocTotals } from '../components/sections/doc-totals';
import { DocFooter } from '../components/sections/doc-footer';

/** الأقسام الظاهرة افتراضياً في القالب الكلاسيكي (فاتورة ضريبية A4). */
const DEFAULT_SECTIONS: TemplateSectionsConfig = {
  logo: true, header: true, seller: true, buyer: true, meta: true,
  items: true, summary: true, qr: true,
  terms: false, notes: false, bank: false, stamp: false, signature: false,
  footer: true,
};

/**
 * القالب الكلاسيكي (فاتورة ضريبية) — تركيب أقسام فوق `DocLayout`.
 * لا منطق تنسيق هنا: كل قسم مكوّن مستقلّ يستهلك النموذج. مصدر واحد للشاشة/الطباعة/الـ PDF.
 */
export function TaxInvoiceClassic({ model, theme, formatMoney, sections }: DocumentTemplateProps) {
  const s = { ...DEFAULT_SECTIONS, ...sections };

  return (
    <DocLayout theme={theme} direction={model.direction} directionSample={model.seller.name || model.buyer.name}>
      {s.header && <DocHeader model={model} />}
      {(s.seller || s.buyer || s.meta) && <DocParties model={model} />}
      {s.items && <DocItemsTable model={model} formatMoney={formatMoney} />}
      {s.summary && (
        <div className="mt-5 flex items-start justify-between gap-6">
          {s.qr ? <DocQr model={model} /> : <div />}
          <DocTotals model={model} formatMoney={formatMoney} />
        </div>
      )}
      {s.footer && <DocFooter model={model} />}
    </DocLayout>
  );
}
