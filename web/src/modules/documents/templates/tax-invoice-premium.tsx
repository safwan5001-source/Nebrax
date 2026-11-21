'use client';

import { Fragment, createContext, useContext, type CSSProperties, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { QRCodeSVG } from 'qrcode.react';
import { cn } from '@/lib/utils';
import type {
  DocBlockAlignment,
  DocBlockPropertiesMap,
  DocItemsColumn,
  DocSectionKey,
  DocSectionLayoutItem,
  DocumentModel,
  DocumentTemplateProps,
} from '../types';
import { DocLayout } from '../components/sections/doc-layout';
import { DocBarcode } from '../components/sections/doc-barcode';
import { DocBlockPropertiesProvider, blockJustifyClassName, blockTextClassName, useDocBlockProperties } from '../components/doc-block-properties-context';
import { isExplicitSectionVisible } from '../components/document-body';
import { useDocumentLabelMode } from '../presentation/use-document-label-mode';
import {
  MODERN_TOTAL_LABELS,
  formatModernAmount,
  isNoticeStatus,
  modernCurrencyUnit,
  modernStatusLabel,
  type DocumentLabelMode,
} from '../presentation/visual-v2';
import {
  PREMIUM,
  PREMIUM_COLUMN_LABELS,
  PREMIUM_LABELS,
  PREMIUM_STUDIO_DEFAULT_COLUMNS,
  premiumColumnWidths,
  premiumMinRows,
  premiumResolveColumns,
  premiumSkuLine,
  premiumMetaTiles,
  premiumPalette,
  premiumTotalsRows,
  type PremiumColumn,
  type PremiumLabelKey,
  type PremiumLabelPair,
  type PremiumVariant,
} from '../presentation/tax-invoice-premium';
import { amountToWords } from '../utils/amount-words';
import { getDocumentImagePreviewClass, getDocumentImagePreviewOpacityClass } from '../utils/block-image-size';
import { resolveDirection } from '../utils/direction';
import { TAX_INVOICE_PREMIUM_STYLE } from './template-styles';

/**
 * ترتيب الأقسام عند غياب تخطيط محفوظ: ما يعرضه المرجع البصري كاملاً. كل قسم يظهر فقط إن وُجدت بياناته
 * (ملاحظات/بنك/ختم/توقيع/QR)، والمبلغ كتابةً يُشتق من الإجمالي المخزَّن بلا إعادة حساب.
 */
const PREMIUM_DEFAULT_LAYOUT: readonly DocSectionLayoutItem[] = [
  { key: 'header', visible: true },
  { key: 'barcode', visible: false },
  { key: 'parties', visible: true },
  { key: 'items', visible: true },
  { key: 'summary', visible: true },
  { key: 'amountWords', visible: true },
  { key: 'notes', visible: true },
  { key: 'terms', visible: true },
  { key: 'bank', visible: true },
  { key: 'signature', visible: true },
  { key: 'stamp', visible: true },
  { key: 'footer', visible: true },
];

/**
 * ترتيب أقسام المبسطة عند غياب تخطيط محفوظ: كالكاملة عدا التوقيع والختم (المرجع المبسط بلا مربعات توقيع). المبلغ كتابةً يُركَّب داخل
 * صف الإجماليات (كالمرجع) لا قسماً مستقلاً. تخطيط محفوظ من الاستوديو يغلب هذا دائماً ويستطيع إظهارهما.
 */
const SIMPLIFIED_DEFAULT_LAYOUT: readonly DocSectionLayoutItem[] = PREMIUM_DEFAULT_LAYOUT.map((item) => (
  item.key === 'signature' || item.key === 'stamp' ? { ...item, visible: false } : item
));

/**
 * التخطيط الذي يحفظه الاستوديو حين يُفعَّل «رمز المنتج» على القالب الفاخر: تخطيطه الافتراضي مع أعمدة القالب الافتراضية + `product_code`
 * (يُرسم الرمز تحت اسم الصنف لا عموداً مستقلاً). للتحقق البصري/الاختبار؛ لا يُستعمل في مسار الإنتاج.
 */
export function premiumLayoutWithSku(variant: PremiumVariant = 'full'): DocSectionLayoutItem[] {
  return (variant === 'simplified' ? SIMPLIFIED_DEFAULT_LAYOUT : PREMIUM_DEFAULT_LAYOUT).map((item) => (item.key === 'items'
    ? { ...item, properties: { columns: [...PREMIUM_STUDIO_DEFAULT_COLUMNS, 'product_code' as const].map((id) => ({ id })) } }
    : { ...item }));
}

type Mode = DocumentLabelMode;

/** اتجاه المستند الفعلي — تحتاجه محاذاة النص الإنجليزي المعزول (`dir=ltr`) داخل صفحة RTL. */
const PremiumDirContext = createContext<'rtl' | 'ltr'>('rtl');
const usePremiumDir = () => useContext(PremiumDirContext);
/** متغيّر التركيب (`full` افتراضي = الفاتورة الضريبية الكاملة بلا أي تغيير؛ `simplified` = المبسطة). */
const PremiumVariantContext = createContext<PremiumVariant>('full');
const useVariant = () => useContext(PremiumVariantContext);

/** تسمية بلغة واحدة: الإنجليزية للوضع `en`، وإلا العربية (للتذييلات المضغوطة). */
const single = (pair: PremiumLabelPair, mode: Mode) => (mode === 'en' ? pair.en : pair.ar);

/**
 * سلّم الخطوط (الأدنى 9px — يحرسه اختبار): عنوان البطاقة 13 ← قيمة 11.5 ← تسمية 10 (والإنجليزية 9 تحتها).
 * تسمية ثنائية متراصة: العربية فوق والإنجليزية أصغر تحتها، وكلاهما يحاذي بداية الحاوية.
 * لا `dir` على السطرين عمداً: الإنجليزية تتبع اتجاه الصفحة فتحاذي النهاية نفسها كالمرجع (عكس `ModernBilingualLabel`).
 */
function Bi({ pair, mode, className, enClassName, inline }: { pair: PremiumLabelPair; mode: Mode; className?: string; enClassName?: string; inline?: boolean }) {
  const ar = pair.ar.trim();
  const en = pair.en.trim();
  if (mode === 'ar' || (mode === 'bilingual' && !en)) return <span className={className}>{ar}</span>;
  if (mode === 'en' || !ar) return <span className={className}>{en}</span>;
  if (ar === en) return <span className={className}>{ar}</span>;
  // قيمة قصيرة (نقدي/آجل): سطر واحد «آجل · Credit» بدل كومة من سطرين تضخّم البطاقة.
  if (inline) {
    return (
      <span className={className} data-premium-bilingual>
        {ar}<span style={{ color: 'var(--pv-muted)' }}> · </span><span dir="ltr" className={cn('text-[0.8em] font-medium', enClassName)} style={{ color: 'var(--pv-muted)' }}>{en}</span>
      </span>
    );
  }
  // السطر الإنجليزي `dir=ltr` كي تبقى علامات الترقيم (VAT No.) في موضعها داخل صفحة RTL؛ المحاذاة للبداية من الحاوية.
  return (
    <span className={cn('inline-flex flex-col items-start leading-snug', className)} data-premium-bilingual>
      <span>{ar}</span>
      <span dir="ltr" className={cn('text-[0.9em] font-normal', enClassName)}>{en}</span>
    </span>
  );
}

const label = (key: PremiumLabelKey): PremiumLabelPair => PREMIUM_LABELS[key];

function Money({ minor, currency, mode, className }: { minor: number; currency: string; mode: Mode; className?: string }) {
  const amount = formatModernAmount(minor, currency);
  if (amount === '—') return <span className={className}>—</span>;
  return (
    <span className={cn('inline-flex items-baseline gap-1', className)} dir="ltr">
      <span className="font-sans tabular-nums">{amount}</span>
      <span className="text-[0.72em] font-medium opacity-70">{modernCurrencyUnit(currency, mode)}</span>
    </span>
  );
}

const ltrValue = (value: string) => <span className="font-sans tabular-nums" dir="ltr">{value}</span>;

const textAlign: Record<DocBlockAlignment, string> = { start: 'text-start', center: 'text-center', end: 'text-end' };

/** الترويسة: عنوان المستند بالعربية والإنجليزية + الشعار (أو اسم المنشأة) على أرضية الهوية، يتلوها شريط التمييز. */
function PremiumHeader({ model, showLogo, mode, locale }: { model: DocumentModel; showLogo: boolean; mode: Mode; locale: string }) {
  const dt = useTranslations('documentTypes');
  const dtAlt = useTranslations('documentTypesAlt');
  const properties = useDocBlockProperties('header');
  const isAr = locale.toLowerCase().startsWith('ar');
  const title: PremiumLabelPair = isAr
    ? { ar: dt(model.type), en: dtAlt(model.type) }
    : { ar: dtAlt(model.type), en: dt(model.type) };
  const { seller } = model;
  const logo = showLogo && seller.logoUrl ? seller.logoUrl : null;
  const logoHeight = Math.min(seller.logoHeight && seller.logoHeight > 0 ? seller.logoHeight : PREMIUM.logoMaxPx, PREMIUM.logoMaxPx);
  const bilingual = mode === 'bilingual';
  const variant = useVariant();

  return (
    <header data-premium-header data-premium-mode={mode} data-premium-variant={variant}>
      <div className={cn('flex items-center justify-between gap-6 px-8 pb-3 pt-3.5 text-white', blockTextClassName(properties))} style={{ background: 'var(--pv-deep)' }}>
        <div className="min-w-0">
          <h1 className={cn('font-extrabold leading-tight', mode === 'en' ? 'text-[22px]' : 'text-[24px]')}>
            {mode === 'en' ? title.en : title.ar}
          </h1>
          {bilingual ? (
            <div className="mt-1.5 text-[11px] font-bold uppercase tracking-[0.22em]" style={{ color: 'var(--pv-accent)' }} dir="ltr">{title.en}</div>
          ) : null}
          {isNoticeStatus(model.status) ? (
            <div className="mt-2 inline-block rounded-md border border-white/60 px-2 py-0.5 text-[10px] font-bold" data-premium-notice>
              {modernStatusLabel(model.status, mode)}
            </div>
          ) : null}
        </div>
        {logo ? (
          <div className="shrink-0 rounded-lg bg-white px-2.5 py-1.5" data-premium-logo>
            {/* eslint-disable-next-line @next/next/no-img-element -- data URL */}
            <img src={logo} alt={seller.name} className="w-auto max-w-[150px] object-contain" style={{ height: `${logoHeight}px` }} />
          </div>
        ) : (
          <div className="max-w-[45%] shrink-0 break-words text-end text-[18px] font-extrabold leading-snug" data-premium-seller-name>
            {seller.name || '—'}
          </div>
        )}
      </div>
      <div style={{ height: 5, background: 'var(--pv-accent)' }} aria-hidden />
    </header>
  );
}

function MetaTiles({ model, mode }: { model: DocumentModel; mode: Mode }) {
  const tiles = premiumMetaTiles(model, useVariant());
  return (
    <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${tiles.length}, minmax(0, 1fr))` }} data-premium-meta>
      {tiles.map((tile) => (
        <div key={tile.key} className="min-w-0 rounded-xl px-3 py-1" style={{ background: 'var(--pv-soft)' }} data-premium-meta-tile={tile.key}>
          <div className="text-[10px] font-semibold" style={{ color: 'var(--pv-muted)' }}>
            <Bi pair={label(tile.key)} mode={mode} />
          </div>
          <div className="mt-0.5 break-words text-[13px] font-extrabold leading-snug text-black">
            {tile.valueLabel ? <Bi pair={label(tile.valueLabel)} mode={mode} inline /> : ltrValue(tile.value)}
          </div>
        </div>
      ))}
    </div>
  );
}

interface PartyRow {
  key: PremiumLabelKey;
  value: ReactNode;
  /** صف بعرض البطاقة كلها (الاسم، العنوان) في الشبكة المدمجة. */
  wide?: boolean;
}

/**
 * الشبكة المدمجة لبطاقة بائع المبسطة: عمودان، والصفوف العريضة (الاسم/العنوان) بعرض البطاقة. يُحشى فراغ خلية حين يقع صف عريض
 * بعد خلية مفردة فلا يلتف الترتيب. تُرسم الحدود الفاصلة بين الصفوف والأعمدة كخلايا الجدول.
 */
function CompactPartyRows({ rows, mode }: { rows: PartyRow[]; mode: Mode }) {
  type Cell = { key: string; row: PartyRow | null; wide: boolean; column: number };
  const cells: Cell[] = [];
  let column = 0;
  rows.forEach((row) => {
    if (row.wide && column === 1) { cells.push({ key: `pad-${row.key}`, row: null, wide: false, column: 1 }); column = 0; }
    cells.push({ key: row.key, row, wide: !!row.wide, column: row.wide ? 0 : column });
    column = row.wide ? 0 : (column + 1) % 2;
  });
  if (column === 1) cells.push({ key: 'pad-end', row: null, wide: false, column: 1 });
  return (
    <div className="grid grid-cols-2" data-premium-party-grid>
      {cells.map((cell, index) => (
        <div
          key={cell.key}
          className={cn('flex min-w-0 items-start gap-3 px-4 py-1', cell.wide && 'col-span-2', index > 0 && 'border-t')}
          style={{ borderColor: 'var(--pv-line)', ...(cell.column === 1 ? { borderInlineStart: '1px solid var(--pv-line)' } : {}) }}
          data-premium-party-row={cell.row?.key}
        >
          {cell.row ? (
            <>
              <div className="w-[5.6rem] shrink-0 text-[10px] font-semibold leading-snug" style={{ color: 'var(--pv-muted)' }}><Bi pair={label(cell.row.key)} mode={mode} /></div>
              <div className="min-w-0 flex-1 break-words text-[11.5px] font-bold leading-snug text-black">{cell.row.value}</div>
            </>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function PartyCard({ title, rows, mode, kind, compact = false }: { title: PremiumLabelPair; rows: PartyRow[]; mode: Mode; kind: 'seller' | 'buyer'; compact?: boolean }) {
  return (
    <div className="min-w-0 overflow-hidden rounded-xl border" style={{ borderColor: 'var(--pv-line)' }} data-premium-party={kind}>
      <div className="flex items-center justify-between gap-3 px-4 py-1.5 leading-[1.7] text-white" style={{ background: 'var(--pv-deep)' }}>
        {mode === 'bilingual' ? (
          <>
            <span className="text-[13px] font-extrabold">{title.ar}</span>
            <span className="text-[10px] font-bold uppercase tracking-[0.2em]" style={{ color: 'var(--pv-accent)' }} dir="ltr">{title.en}</span>
          </>
        ) : (
          <span className={cn('text-[13px] font-extrabold', mode === 'en' && 'uppercase tracking-wide')}>{mode === 'en' ? title.en : title.ar}</span>
        )}
      </div>
      {compact ? <CompactPartyRows rows={rows} mode={mode} /> : (
        <div>
          {rows.map((row, index) => (
            <div key={row.key} className={cn('flex items-start gap-3 px-4 py-1', index > 0 && 'border-t')} style={{ borderColor: 'var(--pv-line)' }} data-premium-party-row={row.key}>
              <div className="w-[6.4rem] shrink-0 text-[10px] font-semibold leading-snug" style={{ color: 'var(--pv-muted)' }}>
                <Bi pair={label(row.key)} mode={mode} />
              </div>
              <div className="min-w-0 flex-1 break-words text-[11.5px] font-bold leading-snug text-black">{row.value}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const join = (...parts: (string | null | undefined)[]) => parts.map((part) => part?.trim()).filter((part): part is string => !!part);

function PartiesSection({ model, mode }: { model: DocumentModel; mode: Mode }) {
  const { seller, buyer } = model;
  const phones = (party: typeof seller) => join(party.phone, party.mobile);
  // العنوان: المصدر يفضّل العنوان التفصيلي؛ المدينة تُضاف فقط إن لم يذكرها النص أصلاً.
  const address = (party: typeof seller) => {
    const full = party.address?.trim() ?? '';
    const city = party.city?.trim() ?? '';
    return full && city && !full.includes(city) ? `${full}، ${city}` : full || city;
  };
  const variant = useVariant();
  const simplified = variant === 'simplified';
  const rows = (party: typeof seller, nameKey: PremiumLabelKey): PartyRow[] => {
    const list: PartyRow[] = [{ key: nameKey, value: party.name || '—', wide: simplified }];
    if (party.vatNumber?.trim()) list.push({ key: 'vat_no', value: ltrValue(party.vatNumber.trim()) });
    if (party.crNumber?.trim()) list.push({ key: 'cr_no', value: ltrValue(party.crNumber.trim()) });
    // المبسطة: الهاتف والعنوان في صف واحد (نصف عرض لكلٍّ) بعد الرقم الضريبي والسجل؛ العنوان الطويل يلتف داخل خليته.
    if (simplified) {
      if (phones(party).length > 0) list.push({ key: 'phone', value: ltrValue(phones(party).join('  ·  ')) });
      if (address(party)) list.push({ key: 'address', value: address(party) });
      return list;
    }
    if (address(party)) list.push({ key: 'address', value: address(party) });
    if (phones(party).length > 0) list.push({ key: 'phone', value: ltrValue(phones(party).join('  ·  ')) });
    return list;
  };

  if (simplified) {
    // العميل اختياري: يُعرض اسمه إن وُجد في شريط واحد (ورقمه الضريبي إن كان لديه)، ولا تُفرض بقية بيانات المشتري ولا يُختلق عميل.
    const customer = (buyer.name ?? '').trim();
    const customerVat = buyer.vatNumber?.trim();
    const named = customer !== '' && customer !== '—';
    return (
      <section className="mt-2.5 px-8" data-premium-parties>
        <MetaTiles model={model} mode={mode} />
        <div className="mt-2.5">
          <PartyCard kind="seller" title={label('seller')} rows={rows(seller, 'trade_name')} mode={mode} compact />
        </div>
        {named ? (
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 rounded-xl border px-4 py-1.5" style={{ borderColor: 'var(--pv-line)' }} data-premium-customer>
            <span className="shrink-0 text-[10px] font-semibold leading-snug" style={{ color: 'var(--pv-muted)' }}><Bi pair={label('customer_optional')} mode={mode} /></span>
            <span dir="auto" className="min-w-0 break-words text-[12px] font-extrabold leading-snug text-black" data-premium-customer-name>{customer}</span>
            {customerVat ? (
              <span className="ms-auto flex shrink-0 items-baseline gap-1.5 text-[10px]" style={{ color: 'var(--pv-muted)' }} data-premium-customer-vat>
                <Bi pair={label('vat_no')} mode={mode} />
                <span className="font-sans text-[11px] font-bold tabular-nums text-black" dir="ltr">{customerVat}</span>
              </span>
            ) : null}
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className="mt-2.5 px-8" data-premium-parties>
      <MetaTiles model={model} mode={mode} />
      <div className="mt-2.5 grid grid-cols-2 gap-4">
        <PartyCard kind="seller" title={label('seller')} rows={rows(seller, 'trade_name')} mode={mode} />
        <PartyCard kind="buyer" title={label('buyer')} rows={rows(buyer, 'customer_name')} mode={mode} />
      </div>
    </section>
  );
}

function defaultAlignment(id: PremiumColumn['id']): DocBlockAlignment {
  return id === 'product' || id === 'description' ? 'start' : 'center';
}

/** رمز المنتج تحت الاسم: سطر مستقل صغير؛ لا يظهر إن لم يتوفر الرمز أو كان مكرراً في الاسم/الوصف. */
function SkuLine({ line, className }: { line: DocumentModel['lines'][number]; className?: string }) {
  const code = premiumSkuLine(line);
  if (!code) return null;
  return (
    <div className={cn('mt-0.5 flex items-baseline gap-1.5 text-[9.5px] leading-snug', className)} style={{ color: 'var(--pv-muted)' }} data-premium-sku>
      <span className="font-semibold" dir="ltr">SKU</span>
      <span dir="ltr" className="min-w-0 break-all font-sans tabular-nums">{code}</span>
    </div>
  );
}

const HEAD_CELL = 'px-1.5 py-1 font-extrabold leading-snug whitespace-normal break-words';
// حشو علوي أقل من السفلي بـ4px: مصدّر PDF (html2canvas) ينزل نص الخلية قليلاً فيلامس آخر صف الحد السفلي؛ هذا التعويض يوسّطه هناك دون تغيير ارتفاع الصف.
const BODY_CELL = 'px-1.5 pb-[7px] pt-[3px] leading-snug align-middle';
/** الأحجام المضغوطة الافتراضية؛ الحجم المحفوظ للكتلة (`font_size`) يغلبها كاملةً كما في `blockTextClassName`. */
const COMPACT_ITEMS = { head: 'text-[10px]', body: 'text-[11px]', name: 'text-[11.5px]', secondary: 'text-[9.5px]', code: 'text-[10px]' } as const;
const SAVED_ITEMS_SIZE = { sm: 'text-xs', md: 'text-sm', lg: 'text-base' } as const;

function ItemsSection({ model, mode }: { model: DocumentModel; mode: Mode }) {
  const properties = useDocBlockProperties('items');
  const variant = useVariant();
  const { columns, skuInName } = premiumResolveColumns(model.lines, properties.columns, variant);
  const widths = premiumColumnWidths(columns);
  const hasProductColumn = columns.some((column) => column.id === 'product');
  // كما `DocItemsTable`: محاذاة العمود ثم محاذاة كتلة البنود المحفوظة ثم الافتراضي.
  const saved = properties.font_size ? SAVED_ITEMS_SIZE[properties.font_size] : null;
  const size = saved
    ? { head: saved, body: saved, name: saved, secondary: 'text-[0.8em]', code: saved }
    : COMPACT_ITEMS;
  const alignOf = (column: { id: PremiumColumn['id']; alignment?: DocBlockAlignment }): DocBlockAlignment => column.alignment ?? properties.alignment ?? defaultAlignment(column.id);
  const money = (minor: number | null | undefined) => (minor === null || minor === undefined ? '—' : formatModernAmount(minor, model.currency));
  const dash = (minor: number | null | undefined) => (minor === null || minor === undefined || minor === 0 ? '–' : formatModernAmount(minor, model.currency));
  const fillers = Math.max(0, premiumMinRows(variant) - model.lines.length);
  const lineBorder = 'var(--pv-line)';

  // الأعمدة المالية تُحاذى على الفاصلة العشرية: كل رقم يملأ عرضاً أدنى = أطول نصّ في عموده (`ch`)، فتصطف الخانات
  // رغم تمركز العمود (الصيغة نفسها `formatModernAmount`؛ لا حساب ولا تقريب جديد).
  // تُحسب النصوص والعرض **مرة واحدة** لكل عمود مالي ظاهر (O(أسطر × أعمدة)) — لا إعادة مسح لكل خلية.
  const MONEY: Partial<Record<PremiumColumn['id'], (line: DocumentModel['lines'][number]) => string>> = {
    unit_price: (l) => money(l.unitPrice),
    price_before_tax: (l) => money(l.priceBeforeTax),
    line_discount: (l) => dash(l.lineDiscount),
    line_net: (l) => money(l.netAmount),
    tax: (l) => money(l.tax),
    total: (l) => money(l.total),
  };
  const moneyColumns = new Map<PremiumColumn['id'], { texts: string[]; widthCh: number }>();
  for (const column of columns) {
    const text = MONEY[column.id];
    if (!text || moneyColumns.has(column.id)) continue;
    const texts = model.lines.map(text);
    moneyColumns.set(column.id, { texts, widthCh: texts.reduce((max, t) => Math.max(max, t.length), 0) });
  }
  const moneyCell = (id: PremiumColumn['id'], rowIndex: number, className?: string) => {
    const col = moneyColumns.get(id);
    return (
      <span dir="ltr" className={cn('inline-block text-end font-sans tabular-nums', className)} style={{ minWidth: `${col?.widthCh ?? 0}ch` }}>{col?.texts[rowIndex]}</span>
    );
  };

  const cell = (id: PremiumColumn['id'], line: DocumentModel['lines'][number], index: number): ReactNode => {
    switch (id) {
      case 'number': return <span className="font-sans tabular-nums" style={{ color: 'var(--pv-muted)' }}>{index + 1}</span>;
      case 'product': {
        const name = line.productName?.trim() || line.description?.trim() || '—';
        const secondary = line.description?.trim() && line.description.trim() !== name ? line.description.trim() : null;
        return (
          <>
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0">
              <span dir="auto" className={cn('break-words font-bold text-black', size.name)}>{name}</span>
              {secondary ? <span dir="auto" className={cn('break-words font-normal', size.secondary)} style={{ color: 'var(--pv-muted)' }}>{secondary}</span> : null}
            </div>
            {skuInName && hasProductColumn ? <SkuLine line={line} /> : null}
          </>
        );
      }
      case 'description': return (
        <>
          <span className="break-words">{line.description || '—'}</span>
          {skuInName && !hasProductColumn ? <SkuLine line={line} /> : null}
        </>
      );
      case 'product_code': return <span className={cn('break-words font-sans tabular-nums', size.code)}>{line.productCode || '—'}</span>;
      case 'barcode': return <span className={cn('font-sans tabular-nums', size.code)}>{line.barcode || '—'}</span>;
      case 'unit': return <span className="break-words">{line.unit?.trim() || '—'}</span>;
      case 'quantity': return <span className="font-sans tabular-nums font-semibold">{line.quantity}</span>;
      case 'unit_price': return moneyCell(id, index);
      case 'price_before_tax': return moneyCell(id, index);
      case 'line_discount': return moneyCell(id, index);
      case 'line_net': return moneyCell(id, index);
      case 'tax_rate': return <span className="font-sans tabular-nums">{line.taxRate === null || line.taxRate === undefined ? '—' : `${line.taxRate}%`}</span>;
      case 'tax': return moneyCell(id, index);
      case 'total': return moneyCell(id, index, 'font-extrabold');
    }
  };

  const cellStyle = (index: number): CSSProperties | undefined => (index > 0 ? { borderInlineStart: `1px solid ${lineBorder}` } : undefined);

  return (
    <section className="mt-2.5 px-8" data-premium-items>
      <div className={cn('overflow-hidden rounded-xl border', blockTextClassName(properties))} style={{ borderColor: 'var(--pv-line)' }}>
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr style={{ background: 'var(--pv-deep)', color: 'var(--doc-brand-contrast)' }}>
              {columns.map((column, index) => (
                <th
                  key={`${column.id}-${index}`}
                  data-premium-col={column.id}
                  className={cn(HEAD_CELL, size.head, textAlign[alignOf(column)])}
                  style={{ width: `${widths[index]}%`, ...(index > 0 ? { borderInlineStart: '1px solid rgba(255,255,255,0.18)' } : {}) }}
                >
                  <Bi pair={column.label ?? PREMIUM_COLUMN_LABELS[column.id]} mode={mode} enClassName="font-medium" />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {model.lines.map((line, rowIndex) => (
              <tr key={line.id} className="break-inside-avoid" style={{ borderTop: `1px solid ${lineBorder}` }} data-premium-row="line">
                {columns.map((column, index) => (
                  <td key={`${column.id}-${index}`} className={cn(BODY_CELL, size.body, textAlign[alignOf(column)])} style={cellStyle(index)}>
                    {cell(column.id, line, rowIndex)}
                  </td>
                ))}
              </tr>
            ))}
            {Array.from({ length: fillers }, (_, i) => (
              <tr key={`filler-${i}`} className="break-inside-avoid" style={{ borderTop: `1px solid ${lineBorder}`, height: '1.75rem' }} data-premium-row="filler" aria-hidden>
                {columns.map((column, index) => (
                  <td key={`${column.id}-${index}`} className={cn(BODY_CELL, size.body, 'text-center')} style={cellStyle(index)}>
                    {column.id === 'number' ? <span className="font-sans tabular-nums" style={{ color: 'var(--pv-muted)' }}>{model.lines.length + i + 1}</span> : null}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TotalsBox({ model, mode }: { model: DocumentModel; mode: Mode }) {
  const variant = useVariant();
  const rows = premiumTotalsRows(model);
  const { currency, totals } = model;
  const labelFor = (key: (typeof rows)[number]['key']): PremiumLabelPair => {
    if (key === 'taxable') return label('taxable_total');
    if (key === 'vat') {
      // نسبة موحَّدة معلنة من المصدر تُذكر كما في المرجع («… 15%»)؛ نسب متعددة أو غير معلنة بلا رقم.
      const rate = typeof totals.taxRate === 'number' ? ` ${totals.taxRate}%` : '';
      return { ar: `${PREMIUM_LABELS.vat.ar}${rate}`, en: `${PREMIUM_LABELS.vat.en}${rate}` };
    }
    // المبسطة بلا خصم/شحن/تسوية: المجموع هو «الإجمالي قبل الضريبة» كالمرجع؛ وإلا يبقى «المجموع» كي لا يُسمّى إجمالياً ما سبق خصماً أو رسماً.
    if (key === 'subtotal' && variant === 'simplified' && rows.every((r) => r.key === 'subtotal' || r.key === 'vat')) return PREMIUM_LABELS.total_excl_vat;
    return MODERN_TOTAL_LABELS[key];
  };

  return (
    <div className="min-w-0 overflow-hidden rounded-xl border" style={{ borderColor: 'var(--pv-line)' }} data-premium-totals>
      {rows.map((row, index) => (
        <div key={row.key} className={cn('flex items-center justify-between gap-3 px-3.5 py-1', index > 0 && 'border-t')} style={{ borderColor: 'var(--pv-line)' }} data-premium-total-row={row.key}>
          <span className="min-w-0 text-[11px] font-bold leading-tight text-black"><Bi pair={labelFor(row.key)} mode={mode} enClassName="font-medium" /></span>
          <Money minor={row.amount} currency={currency} mode={mode} className="shrink-0 text-[12px] font-bold text-black" />
        </div>
      ))}
      <div className="flex items-center justify-between gap-3 px-3.5 py-1.5 text-white" style={{ background: 'var(--pv-deep)' }} data-premium-grand-total>
        <span className="min-w-0 text-[12px] font-extrabold leading-snug"><Bi pair={MODERN_TOTAL_LABELS.grand_total} mode={mode} enClassName="font-medium" /></span>
        <Money minor={totals.total} currency={currency} mode={mode} className="shrink-0 text-[18px] font-extrabold" />
      </div>
    </div>
  );
}

function QrBox({ model, mode }: { model: DocumentModel; mode: Mode }) {
  const qr = model.qr?.value;
  if (!qr) return null;
  return (
    <div className="flex flex-col items-center gap-1.5 rounded-xl border p-2.5" style={{ borderColor: 'var(--pv-line)' }} data-premium-qr>
      <div className="rounded-md bg-white p-1">
        <QRCodeSVG value={qr} size={PREMIUM.qrSizePx} level="M" />
      </div>
      <div className="text-center text-[9.5px] leading-snug" style={{ color: 'var(--pv-muted)' }}>
        {model.qr?.note ?? <Bi pair={label('qr_caption')} mode={mode} className="items-center" />}
      </div>
    </div>
  );
}

function InfoCard({ title, mode, children, kind }: { title: PremiumLabelPair; mode: Mode; children: ReactNode; kind: string }) {
  return (
    <div className="min-w-0 rounded-xl border px-3.5 py-2.5" style={{ borderColor: 'var(--pv-line)' }} data-premium-card={kind}>
      <div className="mb-1.5 text-[10px] font-semibold" style={{ color: 'var(--pv-muted)' }}><Bi pair={title} mode={mode} /></div>
      {children}
    </div>
  );
}

/** ملاحظات الدفع والشروط: نصّ المستند + الشروط (أو محتواها الثابت المحدَّد في المحرر). */
function NotesCard({ model, mode, showNotes, showTerms }: { model: DocumentModel; mode: Mode; showNotes: boolean; showTerms: boolean }) {
  const notesProps = useDocBlockProperties('notes');
  const termsProps = useDocBlockProperties('terms');
  const notes = showNotes ? model.notes?.trim() : '';
  const terms = showTerms ? (termsProps.static_content ?? model.terms)?.trim() : '';
  if (!notes && !terms) return null;
  const body = 'whitespace-pre-line break-words text-[11.5px] leading-relaxed text-black';
  return (
    <InfoCard title={label('notes_terms')} mode={mode} kind="notes">
      {notes ? <p dir="auto" className={blockTextClassName(notesProps, body)}>{notes}</p> : null}
      {terms ? <p dir="auto" className={blockTextClassName(termsProps, cn(body, notes && 'mt-1.5'))}>{terms}</p> : null}
    </InfoCard>
  );
}

function BankCard({ model, mode }: { model: DocumentModel; mode: Mode }) {
  const properties = useDocBlockProperties('bank');
  const content = (properties.static_content ?? model.bank)?.trim();
  if (!content) return null;
  return (
    <InfoCard title={label('bank_details')} mode={mode} kind="bank">
      <p dir="auto" className={blockTextClassName(properties, 'whitespace-pre-line break-words text-[11.5px] leading-relaxed text-black')}>{content}</p>
    </InfoCard>
  );
}

function SummarySection({ model, mode, showQr, composed }: { model: DocumentModel; mode: Mode; showQr: boolean; composed: ReadonlySet<DocSectionKey> }) {
  const qr = showQr && model.qr?.value ? <QrBox model={model} mode={mode} /> : null;
  const showNotes = composed.has('notes');
  const showTerms = composed.has('terms');
  const middle = (
    <>
      <NotesCard model={model} mode={mode} showNotes={showNotes} showTerms={showTerms} />
      {composed.has('bank') ? <BankCard model={model} mode={mode} /> : null}
      {/* المبسطة: المبلغ كتابةً بطاقة في العمود الأوسط تحت الملاحظات (كالمرجع) بدل قسم بعرض الصفحة. */}
      {composed.has('amountWords') ? <AmountWordsCard model={model} mode={mode} marker /> : null}
    </>
  );
  // DOM: QR ثم الملاحظات ثم الإجماليات — في RTL يقع الـQR عند الحافة اليمنى كالمرجع، وفي LTR يُعكس تلقائياً.
  return (
    <section className="mt-2.5 grid items-start gap-3 px-8 break-inside-avoid" style={{ gridTemplateColumns: `${qr ? '8.4rem ' : ''}minmax(0, 1fr) 18rem` }} data-premium-summary>
      {qr}
      <div className="flex min-w-0 flex-col gap-3">{middle}</div>
      <TotalsBox model={model} mode={mode} />
    </section>
  );
}

/** نص الملاحظات والشروط أطول من هذا (محارف) ⇒ يُفصل عن صف الإجماليات ويصير قابلاً للانقسام عبر الصفحات. */
const LONG_NOTES_CHARS = 420;

/** يقيس النص الفعلي الذي ستعرضه `NotesCard`: الشروط = المحتوى الثابت المحفوظ في الاستوديو إن وُجد وإلا `model.terms`. */
function notesLength(model: DocumentModel, keys: ReadonlySet<DocSectionKey>, termsStatic?: string): number {
  const terms = (termsStatic ?? model.terms)?.trim().length ?? 0;
  return (keys.has('notes') ? model.notes?.trim().length ?? 0 : 0) + (keys.has('terms') ? terms : 0);
}

function CardsRow({ model, mode, keys, long = false }: { model: DocumentModel; mode: Mode; keys: ReadonlySet<DocSectionKey>; long?: boolean }) {
  return (
    <section className={cn('mt-2.5 grid items-start gap-3 px-8', long ? 'grid-cols-1' : 'break-inside-avoid grid-cols-2')} data-premium-cards={long ? 'long' : ''}>
      <NotesCard model={model} mode={mode} showNotes={keys.has('notes')} showTerms={keys.has('terms')} />
      {keys.has('bank') ? <BankCard model={model} mode={mode} /> : null}
    </section>
  );
}

function AmountWords({ model, mode }: { model: DocumentModel; mode: Mode }) {
  return (
    <section className="mt-2.5 px-8 break-inside-avoid" data-premium-words>
      <AmountWordsCard model={model} mode={mode} />
    </section>
  );
}

function AmountWordsCard({ model, mode, marker = false }: { model: DocumentModel; mode: Mode; marker?: boolean }) {
  const dir = usePremiumDir();
  const total = model.totals.total;
  return (
    <div className="min-w-0 break-inside-avoid">
      <div className="rounded-xl border px-4 py-1.5" style={{ borderColor: 'var(--pv-line)' }} data-premium-words={marker ? '' : undefined}>
        <div className="mb-0.5 text-[10px] font-semibold" style={{ color: 'var(--pv-muted)' }}><Bi pair={label('amount_words')} mode={mode} /></div>
        {mode !== 'en' ? <div className="break-words text-[13px] font-bold leading-relaxed text-black" data-premium-words-ar>{amountToWords(total, model.currency, 'ar')}</div> : null}
        {/* الترجمة الإنجليزية سطر ثانوي أصغر درجة ومفصول بمسافة: لا تزاحم الجملة العربية ولا تتجاوز عرض البطاقة. */}
        {mode !== 'ar' ? (
          <div
            className={cn('break-words text-[10.5px] leading-relaxed', mode === 'bilingual' ? 'mt-1' : 'text-[13px] font-bold text-black')}
            style={{ textAlign: dir === 'rtl' ? 'right' : 'left', ...(mode === 'bilingual' ? { color: 'var(--pv-muted)' } : {}) }}
            dir="ltr"
            data-premium-words-en
          >
            {amountToWords(total, model.currency, 'en')}
          </div>
        ) : null}
      </div>
    </div>
  );
}

/** حجم الصورة الافتراضي (بلا `image_size` محفوظ) مضغوط كي تبقى عينة المرجع في صفحة A4 واحدة؛ الحجم المحفوظ يغلب بصنوف الكتل المشتركة. */
const COMPACT_SIGNATURE = 'max-h-[10mm] w-auto max-w-full object-contain';
const COMPACT_STAMP = 'max-h-[12mm] w-auto max-w-full object-contain';

function SignatureRow({ model, mode, showSignature, showStamp }: { model: DocumentModel; mode: Mode; showSignature: boolean; showStamp: boolean }) {
  const signatureProps = useDocBlockProperties('signature');
  const stampProps = useDocBlockProperties('stamp');
  const box = 'relative flex min-h-[20mm] flex-col justify-between rounded-xl border-2 border-dashed px-4 py-2';
  const sign = showSignature ? model.signatureUrl : null;
  const stamp = showStamp ? model.stampUrl : null;
  return (
    <section className="mt-2.5 grid grid-cols-2 gap-4 px-8 break-inside-avoid" data-premium-signatures>
      {showSignature ? (
        <div className={box} style={{ borderColor: 'var(--pv-line)' }} data-premium-sign-box="receiver">
          <div className="text-[10px] font-semibold" style={{ color: 'var(--pv-muted)' }}><Bi pair={label('received_by')} mode={mode} /></div>
        </div>
      ) : null}
      <div className={box} style={{ borderColor: 'var(--pv-line)' }} data-premium-sign-box="seller">
        <div className="text-[10px] font-semibold" style={{ color: 'var(--pv-muted)' }}><Bi pair={label('seller_signature')} mode={mode} /></div>
        {sign || stamp ? (
          <div className="mt-1 flex items-end gap-4">
            {sign ? (
              <div className={cn('flex min-w-0 flex-1', blockJustifyClassName(signatureProps))} data-premium-signature-cell>
                {/* eslint-disable-next-line @next/next/no-img-element -- data URL */}
                <img src={sign} alt="signature" className={cn(signatureProps.image_size ? getDocumentImagePreviewClass('signature', signatureProps.image_size) : COMPACT_SIGNATURE, getDocumentImagePreviewOpacityClass('signature', signatureProps.image_opacity))} />
              </div>
            ) : null}
            {stamp ? (
              <div className={cn('flex min-w-0 flex-1', blockJustifyClassName(stampProps))} data-premium-stamp-cell>
                {/* eslint-disable-next-line @next/next/no-img-element -- data URL */}
                <img src={stamp} alt="stamp" className={cn(stampProps.image_size ? getDocumentImagePreviewClass('stamp', stampProps.image_size) : COMPACT_STAMP, getDocumentImagePreviewOpacityClass('stamp', stampProps.image_opacity))} />
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** تذييل بيانات المنشأة: اسمها ونوع المستند — الرقم الضريبي والسجل — الهاتف، ويعلوه نص التذييل المخصّص إن وُجد. */
function PremiumFooter({ model, mode, locale }: { model: DocumentModel; mode: Mode; locale: string }) {
  const dt = useTranslations('documentTypes');
  const dtAlt = useTranslations('documentTypesAlt');
  const properties = useDocBlockProperties('footer');
  const isAr = locale.toLowerCase().startsWith('ar');
  const titlePair: PremiumLabelPair = isAr ? { ar: dt(model.type), en: dtAlt(model.type) } : { ar: dtAlt(model.type), en: dt(model.type) };
  const title = single(titlePair, mode);
  const { seller } = model;
  const custom = (properties.static_content ?? model.footerText)?.trim();
  const ids = join(
    seller.crNumber?.trim() ? `${single(PREMIUM_LABELS.cr_no, mode)} ${seller.crNumber.trim()}` : null,
    seller.vatNumber?.trim() ? `${single(PREMIUM_LABELS.vat_no, mode)} ${seller.vatNumber.trim()}` : null,
  );
  const phones = join(seller.phone, seller.mobile);

  return (
    <footer className="mt-auto pt-2" data-premium-footer>
      {custom ? <div className={blockTextClassName(properties, 'px-8 pb-2 text-center text-[10px] leading-relaxed')} style={{ color: 'var(--pv-muted)' }}>{custom}</div> : null}
      <div className="mx-8 mb-3 flex items-center justify-between gap-4 border-t pt-3 text-[10px]" style={{ borderColor: 'var(--pv-line)', color: 'var(--pv-muted)' }}>
        <span className="min-w-0 break-words font-bold text-black">{[seller.name?.trim(), title].filter(Boolean).join(' · ')}</span>
        {ids.length > 0 ? <span className="min-w-0 text-center">{ids.join('  ·  ')}</span> : null}
        {phones.length > 0 ? <span className="font-sans tabular-nums shrink-0 font-bold text-black" dir="ltr">{phones.join('  ·  ')}</span> : null}
      </div>
    </footer>
  );
}

/**
 * قالب الفاتورة الضريبية الفاخرة (`tax-invoice-premium-v1`) — مستقل عن `DocumentBody`، يستهلك `DocumentModel` وحده.
 *
 * يحترم تخطيط المحرر المحفوظ (ترتيب/إظهار الأقسام) وخصائص الكتل (أعمدة الجدول، المحتوى الثابت، المحاذاة)؛
 * الملاحظات والشروط والبنك تُركَّب داخل صف الإجماليات كما في المرجع، وتنفرد في صف خاص إن أُخفي الملخّص.
 * لا يحسب مبلغاً: كل رقم من النموذج كما هو، والاشتقاق الوحيد المسموح (الإجمالي الخاضع) يُحجب ما لم يطابق المخزَّن.
 */
export function TaxInvoicePremium(props: DocumentTemplateProps) {
  return <PremiumDocument {...props} variant="full" />;
}

/**
 * قالب الفاتورة الضريبية المبسطة الفاخرة (`tax-invoice-simplified-premium-v1`): **المحرك والهوية نفسهما** لـ`tax-invoice-premium-v1`
 * بمتغيّر تركيب `simplified` لا نسخة منه — بطاقة بائع مدمجة، عميل اختياري في شريط، وقت الإصدار، جدول بلا أعمدة خصم/خاضع افتراضياً،
 * المبلغ كتابةً داخل صف الإجماليات، وبلا مربعات توقيع افتراضياً. يبقى `TaxInvoicePremium` بمخرجه حرفياً.
 */
export function TaxInvoiceSimplifiedPremium(props: DocumentTemplateProps) {
  return <PremiumDocument {...props} variant="simplified" />;
}

function PremiumDocument({ model, theme, sections, layout, rootId, variant }: DocumentTemplateProps & { variant: PremiumVariant }) {
  const { locale, mode } = useDocumentLabelMode(model);
  const simplified = variant === 'simplified';
  const defaultLayout = simplified ? SIMPLIFIED_DEFAULT_LAYOUT : PREMIUM_DEFAULT_LAYOUT;
  const palette = premiumPalette(theme);
  const vars = {
    '--pv-deep': palette.deep,
    '--pv-accent': palette.accent,
    '--pv-soft': palette.soft,
    '--pv-line': palette.line,
    '--pv-muted': palette.muted,
  } as CSSProperties;

  const direction = resolveDirection(model.direction, model.seller.name || model.buyer.name);
  const flags = sections ?? {};
  const items: readonly DocSectionLayoutItem[] = layout && layout.length > 0
    ? layout
    : defaultLayout.map((item) => ({ ...item, visible: item.visible && isExplicitSectionVisible(item.key, flags) }));
  const visible = new Set<DocSectionKey>(items.filter((item) => item.visible).map((item) => item.key));
  const blockProperties = items.reduce<DocBlockPropertiesMap>((acc, item) => {
    if (item.properties) acc[item.key] = item.properties;
    return acc;
  }, {});

  const showSummary = visible.has('summary');
  const cardKeys = (['notes', 'terms', 'bank'] as const).filter((key) => visible.has(key));
  const signKeys = (['signature', 'stamp'] as const).filter((key) => visible.has(key));
  let cardsDone = false;
  let signDone = false;

  const render = (key: DocSectionKey): ReactNode => {
    switch (key) {
      case 'header': return <PremiumHeader model={model} showLogo={flags.logo !== false} mode={mode} locale={locale} />;
      case 'barcode': return <div className="mt-3 flex justify-center px-8"><DocBarcode value={model.meta.number} /></div>;
      case 'parties': return <PartiesSection model={model} mode={mode} />;
      case 'items': return <ItemsSection model={model} mode={mode} />;
      case 'summary': {
        const keys = new Set<DocSectionKey>(cardKeys);
        // المبسطة: المبلغ كتابةً يُركَّب في الملخّص (كالمرجع) ما دام قسمه ظاهراً.
        const words = simplified && visible.has('amountWords');
        // ملاحظات/شروط طويلة: الإجماليات والـQR صف مضغوط، وبطاقاتها قسم مستقل قابل للانقسام (بدل دفع الصف كله لصفحة جديدة).
        if (notesLength(model, keys, blockProperties.terms?.static_content) > LONG_NOTES_CHARS) {
          return (
            <>
              <SummarySection model={model} mode={mode} showQr={flags.qr !== false} composed={new Set<DocSectionKey>([...(keys.has('bank') ? ['bank' as const] : []), ...(words ? ['amountWords' as const] : [])])} />
              <CardsRow model={model} mode={mode} keys={new Set<DocSectionKey>(cardKeys.filter((k) => k !== 'bank'))} long />
            </>
          );
        }
        if (words) keys.add('amountWords');
        return <SummarySection model={model} mode={mode} showQr={flags.qr !== false} composed={keys} />;
      }
      case 'amountWords': return simplified && showSummary ? null : <AmountWords model={model} mode={mode} />;
      case 'notes':
      case 'terms':
      case 'bank': {
        if (showSummary || cardsDone) return null;
        cardsDone = true;
        return <CardsRow model={model} mode={mode} keys={new Set(cardKeys)} />;
      }
      case 'signature':
      case 'stamp': {
        if (signDone) return null;
        signDone = true;
        return <SignatureRow model={model} mode={mode} showSignature={signKeys.includes('signature')} showStamp={signKeys.includes('stamp')} />;
      }
      case 'footer': return <PremiumFooter model={model} mode={mode} locale={locale} />;
      case 'voucher': return null;
    }
  };

  return (
    <PremiumVariantContext.Provider value={variant}>
    <PremiumDirContext.Provider value={direction}>
    <DocBlockPropertiesProvider value={blockProperties}>
      <DocLayout
        theme={theme}
        direction={model.direction}
        directionSample={model.seller.name || model.buyer.name}
        style={TAX_INVOICE_PREMIUM_STYLE}
        rootId={rootId}
        rootStyle={vars}
      >
        {/* الأقسام أبناء مباشرون للجذر: مصدّر PDF يقصّ الصفحات عند حدود `children` فلا يشطر الإجماليات أو الـQR أو التوقيع. */}
        {items.map((item) => (item.visible ? <Fragment key={item.key}>{render(item.key)}</Fragment> : null))}
      </DocLayout>
    </DocBlockPropertiesProvider>
    </PremiumDirContext.Provider>
    </PremiumVariantContext.Provider>
  );
}
