'use client';

import { useTranslations } from 'next-intl';
import { QRCodeSVG } from 'qrcode.react';
import type { DocumentTemplateProps } from '../types';
import { ThermalLayout } from '../components/thermal-layout';
import { applyVatRateToLabel } from '../presentation/visual-v2';

/**
 * صف «وسم: قيمة». على الورق الضيّق (58mm) يلتفّ الوسم الطويل (مثل «الإجمالي شامل الضريبة»)
 * بدل أن يدفع المبلغ إلى سطر ثانٍ، ويبقى المبلغ + العملة معاً في سطر واحد (`amount`).
 * القيم النصّية (اسم العميل) تلتفّ ولا تُقتطع.
 */
function Row({ label, value, amount = false }: { label: string; value: React.ReactNode; amount?: boolean }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex justify-between gap-2">
      <span className="min-w-0 flex-1 break-words text-muted">{label}</span>
      <span className={amount ? 'shrink-0 whitespace-nowrap font-medium' : 'min-w-0 max-w-[62%] break-words text-end font-medium'}>{value}</span>
    </div>
  );
}

/** مبلغ بترتيب LTR معزول: يمنع انعكاس «125.00 SAR» إلى «SAR 125.00» داخل سياق RTL. */
function Amount({ children }: { children: React.ReactNode }) {
  return <span className="num whitespace-nowrap" dir="ltr">{children}</span>;
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
  const tp = useTranslations('purchaseForm');
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
          <div className="flex justify-between gap-2 pt-1 text-[13px] font-bold">
            <span className="min-w-0 flex-1 break-words">{tv('amount')}</span>
            <span className="shrink-0"><Amount>{formatMoney(v.amount)}</Amount></span>
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
                  <div key={i} className="flex justify-between gap-2 text-muted">
                    <span className="num min-w-0 flex-1 break-words">{a.label}</span>
                    <span className="shrink-0 text-text"><Amount>{formatMoney(a.amount)}</Amount></span>
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
                <div className="break-words">{line.description || '—'}</div>
                {/* كمية × سعر: كل قيمة تبقى متماسكة (Amount) لكن يجوز الكسر بينهما؛ وإن ضاق السطر
                    (58mm بقيم كبيرة) ينزل إجمالي البند إلى سطر خاص بدل التداخل. الحاوية LTR كي يبقى الترتيب «1 × 125.00». */}
                <div className="flex flex-wrap items-baseline justify-between gap-x-2 text-muted">
                  <span dir="ltr" className="min-w-0 max-w-full"><Amount>{line.quantity}</Amount> × <Amount>{formatMoney(line.unitPrice)}</Amount></span>
                  <span className="ms-auto max-w-full shrink-0 text-text"><Amount>{formatMoney(line.total)}</Amount></span>
                </div>
              </div>
            ))}
          </div>

          <div className={rule} />
          <div className="space-y-0.5">
            <Row amount label={t('subtotal')} value={<Amount>{formatMoney(model.totals.subtotal)}</Amount>} />
            {model.totals.discount && model.totals.discount > 0 ? (
              <Row amount label={tp('discount')} value={<Amount>− {formatMoney(model.totals.discount)}</Amount>} />
            ) : null}
            <Row amount label={applyVatRateToLabel(t('vat'), model.totals.taxRate)} value={<Amount>{formatMoney(model.totals.tax)}</Amount>} />
            <div className="flex justify-between gap-2 pt-1 text-[13px] font-bold">
              <span className="min-w-0 flex-1 break-words">{t('grand_total')}</span>
              <span className="shrink-0"><Amount>{formatMoney(model.totals.total)}</Amount></span>
            </div>
          </div>
          {model.lines.some((line) => line.unitPriceRounded) && (
            <div data-doc-rounding-note className="mt-1 text-[9px] leading-snug text-muted">{t('unit_price_rounding_note')}</div>
          )}
        </>
      )}

      {model.qr?.value && (
        <div className="mt-3 flex justify-center">
          <QRCodeSVG value={model.qr.value} size={88} level="M" title={t('qr_title')} />
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
