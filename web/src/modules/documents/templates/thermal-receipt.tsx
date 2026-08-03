'use client';

import { useTranslations } from 'next-intl';
import { QRCodeSVG } from 'qrcode.react';
import type { DocumentTemplateProps } from '../types';
import { ThermalLayout } from '../components/thermal-layout';

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  if (value === null || value === undefined || value === '') return null;
  return (
    <div className="flex justify-between gap-2">
      <span className="text-gray-500">{label}</span>
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
  const rule = 'my-2 border-t border-dashed border-gray-400';

  return (
    <ThermalLayout theme={theme} direction={model.direction} directionSample={model.seller.name} widthMm={widthMm} rootId={rootId}>
      <div className="text-center">
        <div className="text-[13px] font-bold">{model.seller.name || '—'}</div>
        {model.seller.vatNumber && (
          <div className="num text-[10px] text-gray-600">{t('vat_number')}: {model.seller.vatNumber}</div>
        )}
        <div className="mt-1 text-[12px] font-bold" style={{ color: 'var(--doc-brand)' }}>{dt(model.type)}</div>
      </div>

      <div className={rule} />
      <div className="space-y-0.5">
        <Row label={t('number')} value={<span className="num">{model.meta.number}</span>} />
        <Row label={t('date')} value={<span className="num">{model.meta.date}</span>} />
        <Row label={t('bill_to')} value={model.buyer.name || null} />
      </div>

      <div className={rule} />
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

      <div className={rule} />
      <div className="space-y-0.5">
        <Row label={t('subtotal')} value={<span className="num">{formatMoney(model.totals.subtotal)}</span>} />
        <Row label={t('vat')} value={<span className="num">{formatMoney(model.totals.tax)}</span>} />
        <div className="flex justify-between pt-1 text-[13px] font-bold">
          <span>{t('grand_total')}</span>
          <span className="num">{formatMoney(model.totals.total)}</span>
        </div>
      </div>

      {model.qr?.value && (
        <div className="mt-3 flex justify-center">
          <QRCodeSVG value={model.qr.value} size={88} level="M" />
        </div>
      )}

      <div className={rule} />
      <div className="text-center text-[10px] text-gray-500">{model.footerText ?? t('footer')}</div>
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
