import { utcIsoToZonedWallTime } from '@/lib/timezone';
import { buildCashSummaryView } from '../cash-summary';
import type { StationCatalog } from '../catalog';
import type { CollectionView } from '../collection';
import { elapsedBetween, formatLitersFixedFromMl, parseInstant } from '../format';
import { buildShiftReadings, type NozzleReadingRow } from '../readings';
import type { ShiftDetail, Station } from '../schemas';
import { minorText } from '../receiving/documents/pdf-kit';

/**
 * AWJ-DOC-V2-PR7 — نموذج تقرير إغلاق وتسليم الوردية (دالة نقية بلا I/O ولا شبكة).
 *
 * **مصدر واحد لثلاثة مخرجات**: المعاينة (DOM) والـPDF والطباعة تقرأ هذا النموذج وحده؛ فاتساقها بالبناء لا بالمحاكاة.
 * المدخلات هي ما تعيده قراءات الوردية القائمة (تفاصيل الوردية، لقطة التحصيل، أصول المحطة) — **لا حساب مالي هنا**:
 * كل مبلغ/فرق/إجمالي يأتي نصّاً من الخادم، والغائب «غير متاح» لا صفراً. الطرح الوحيد (فرق قراءة عدّاد الفوهة) هو ما تعرضه شاشة الوردية نفسها.
 *
 * ثبات التاريخ: المبالغ والتسوية **لا تُطبع إلا من لقطة التحصيل المجمَّدة عند الإغلاق** (`state === 'frozen'`)؛ وردية أُغلقت بلا لقطة (إقرار
 * التحصيل مغلق/غير موجود) تُطبع قراءاتها ولتراتها ونقدها المخزَّن فقط، وتُعلن الأقسام المالية غير متاحة — لا تُحتسب من أسعار حيّة.
 */

export type ReportPaper = 'a4' | 'a5';

export interface Cell { text: string; na?: boolean; strong?: boolean }
export interface KvRow { label: string; value: Cell }
export interface TableColumn { key: string; label: string; align: 'start' | 'end' }

export type ReportSection =
  | { kind: 'kv'; key: string; title: string | null; columns: 2 | 3 | 4; rows: KvRow[]; emphasis?: boolean }
  | { kind: 'table'; key: string; title: string; columns: TableColumn[]; rows: Cell[][]; totals: Cell[] | null }
  | { kind: 'note'; key: string; tone: 'info' | 'warning'; text: string }
  | { kind: 'signatures'; key: string; title: string; cells: Array<{ role: string; name: Cell | null; when: string | null }> };

export interface ShiftReportModel {
  paper: ReportPaper;
  variant: 'detailed' | 'brief';
  title: string;
  variantLabel: string;
  status: { key: 'closed' | 'approved'; label: string };
  company: { name: string; vat: string | null; cr: string | null };
  labels: { vat: string; cr: string; signature: string; generatedAt: string; page: string };
  generatedAt: string;
  sections: ReportSection[];
  fileName: string;
}

export interface ShiftReportInput {
  /** مفاتيح نسبية لـ`stationOps.shiftReport` (مثل `doc.field.number`). */
  t: (key: string) => string;
  company: { name?: string | null; vat_number?: string | null; cr_number?: string | null } | null;
  station: Station;
  detail: ShiftDetail;
  catalog: StationCatalog | null;
  /** `null` = لقطة التحصيل غير متاحة (بوابة مغلقة/لا صلاحية/خطأ) — لا تُخمَّن. */
  collection: CollectionView | null;
  viewer: { id: string; name: string };
  paper: ReportPaper;
  generatedAt: Date;
}

/** وردية مغلقة/معتمدة فقط؛ المفتوحة لا تقرير إغلاق لها. */
export function isReportableShift(status: string): status is 'closed' | 'approved' {
  return status === 'closed' || status === 'approved';
}

/** `YYYY-MM-DD HH:mm` بمنطقة المحطة (0–9 دائماً) عبر مُحوِّل المنطقة الزمنية المركزي؛ غير صالح ⇒ `null`. منطقة غير صالحة/غائبة ⇒ منطقة المؤسسة الافتراضية (لا منطقة الجهاز). */
export function stamp(value: string | null | undefined, timeZone: string | null | undefined): string | null {
  if (parseInstant(value) === null) return null;
  const wall = utcIsoToZonedWallTime(value as string, timeZone ?? '');
  return wall ? `${wall.date} ${wall.time}` : null;
}

const litersOf = (ml: number) => formatLitersFixedFromMl(ml, 'en');

export function buildShiftReport(input: ShiftReportInput): ShiftReportModel {
  const { t, station, detail, catalog, collection, viewer, paper } = input;
  const brief = paper === 'a5';
  const zone = station.timezone;
  const status = detail.status === 'approved' ? 'approved' : 'closed';
  const na = (): Cell => ({ text: t('doc.na'), na: true });
  const dash = (): Cell => ({ text: '—', na: true });
  const money = (minor: number | null | undefined, strong = false): Cell => (minor === null || minor === undefined ? na() : { text: `${minorText(minor)} ${t('doc.currency')}`, strong });
  const text = (value: string | null | undefined, strong = false): Cell => (value && value.trim() !== '' ? { text: value.trim(), strong } : na());

  const frozen = collection?.state === 'frozen';
  const sections: ReportSection[] = [];

  // ───── بيانات الوردية ─────
  const opened = stamp(detail.opened_at, zone);
  const closed = stamp(detail.closed_at, zone);
  const approved = stamp(detail.approved_at, zone);
  const total = elapsedBetween(detail.opened_at, detail.closed_at);
  const closer = detail.closed_by ?? null;
  const closerName = closer !== null && closer === viewer.id && viewer.name.trim() !== '' ? viewer.name.trim() : null;
  const shiftRows: KvRow[] = [
    { label: t('doc.field.number'), value: text(detail.number, true) },
    { label: t('doc.field.status'), value: { text: t(`doc.status.${status}`), strong: true } },
    { label: t('doc.field.station'), value: text(station.name) },
    ...(brief ? [] : [{ label: t('doc.field.stationCode'), value: text(station.code) }]),
    { label: t('doc.field.opened'), value: opened ? { text: opened } : na() },
    { label: t('doc.field.closed'), value: closed ? { text: closed } : na() },
    ...(approved && !brief ? [{ label: t('doc.field.approved'), value: { text: approved } }] : []),
    { label: t('doc.field.duration'), value: total ? { text: `${total.hours}:${String(total.minutes).padStart(2, '0')}` } : na() },
    { label: t('doc.field.responsible'), value: closerName ? { text: closerName } : na() },
  ];
  sections.push({ kind: 'kv', key: 'shift', title: brief ? null : t('doc.section.shift'), columns: brief ? 4 : 3, rows: shiftRows });

  // ───── اللترات من العدادات (مصدر الخادم للإجمالي) ─────
  const readings = catalog ? buildShiftReadings(detail, catalog) : null;
  const serverMl = detail.operational_meter_milliliters;

  // ───── المبيعات ─────
  const salesVisible = frozen && collection.sales.visible;
  const frozenProducts = frozen ? collection.sales.products : [];
  type Row = { id: string; name: string; ml: number; price: number | null | undefined; amount: number | null | undefined };
  let productRows: Row[] = [];
  if (frozen) {
    productRows = frozenProducts.map((product) => ({ id: product.fuel_product_id, name: product.name ?? '', ml: product.milliliters, price: salesVisible ? product.price_per_liter_minor : null, amount: salesVisible ? product.amount_minor : null }));
  } else if (readings) {
    const byProduct = new Map<string, Row>();
    for (const group of readings.groups) {
      for (const row of group.rows) {
        if (row.status !== 'complete' || row.deltaMl === null || !row.view?.product) continue;
        const product = row.view.product;
        const current = byProduct.get(product.id) ?? { id: product.id, name: product.name, ml: 0, price: null, amount: null };
        current.ml += row.deltaMl;
        byProduct.set(product.id, current);
      }
    }
    productRows = [...byProduct.values()];
  }
  const showAmounts = salesVisible;
  const salesColumns: TableColumn[] = [
    { key: 'product', label: t('doc.field.product'), align: 'start' },
    { key: 'liters', label: `${t('doc.field.liters')} (${t('doc.unit')})`, align: 'end' },
    ...(showAmounts ? [{ key: 'price', label: t('doc.field.price'), align: 'end' as const }, { key: 'amount', label: t('doc.field.amount'), align: 'end' as const }] : []),
  ];
  const salesTableRows: Cell[][] = productRows.map((row) => [
    text(row.name),
    { text: litersOf(row.ml) },
    ...(showAmounts ? [money(row.price), money(row.amount)] : []),
  ]);
  const salesTotals: Cell[] = [
    { text: t('doc.total.liters'), strong: true },
    { text: litersOf(serverMl), strong: true },
    ...(showAmounts ? [dash(), collection.sales.complete ? money(collection.sales.amount_minor, true) : na()] : []),
  ];
  sections.push({ kind: 'table', key: 'sales', title: t('doc.section.sales'), columns: salesColumns, rows: salesTableRows, totals: salesTotals });

  // ───── قراءات المضخات والفوهات (التفصيلية) ─────
  if (!brief && readings) {
    const rows: Cell[][] = [];
    const push = (row: NozzleReadingRow, pumpLabel: string) => {
      const nozzle = row.view?.nozzle.nozzle_number ?? row.nozzleId.slice(0, 8);
      rows.push([
        text(pumpLabel),
        text(String(nozzle)),
        text(row.view?.product?.name ?? null),
        row.opening ? { text: litersOf(row.opening.meter_milliliters) } : { text: t('doc.reading.missing'), na: true },
        row.closing ? { text: litersOf(row.closing.meter_milliliters) } : { text: t('doc.reading.missing'), na: true },
        row.deltaMl !== null ? { text: litersOf(row.deltaMl), strong: true } : { text: t('doc.reading.incomplete'), na: true },
      ]);
    };
    for (const group of readings.groups) {
      const pumpLabel = group.pump ? `${group.pump.pump_number}${group.pump.name ? ` ${group.pump.name}` : ''}` : '';
      for (const row of group.rows) push(row, pumpLabel);
    }
    for (const row of readings.outsideSetup) push(row, '');
    sections.push({
      kind: 'table', key: 'readings', title: t('doc.section.readings'), totals: null, rows,
      columns: [
        { key: 'pump', label: t('doc.field.pump'), align: 'start' }, { key: 'nozzle', label: t('doc.field.nozzle'), align: 'start' }, { key: 'product', label: t('doc.field.product'), align: 'start' },
        { key: 'opening', label: `${t('doc.field.opening')} (${t('doc.unit')})`, align: 'end' }, { key: 'closing', label: `${t('doc.field.closing')} (${t('doc.unit')})`, align: 'end' }, { key: 'delta', label: `${t('doc.field.delta')} (${t('doc.unit')})`, align: 'end' },
      ],
    });
  }

  // ───── التحصيل والتسوية (من اللقطة المجمَّدة فقط) ─────
  if (frozen) {
    const declaration = collection.declaration;
    if (declaration) {
      if (brief) {
        // المختصر: سطور التحصيل كقيم مرصوصة (طريقة: مبلغ) + الإجمالي من الخادم — بلا جدول ولا حساب.
        sections.push({
          kind: 'kv', key: 'collection', title: t('doc.section.collection'), columns: 4,
          rows: [...declaration.lines.map((line): KvRow => ({ label: line.name, value: money(line.amount_minor) })), { label: t('doc.field.collected'), value: money(declaration.collected_total_minor, true) }],
        });
      } else {
      const rows: Cell[][] = declaration.lines.map((line) => [text(line.name), money(line.amount_minor)]);
      sections.push({
        kind: 'table', key: 'collection', title: t('doc.section.collection'), rows,
        columns: [{ key: 'method', label: t('doc.field.method'), align: 'start' }, { key: 'amount', label: t('doc.field.amount'), align: 'end' }],
        totals: [{ text: t('doc.field.collected'), strong: true }, money(declaration.collected_total_minor, true)],
      });
      }
    } else {
      sections.push({ kind: 'note', key: 'collection-none', tone: 'info', text: t('doc.note.collectionNone') });
    }

    const reconciliation = collection.reconciliation;
    if (reconciliation.visible) {
      const review = collection.review.visible ? collection.review.state : null;
      const direction = reconciliation.direction;
      const rows: KvRow[] = [
        { label: t('doc.field.salesDue'), value: reconciliation.sales_minor === undefined || reconciliation.sales_minor === null ? na() : money(reconciliation.sales_minor) },
        { label: t('doc.field.collected'), value: money(reconciliation.collected_total_minor) },
        {
          label: t('doc.field.difference'),
          value: reconciliation.difference_minor === null || direction === null
            ? na()
            : { text: `${minorText(Math.abs(reconciliation.difference_minor))} ${t('doc.currency')} — ${t(`doc.direction.${direction}`)}`, strong: true },
        },
        ...(reconciliation.final ? [] : [{ label: t('doc.field.result'), value: { text: t('doc.provisional') } }]),
        ...(review ? [{ label: t('doc.field.review'), value: { text: t(`doc.reviewState.${review}`) } }] : []),
      ];
      sections.push({ kind: 'kv', key: 'reconciliation', title: t('doc.section.reconciliation'), columns: brief ? 4 : 3, rows });
    } else {
      sections.push({ kind: 'note', key: 'sales-hidden', tone: 'info', text: t('doc.note.salesHidden') });
    }
  }

  // ───── نقد الدرج (مخزَّن/ملخص الخادم) ─────
  const cashRows: KvRow[] = [];
  if (detail.cash_summary) {
    const view = buildCashSummaryView(detail.cash_summary);
    for (const row of view.rows) {
      if (brief && ['otherOut', 'handover', 'cashIn'].includes(row.key)) continue;
      cashRows.push({ label: t(`doc.cash.${row.key === 'opening' ? 'openingFloat' : row.key}`), value: money(row.amountMinor) });
    }
    cashRows.push({ label: view.expected.kind === 'total' ? t('doc.cash.expected') : t('doc.cash.expectedPartial'), value: money(view.expected.amountMinor, true) });
    cashRows.push({ label: t('doc.cash.counted'), value: money(view.countedMinor, true) });
    cashRows.push({
      label: t('doc.cash.variance'),
      value: view.variance
        ? { text: view.variance.kind === 'final' ? `${minorText(view.variance.amountMinor)} ${t('doc.currency')} — ${t(`doc.direction.${view.variance.direction}`)}` : `${minorText(view.variance.amountMinor)} ${t('doc.currency')} — ${t('doc.provisional')}`, strong: true }
        : na(),
    });
  } else {
    cashRows.push({ label: t('doc.cash.openingFloat'), value: money(detail.opening_float_minor) });
    cashRows.push({ label: t('doc.cash.expected'), value: money(detail.expected_operational_cash_minor ?? null, true) });
    cashRows.push({ label: t('doc.cash.counted'), value: money(detail.counted_cash_minor ?? null, true) });
    const variance = detail.cash_variance_minor;
    cashRows.push({ label: t('doc.cash.variance'), value: variance === null ? na() : { text: `${minorText(Math.abs(variance))} ${t('doc.currency')} — ${t(`doc.direction.${variance === 0 ? 'none' : variance > 0 ? 'overage' : 'shortage'}`)}`, strong: true } });
  }
  sections.push({ kind: 'kv', key: 'cash', title: t('doc.section.cash'), columns: brief ? 4 : 3, rows: cashRows });

  // ───── ملاحظات الصدق ─────
  const notes: ReportSection[] = [];
  if (collection === null) notes.push({ kind: 'note', key: 'amounts-unavailable', tone: 'warning', text: t('doc.note.amountsUnavailable') });
  else if (!frozen) notes.push({ kind: 'note', key: 'amounts-not-frozen', tone: 'warning', text: t('doc.note.amountsNotFrozen') });
  if (readings?.summary.mismatch) notes.push({ kind: 'note', key: 'mismatch', tone: 'warning', text: t('doc.note.mismatch') });
  else if (readings && readings.summary.invalid > 0) notes.push({ kind: 'note', key: 'readings-partial', tone: 'warning', text: t('doc.note.readingsPartial') });
  const namesUnavailable = closerName === null;
  if (namesUnavailable && !brief) notes.push({ kind: 'note', key: 'names-unavailable', tone: 'info', text: t('doc.note.namesUnavailable') });
  notes.push({ kind: 'note', key: 'meter-note', tone: 'info', text: t('doc.note.meterNote') });
  if (brief) notes.push({ kind: 'note', key: 'table-cut', tone: 'info', text: t('doc.note.tableCut') });
  // الملاحظات تأتي بعد الأقسام المالية وقبل التسليم.
  sections.push(...notes);

  // ───── التسليم ─────
  sections.push({
    kind: 'signatures', key: 'handover', title: t('doc.section.handover'),
    cells: [
      { role: t('doc.sign.handedOver'), name: closerName ? { text: closerName } : na(), when: closed },
      { role: t('doc.sign.received'), name: null, when: null },
      { role: t('doc.sign.supervisor'), name: null, when: null },
    ],
  });

  const day = (stamp(detail.closed_at, zone) ?? stamp(input.generatedAt.toISOString(), zone) ?? '').slice(0, 10);
  return {
    paper,
    variant: brief ? 'brief' : 'detailed',
    title: t('doc.title'),
    variantLabel: brief ? t('doc.brief') : t('doc.detailed'),
    status: { key: status, label: t(`doc.status.${status}`) },
    company: { name: input.company?.name?.trim() || '—', vat: input.company?.vat_number?.trim() || null, cr: input.company?.cr_number?.trim() || null },
    labels: { vat: t('doc.vat'), cr: t('doc.cr'), signature: t('doc.sign.signature'), generatedAt: t('doc.footer.generatedAt'), page: t('doc.footer.page') },
    generatedAt: stamp(input.generatedAt.toISOString(), zone) ?? '',
    sections,
    fileName: `shift-report-${String(detail.number).replace(/[^A-Za-z0-9_-]+/g, '-')}-${paper}-${day}.pdf`,
  };
}
