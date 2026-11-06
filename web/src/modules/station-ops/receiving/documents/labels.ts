import type { ReceiptLabels } from './receipt-pdf';
import type { ReportLabels } from './report-pdf';

/** يبني تسميات المستندات من كتالوج الرسائل (`stationOps.receiving.doc.*`). `t` من next-intl. */
type T = (key: string) => string;

export function receiptLabels(t: T): ReceiptLabels {
  const d = (key: string) => t(`receiving.doc.${key}`);
  return {
    title: d('title'), reference: d('reference'), status: { draft: t('receiving.status.draft'), approved: t('receiving.status.approved') },
    variantOperational: d('variantOperational'), variantFinancial: d('variantFinancial'),
    company: d('company'), vat: d('vat'), cr: d('cr'), station: t('receiving.doc.station'), supplier: t('receiving.field.supplier'), deliveryNote: t('receiving.field.deliveryNote'), purchaseRef: t('receiving.field.purchaseRef'),
    product: d('product'), tank: t('receiving.field.tank'), warehouse: t('receiving.field.warehouse'), tanker: t('receiving.field.tanker'), driver: t('receiving.field.driver'), receivedAt: d('receivedAt'),
    quantities: t('receiving.detail.quantitiesTitle'), dispatched: t('receiving.field.dispatched'), received: t('receiving.field.received'), variance: d('variance'), variancePct: d('variancePct'), unit: t('receiving.unit'),
    readings: t('receiving.detail.readingsTitle'), physical: t('receiving.readingType.physical'), atg: t('receiving.readingType.atg'), before: t('receiving.detail.before'), after: t('receiving.detail.after'), tankGain: t('receiving.detail.tankGain'),
    cost: d('cost'), costTotal: d('costTotal'), costPerLiter: d('costPerLiter'), costRecordedBy: d('costRecordedBy'), costMissing: t('receiving.cost.missing'), currency: d('currency'),
    attachments: t('receiving.attach.title'), noAttachments: t('receiving.attach.none'), notes: t('receiving.field.notes'), receiver: d('receiver'), approver: d('approver'), driverSignature: d('driverSignature'), signature: d('signature'), notApproved: d('notApproved'),
    generatedBy: d('generatedBy'), generatedAt: d('generatedAt'), page: d('page'), operationalNote: d('operationalNote'),
  };
}

export function reportLabels(t: T): ReportLabels {
  const r = receiptLabels(t);
  const d = (key: string) => t(`receiving.doc.${key}`);
  return {
    company: r.company, vat: r.vat, cr: r.cr, status: r.status, variantOperational: r.variantOperational, variantFinancial: r.variantFinancial, unit: r.unit,
    generatedBy: r.generatedBy, generatedAt: r.generatedAt, page: r.page, operationalNote: r.operationalNote, reference: r.reference, supplier: r.supplier, product: r.product,
    tank: r.tank, station: r.station, deliveryNote: r.deliveryNote, dispatched: r.dispatched, received: r.received, variance: r.variance,
    title: d('reportTitle'), date: d('receivedAt'), stateCol: d('state'), total: d('total'), count: d('count'), costCol: d('costCol'), uncosted: d('uncosted'), truncated: d('truncated'), empty: d('empty'), filtersTitle: d('filtersTitle'),
    filterLabels: { q: d('filter.q'), status: d('filter.status'), cost: d('filter.cost'), from: d('filter.from'), to: d('filter.to'), supplier_id: d('filter.supplier'), station_id: d('filter.station') },
  };
}
