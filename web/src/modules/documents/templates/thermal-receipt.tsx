'use client';

import { useTranslations } from 'next-intl';
import { QRCodeSVG } from 'qrcode.react';
import type { DocumentTemplateProps } from '../types';
import { ThermalLayout } from '../components/thermal-layout';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex justify-between gap-2">
      <span className="text-muted">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}

/**
 * إيصال حراري (58mm/80mm) — مستند مضغوط بعمود واحد، يستهلك نفس `DocumentModel`
 * ومنسّق العملة. يُبقي QR الضريبي (امتثال ZATCA).
 */
export function ThermalReceipt({
  model,
  theme,
  formatMoney,
  rootId,
  widthMm,
}: DocumentTemplateProps & { widthMm: number }) {
  const t = useTranslations('invoiceDoc');
  const dt = useTranslations('documentTypes');
  const tv = useTranslations('voucherDoc');
  const rule = 'my-2 border-t border-dashed border-border';
  const v = model.voucher;

  return (
    <ThermalLayout theme={theme} direction={model.direction} directionSample={model.seller.name} widthMm={widthMm} rootId={rootId}>
      <div className="text-center">
        <div className="text-[13px] font-bold">{model.seller.name || '—'}</div>
        {model.seller.vatNumber && (
          <div className="num text-[10px] text-muted">{t('vat_number')}: {model.seller.vatNumber}</div>
        )}
        {model.seller.crNumber && (
          <div className="num text-[10px] text-muted">{t('cr_number')}: {model.seller.crNumber}</div>
        )}
        {model.seller.address && (
          <div className="mt-0.5 break-words text-[9px] text-muted">{model.seller.address}</div>
        )}
        {(model.seller.mobile || model.seller.phone) && (
          <div className="num mt-0.5 text-[10px] text-muted" dir="ltr">
            {model.seller.mobile || model.seller.phone}
          </div>
        )}
        <div className="mt-1 text-[12px] font-bold" style={{ color: 'var(--doc-brand)' }}>{dt(model.type)}</div>
      </div>

      <div className={rule} />
      <div className="space-y-0.5">
        <Row label={t('number')} value={<span className="num">{model.meta.number}</span>} />
        <Row label={t('date')} value={<span className="num">{model.meta.date}</span>} />
        <Row
          label={v ? (v.direction === 'received' ? tv('received_from') : tv('paid_to')) : t('bill_to')}
          value={model.buyer.name || null}
        />
      </div>

      {v ? (
        /* سند قبض/صرف — لا بنود/ضريبة: المبلغ + الطريقة + التخصيصات. */
        <>
          <div className={rule} />
          <div className="flex justify-between pt-1 text-[13px] font-bold">
            <span>{tv('amount')}</span>
            <span className="num">{formatMoney(v.amount)}</span>
          </div>
          <div className="mt-1 space-y-0.5">
            <Row label={tv('method')} value={v.method} />
            {v.reference && <Row label={tv('reference')} value={<span className="num">{v.reference}</span>} />}
          </div>
          {v.allocations && v.allocations.length > 0 && (
            <>
              <div className={rule} />
              <div className="text-[10px] text-muted">{tv('applied_to')}</div>
              <div className="mt-1 space-y-0.5">
                {v.allocations.map((a, i) => (
                  <div key={i} className="flex justify-between text-muted">
                    <span className="num">{a.label}</span>
                    <span className="num text-text">{formatMoney(a.amount)}</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </>
      ) : (
        /* فاتورة — بنود + إجماليات. */
        <>
          <div className={rule} />
          <div className="space-y-1">
            {model.lines.map((line) => (
              <div key={line.id}>
                <div className="truncate">{line.description || '—'}</div>
                <div className="flex justify-between text-muted">
                  <span className="num">{line.quantity} × {formatMoney(line.unitPrice)}</span>
                  <span className="num text-text">{formatMoney(line.total)}</span>
                </div>
              </div>
            ))}
          </div>

          <div className={rule} />
          <div className="space-y-0.5">
            <Row label={t('subtotal')} value={<span className="num">{formatMoney(model.totals.subtotal)}</span>} />
            <Row label={t('vat')} value={<span className="num">{formatMoney(model.totals.tax)}</span>} />
            <div className="flex justify-between pt-1 text-[13px] font-bold">
              <span>{t('grand_total')}</span>
              <span className="num">{formatMoney(model.totals.total)}</span>
            </div>
          </div>
        </>
      )}

      {model.qr?.value && (
        <div className="mt-3 flex justify-center">
          <QRCodeSVG value={model.qr.value} size={88} level="M" />
        </div>
      )}

      <div className={rule} />
      <div className="text-center text-[10px] text-muted">{model.footerText ?? t('footer')}</div>
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
