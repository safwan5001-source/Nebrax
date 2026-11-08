'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { DocumentTemplateProps } from '../types';
import { DocLayout } from '../components/sections/doc-layout';
import { useDocPageFrame } from '../components/doc-page-frame-context';
import { useDocumentLabelMode } from '../presentation/use-document-label-mode';
import { ModernDocumentTitle, ModernFieldLabel, ModernStatusLabel } from '../presentation/modern-bilingual-label';
import { isNoticeStatus } from '../presentation/visual-v2';
import { amountToWords } from '../utils/amount-words';
import { VOUCHER_COMPACT_STYLE } from './template-styles';

/**
 * كثافتان: العادية (A4/A5) والمضغوطة (إطار ارتفاعه أقل من `TIGHT_HEIGHT_MM`، أي A6 أفقي). الكثافة المضغوطة
 * تصغّر الأحجام والفراغات وتجعل التفاصيل ثلاثة أعمدة دون حذف أي حقل؛ ما لا يتسع ينساب إلى صفحة تالية بلا قصّ.
 */
const TIGHT_HEIGHT_MM = 110;
const DENSITY = {
  normal: { logo: 40, gap: 'gap-2', name: 'text-[12px]', title: 'text-[14px]', amount: 'text-[18px]', party: 'text-[13px]', heroPad: 'px-2.5 py-1.5', words: 'text-[10.5px]', value: 'text-[11px]', label: 'text-[8.5px]', alloc: 'text-[10px]', cols: 'grid-cols-2', sign: 'h-10', stamp: 'h-12 w-14', foot: 'text-[8.5px]' },
  tight: { logo: 26, gap: 'gap-1', name: 'text-[11px]', title: 'text-[12px]', amount: 'text-[15px]', party: 'text-[11px]', heroPad: 'px-2 py-0.5', words: 'text-[9px]', value: 'text-[9.5px]', label: 'text-[8px]', alloc: 'text-[9px]', cols: 'grid-cols-3', sign: 'h-6', stamp: 'h-8 w-10', foot: 'text-[8px]' },
} as const;

function Field({ label, value, ltr = false, d }: { label: ReactNode; value: ReactNode; ltr?: boolean; d: (typeof DENSITY)['normal' | 'tight'] }) {
  return (
    <div className="min-w-0 border-b border-[color:var(--border)] pb-0.5" data-voucher-field>
      <div className={cn(d.label, 'leading-tight text-[color:var(--muted)]')}>{label}</div>
      <div className={cn('break-words font-medium leading-snug text-black', d.value, ltr && 'num')} dir={ltr ? 'ltr' : undefined}>
        {value}
      </div>
    </div>
  );
}

/**
 * قالب السند المدمج (`voucher-compact`) لسندي القبض والصرف — مستند واحد بصفحة واحدة يصلح للـA5/A6.
 *
 * يعرض فقط ما في `model.voucher`/`model.seller`: لا حقل بلا قيمة، ولا QR (لا مصدر QR معتمد للسند)،
 * ولا شعار/ختم/توقيع بلا صورة. قالب مستقل لا يمرّ عبر `DocumentBody` (لا تخطيط مصمّم للسند).
 */
export function VoucherCompact({ model, theme, formatMoney, sections, layout, rootId }: DocumentTemplateProps) {
  const t = useTranslations('voucherDoc');
  const dt = useTranslations('documentTypes');
  const dtAlt = useTranslations('documentTypesAlt');
  const tPrint = useTranslations('documentPrint');
  const { locale, mode } = useDocumentLabelMode(model);
  const frame = useDocPageFrame();
  const v = model.voucher;
  if (!v) return null;
  const tight = frame !== null && frame.contentMinHeightMm < TIGHT_HEIGHT_MM;
  const d = tight ? DENSITY.tight : DENSITY.normal;
  // عرض يكفي ثلاثة أعمدة تفاصيل: A4 (بلا إطار) وA5 أفقي؛ الأضيق (A5/A6 عمودي) عمودان.
  const wide = frame === null || frame.contentWidthMm >= 150;

  const { seller, meta } = model;
  const received = v.direction === 'received';
  // التخطيط المحفوظ (مصمّم القوالب/مراجعة PDF) يتقدّم كما في `DocumentBody`: القسم غير المدرج أو `visible:false` يُخفى؛
  // وغياب التخطيط = الأعلام وحدها (`sections`). الأقسام الجوهرية (الترويسة والطرف والمبلغ والتفاصيل) لا تُخفى.
  const saved = layout && layout.length > 0 ? layout : null;
  const shown = (key: 'amountWords' | 'notes' | 'signature' | 'stamp' | 'footer') => !saved || saved.some((item) => item.key === key && item.visible);
  const showLogo = sections?.logo !== false;
  const showWords = sections?.amountWords !== false && shown('amountWords');
  const showNotes = sections?.notes !== false && shown('notes');
  const showStamp = sections?.stamp !== false && shown('stamp') && !!model.stampUrl;
  const showSignature = sections?.signature !== false && shown('signature') && !!model.signatureUrl;
  const showFooter = sections?.footer !== false && shown('footer');
  const words = amountToWords(v.amount, model.currency, locale === 'en' ? 'en' : 'ar');
  const logoHeight = Math.min(seller.logoHeight && seller.logoHeight > 0 ? seller.logoHeight : d.logo, d.logo);
  const notes = model.notes?.trim() || null;
  const footer = model.footerText?.trim() || null;
  const allocations = v.allocations ?? [];

  // توقيع الشركة يقع في خانة الجهة التي تمثّلها: المستلِم في القبض، والمسلِّم في الصرف.
  const companyCell = received ? 'receiver' : 'payer';
  const cells: { key: 'payer' | 'receiver'; label: string }[] = [
    { key: 'payer', label: t('payer_signature') },
    { key: 'receiver', label: t('receiver_signature') },
  ];

  return (
    <DocLayout
      theme={theme}
      direction={model.direction}
      directionSample={seller.name || model.buyer.name}
      style={VOUCHER_COMPACT_STYLE}
      rootId={rootId}
    >
      <div className={cn('flex min-h-0 flex-1 flex-col', d.gap)} data-voucher-compact data-voucher-density={tight ? 'tight' : 'normal'}>
        {/* الرأس: الهوية + نوع السند ورقمه وتاريخه. */}
        <header className="flex items-start justify-between gap-3 border-b-2 pb-1" style={{ borderColor: 'var(--doc-brand)' }}>
          <div className="flex min-w-0 flex-1 items-center gap-2">
            {showLogo && seller.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- data URL؛ لا يناسبه next/image
              <img src={seller.logoUrl} alt={seller.name} className="w-auto max-w-[72px] shrink-0 object-contain" style={{ height: `${logoHeight}px` }} />
            ) : null}
            <div className="min-w-0">
              <div className={cn('line-clamp-2 break-words font-bold leading-tight text-black', d.name)}>{seller.name || '—'}</div>
              {v.branchName ? <div className="break-words text-[9px] leading-tight text-[color:var(--muted)]">{v.branchName}</div> : null}
            </div>
          </div>
          <div className="shrink-0 text-end">
            <h1 className={cn('font-bold leading-tight', d.title)} style={{ color: 'var(--doc-brand)' }}>
              <ModernDocumentTitle locale={locale} primary={dt(model.type)} alternate={dtAlt(model.type)} mode={mode} />
            </h1>
            <div className="mt-0.5 flex flex-wrap items-baseline justify-end gap-x-2 text-[10px]" data-voucher-ident>
              <span className="num font-bold text-black" dir="ltr">
                <span className="font-sans font-medium text-[color:var(--muted)]">{tPrint('document_number')}: </span>
                {meta.number}
              </span>
              <span className="num text-black" dir="ltr">{meta.date}</span>
            </div>
            {isNoticeStatus(model.status) ? (
              <div className="mt-0.5 inline-block border border-[color:var(--muted)] px-1 text-[9px] font-bold text-[color:var(--muted)]">
                <ModernStatusLabel status={model.status} mode={mode} />
              </div>
            ) : null}
          </div>
        </header>

        {/* الطرف والمبلغ. */}
        <div className={cn('flex items-stretch justify-between gap-3 border', d.heroPad)} style={{ borderColor: 'var(--doc-brand)', background: 'var(--doc-brand-soft)' }}>
          <div className="min-w-0">
            <div className="text-[9px] text-[color:var(--muted)]"><ModernFieldLabel field={received ? 'received_from' : 'paid_to'} mode={mode} /></div>
            <div className={cn('break-words font-bold leading-snug text-black', d.party)}>{model.buyer.name || '—'}</div>
          </div>
          <div className="shrink-0 text-end">
            <div className="text-[9px] text-[color:var(--muted)]"><ModernFieldLabel field="amount" mode={mode} /></div>
            <div className={cn('num font-bold leading-tight', d.amount)} style={{ color: 'var(--doc-brand)' }}>{formatMoney(v.amount)}</div>
          </div>
        </div>

        {showWords ? (
          <div className={cn('leading-snug', d.words)} data-voucher-words>
            <span className="font-bold text-[color:var(--muted)]"><ModernFieldLabel field="amount_words" mode={mode} />: </span>
            <span className="font-medium text-black">{words}</span>
          </div>
        ) : null}

        {/* التفاصيل — كل حقل يظهر فقط إن وُجدت قيمته في السجل. */}
        <div className={cn('grid gap-x-3 gap-y-1', wide ? 'grid-cols-3' : d.cols)}>
          <Field d={d} label={<ModernFieldLabel field="method" mode={mode} />} value={v.methodName || v.method} />
          {v.reference ? <Field d={d} label={<ModernFieldLabel field="reference" mode={mode} />} value={v.reference} ltr /> : null}
          {v.accountName ? <Field d={d} label={t('account')} value={v.accountName} /> : null}
          {v.paymentDetails ? <Field d={d} label={t('payment_details')} value={v.paymentDetails} /> : null}
          {v.collectorName ? <Field d={d} label={t('collector')} value={v.collectorName} /> : null}
          {v.classificationName ? <Field d={d} label={t('classification')} value={v.classificationName} /> : null}
        </div>

        {showNotes && notes ? (
          <div className={cn('leading-snug', d.words)} data-voucher-notes>
            <span className="font-bold text-[color:var(--muted)]">{t('description')}: </span>
            <span className="whitespace-pre-line break-words text-black">{notes}</span>
          </div>
        ) : null}

        {allocations.length > 0 ? (
          <div className="border border-[color:var(--border)]" data-voucher-allocations>
            <div className="bg-[color:var(--doc-brand-soft)] px-2 py-0.5 text-[8.5px] font-bold text-[color:var(--muted)]">
              <ModernFieldLabel field="applied_to" mode={mode} />
            </div>
            <table className={cn('w-full', d.alloc)}>
              <tbody>
                {allocations.map((a, i) => (
                  <tr key={i} className="break-inside-avoid border-t border-[color:var(--border)]">
                    <td className="break-words px-2 py-0.5 text-black">{a.label}</td>
                    <td className="num whitespace-nowrap px-2 py-0.5 text-end font-medium text-black">{formatMoney(a.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        {/* التوقيعات والختم — يُدفع إلى أسفل الصفحة. */}
        <div className="mt-auto grid break-inside-avoid grid-cols-[1fr_auto_1fr] items-end gap-3 pt-1" data-voucher-signatures>
          {cells.map((cell, index) => (
            <div key={cell.key} className={cn('flex min-w-0 flex-col items-center', index === 1 && 'order-3')}>
              <div className={cn('flex items-end justify-center', d.sign)}>
                {showSignature && cell.key === companyCell ? (
                  // eslint-disable-next-line @next/next/no-img-element -- data URL
                  <img src={model.signatureUrl ?? undefined} alt="signature" className={cn('w-auto max-w-full object-contain', d.sign)} />
                ) : null}
              </div>
              <div className="w-full border-t border-[color:var(--muted)] pt-0.5 text-center text-[9px] text-[color:var(--muted)]">{cell.label}</div>
            </div>
          ))}
          <div className={cn('order-2 flex items-center justify-center', d.stamp)}>
            {showStamp ? (
              // eslint-disable-next-line @next/next/no-img-element -- data URL
              <img src={model.stampUrl ?? undefined} alt="stamp" className={cn('w-auto max-w-full object-contain', d.stamp.split(' ')[0])} />
            ) : null}
          </div>
        </div>

        {showFooter && footer ? (
          <footer className={cn('break-inside-avoid border-t border-[color:var(--border)] pt-0.5 text-center leading-snug text-[color:var(--muted)]', d.foot)}>{footer}</footer>
        ) : null}
      </div>
    </DocLayout>
  );
}
