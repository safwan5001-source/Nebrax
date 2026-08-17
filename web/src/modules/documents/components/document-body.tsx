'use client';

import { Fragment, type ReactNode } from 'react';
import type {
  DocumentModel,
  DocumentTemplateProps,
  DocSectionKey,
  DocSectionLayoutItem,
  DocBlockPropertiesMap,
  TemplateSectionsConfig,
  TemplateStyle,
} from '../types';
import { getDefaultDocumentLayout } from '../registry/document-types';
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
import { DocBlockPropertiesProvider } from './doc-block-properties-context';

/** الأقسام الظاهرة افتراضياً (فاتورة ضريبية كاملة). */
const DEFAULT_SECTIONS: TemplateSectionsConfig = {
  logo: true, header: true, seller: true, buyer: true, meta: true,
  items: true, summary: true, voucher: false, amountWords: false, qr: true, barcode: false,
  terms: false, notes: false, bank: false, stamp: false, signature: false,
  footer: true,
};

/** هل القسم ظاهر وفق أعلام الإعداد (للترتيب الافتراضي). */
function isVisible(key: DocSectionKey, s: TemplateSectionsConfig): boolean {
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
  const s = { ...DEFAULT_SECTIONS, ...sections };
  // التخطيط المحفوظ يتقدم للمحافظة على مخرجات المستأجرين القائمة. عند غيابه،
  // يحدد سجل النوع العقد الافتراضي بدلاً من افتراض أن كل مستند فاتورة.
  const items: DocSectionLayoutItem[] =
    layout && layout.length > 0
      ? layout
      : getDefaultDocumentLayout(model.type).map((item) => ({
          ...item,
          visible: item.visible && isVisible(item.key, s),
        }));

  const blockProperties = items.reduce<DocBlockPropertiesMap>((properties, item) => {
    if (item.properties) properties[item.key] = item.properties;
    return properties;
  }, {});

  return (
    <DocBlockPropertiesProvider value={blockProperties}>
      <DocLayout
        theme={theme}
        direction={model.direction}
        directionSample={model.seller.name || model.buyer.name}
        style={style}
        rootId={rootId}
      >
        {items.map((it) => (it.visible ? <Fragment key={it.key}>{renderSection(it.key, model, formatMoney, s)}</Fragment> : null))}
      </DocLayout>
    </DocBlockPropertiesProvider>
  );
}
