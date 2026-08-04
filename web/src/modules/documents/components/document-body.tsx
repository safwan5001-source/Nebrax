'use client';

import { Fragment, type ReactNode } from 'react';
import type {
  DocumentModel,
  DocumentTemplateProps,
  DocSectionKey,
  TemplateSectionsConfig,
  TemplateStyle,
} from '../types';
import { resolveLayout } from './section-order';
import { DocLayout } from './sections/doc-layout';
import { DocHeader } from './sections/doc-header';
import { DocBarcode } from './sections/doc-barcode';
import { DocParties } from './sections/doc-parties';
import { DocItemsTable } from './sections/doc-items-table';
import { DocSummary } from './sections/doc-summary';
import { DocVoucher } from './sections/doc-voucher';
import { DocAmountWords } from './sections/doc-amount-words';
import { DocNotes } from './sections/doc-notes';
import { DocTerms } from './sections/doc-terms';
import { DocBank } from './sections/doc-bank';
import { DocStamp } from './sections/doc-stamp';
import { DocSignature } from './sections/doc-signature';
import { DocFooter } from './sections/doc-footer';

/** رسم قسم واحد حسب مفتاحه. */
function renderSection(
  key: DocSectionKey,
  model: DocumentModel,
  formatMoney: (minor: number) => string,
  s: TemplateSectionsConfig
): ReactNode {
  switch (key) {
    case 'header': return <DocHeader model={model} showLogo={s.logo} />;
    case 'barcode': return <div className="mt-3 flex justify-center"><DocBarcode value={model.meta.number} /></div>;
    case 'parties': return <DocParties model={model} />;
    case 'items': return <DocItemsTable model={model} formatMoney={formatMoney} />;
    case 'summary': return <DocSummary model={model} formatMoney={formatMoney} showQr={s.qr} />;
    case 'voucher': return <DocVoucher model={model} formatMoney={formatMoney} />;
    case 'amountWords': return <DocAmountWords model={model} />;
    case 'notes': return <DocNotes model={model} />;
    case 'terms': return <DocTerms model={model} />;
    case 'bank': return <DocBank model={model} />;
    case 'stamp': return <DocStamp model={model} />;
    case 'signature': return <DocSignature model={model} />;
    case 'footer': return <DocFooter model={model} />;
  }
}

/**
 * تركيب المستند المشترك — مصدر تركيب واحد لكل القوالب. الأقسام تُرسَم وفق تخطيط
 * مرتّب: إمّا `layout` المخصّص (من المصمّم) أو الترتيب الافتراضي مصفّى بأعلام الإظهار.
 * الافتراضي (بلا layout) = نفس التركيب السابق تماماً.
 */
export function DocumentBody({
  model,
  theme,
  formatMoney,
  sections,
  layout,
  style,
  rootId,
}: DocumentTemplateProps & { style: TemplateStyle }) {
  const { items, sections: s } = resolveLayout(layout, sections);

  return (
    <DocLayout
      theme={theme}
      direction={model.direction}
      directionSample={model.seller.name || model.buyer.name}
      style={style}
      rootId={rootId}
    >
      {items.map((it) => (it.visible ? <Fragment key={it.key}>{renderSection(it.key, model, formatMoney, s)}</Fragment> : null))}
    </DocLayout>
  );
}
