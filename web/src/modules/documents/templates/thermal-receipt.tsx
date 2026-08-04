'use client';

import { Fragment, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { QRCodeSVG } from 'qrcode.react';
import type { DocumentTemplateProps, DocSectionKey } from '../types';
import { ThermalLayout } from '../components/thermal-layout';
import { resolveLayout } from '../components/section-order';
import { DocBarcode } from '../components/sections/doc-barcode';
import { amountToWords } from '../utils/amount-words';

function Row({ label, value }: { label: string; value: ReactNode }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex justify-between gap-2">
      <span className="text-gray-500">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

/**
 * إيصال حراري (58mm/80mm) — مضغوط بعمود واحد. يستهلك **نفس مفردات الأقسام**
 * (`resolveLayout`) التي يستهلكها تركيب A4، فيحترم تخطيط المصمّم ويرث الأقسام
 * الجديدة تلقائياً — لكن بمُخرَجٍ حراري مكثّف بدل مكوّنات A4. النوع الافتراضي
 * (بلا layout) يطابق الإيصال السابق بصرياً.
 */
export function ThermalReceipt({
  model,
  theme,
  formatMoney,
  sections,
  layout,
  rootId,
  widthMm,
}: DocumentTemplateProps & { widthMm: number }) {
  const t = useTranslations('invoiceDoc');
  const dt = useTranslations('documentTypes');
  const tv = useTranslations('voucherDoc');
  const locale = useLocale();
  const rule = 'my-2 border-t border-dashed border-gray-400';

  const { items, sections: s } = resolveLayout(layout, sections);

  function render(key: DocSectionKey): ReactNode {
    switch (key) {
      case 'header':
        return (
          <div className="text-center">
            <div className="text-[13px] font-bold">{model.seller.name || '—'}</div>
            {model.seller.vatNumber && (
              <div className="num text-[10px] text-gray-600">{t('vat_number')}: {model.seller.vatNumber}</div>
            )}
            <div className="mt-1 text-[12px] font-bold" style={{ color: 'var(--doc-brand)' }}>{dt(model.type)}</div>
          </div>
        );
      case 'barcode':
        return <div className="flex justify-center"><DocBarcode value={model.meta.number} /></div>;
      case 'parties':
        return (
          <div className="space-y-0.5">
            <Row label={t('number')} value={<span className="num">{model.meta.number}</span>} />
            <Row label={t('date')} value={<span className="num">{model.meta.date}</span>} />
            <Row
              label={model.voucher ? (model.voucher.direction === 'received' ? tv('received_from') : tv('paid_to')) : t('bill_to')}
              value={model.buyer.name || null}
            />
          </div>
        );
      case 'items':
        return (
          <div className="space-y-1">
            {model.lines.map((line) => (
              <div key={line.id}>
                <div className="truncate">{line.description || '—'}</div>
                <div className="flex justify-between text-gray-600">
                  <span className="num">{line.quantity} × {formatMoney(line.unitPrice)}</span>
                  <span className="num text-black">{formatMoney(line.total)}</span>
                </div>
              </div>
            ))}
          </div>
        );
      case 'summary':
        return (
          <div className="space-y-0.5">
            <Row label={t('subtotal')} value={<span className="num">{formatMoney(model.totals.subtotal)}</span>} />
            <Row label={t('vat')} value={<span className="num">{formatMoney(model.totals.tax)}</span>} />
            <div className="flex justify-between pt-1 text-[13px] font-bold">
              <span>{t('grand_total')}</span>
              <span className="num">{formatMoney(model.totals.total)}</span>
            </div>
            {s.qr && model.qr?.value && (
              <div className="mt-3 flex justify-center">
                <QRCodeSVG value={model.qr.value} size={88} level="M" />
              </div>
            )}
          </div>
        );
      case 'voucher': {
        const v = model.voucher;
        if (!v) return null;
        return (
          <div>
            <div className="flex justify-between text-[13px] font-bold">
              <span>{tv('amount')}</span>
              <span className="num">{formatMoney(v.amount)}</span>
            </div>
            <div className="mt-1 space-y-0.5">
              <Row label={tv('method')} value={v.method} />
              {v.reference && <Row label={tv('reference')} value={<span className="num">{v.reference}</span>} />}
            </div>
            {v.allocations && v.allocations.length > 0 && (
              <div className="mt-2">
                <div className="text-[10px] text-gray-500">{tv('applied_to')}</div>
                <div className="mt-1 space-y-0.5">
                  {v.allocations.map((a, i) => (
                    <div key={i} className="flex justify-between text-gray-600">
                      <span className="num">{a.label}</span>
                      <span className="num text-black">{formatMoney(a.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      }
      case 'amountWords': {
        const amount = model.voucher ? model.voucher.amount : model.totals.total;
        return (
          <div className="text-[10px] text-gray-600">
            <span className="font-bold">{t('amount_words')}: </span>
            {amountToWords(amount, model.currency, locale === 'en' ? 'en' : 'ar')}
          </div>
        );
      }
      case 'notes':
        return model.notes ? (
          <div className="text-[10px]"><span className="font-bold">{t('notes')}: </span>{model.notes}</div>
        ) : null;
      case 'terms':
        return model.terms ? (
          <div className="text-[10px]"><span className="font-bold">{t('terms')}: </span>{model.terms}</div>
        ) : null;
      case 'bank':
        return model.bank ? (
          <div className="text-[10px]"><span className="font-bold">{t('bank')}: </span><span className="whitespace-pre-line">{model.bank}</span></div>
        ) : null;
      case 'stamp':
        return model.stampUrl ? (
          <div className="flex justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL */}
            <img src={model.stampUrl} alt="stamp" className="h-16 w-auto object-contain opacity-90" />
          </div>
        ) : null;
      case 'signature':
        return model.signatureUrl ? (
          <div className="flex flex-col items-center">
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL */}
            <img src={model.signatureUrl} alt={t('signature')} className="h-10 w-auto object-contain" />
            <div className="mt-0.5 text-[10px] text-gray-500">{t('signature')}</div>
          </div>
        ) : null;
      case 'footer':
        return <div className="text-center text-[10px] text-gray-500">{model.footerText ?? t('footer')}</div>;
    }
  }

  // الأقسام الظاهرة فقط، مع فاصل متقطّع قبل كلٍّ ما عدا الأول.
  const visible = items.filter((it) => it.visible);
  let printed = 0;

  return (
    <ThermalLayout theme={theme} direction={model.direction} directionSample={model.seller.name} widthMm={widthMm} rootId={rootId}>
      {visible.map((it) => {
        const node = render(it.key);
        if (node === null || node === undefined) return null;
        const el = (
          <Fragment key={it.key}>
            {printed > 0 && <div className={rule} />}
            {node}
          </Fragment>
        );
        printed += 1;
        return el;
      })}
    </ThermalLayout>
  );
}

/** إيصال حراري 58mm. */
export function TaxReceiptThermal58(props: DocumentTemplateProps) {
  return <ThermalReceipt {...props} widthMm={58} />;
}

/** إيصال حراري 80mm. */
export function TaxReceiptThermal80(props: DocumentTemplateProps) {
  return <ThermalReceipt {...props} widthMm={80} />;
}
