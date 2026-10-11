'use client';

import { Suspense, useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { documentExporter } from '@/modules/documents/services/export';
import { PAPER_SIZES } from '@/modules/documents/constants/paper';
import { CreditNoteDocument } from '@/components/credit-notes/credit-note-document';
import { CREDIT_NOTE_QA_COMPANY, CREDIT_NOTE_QA_CUSTOMER, CREDIT_NOTE_QA_SCENARIOS, makeCreditNoteQaNote, type CreditNoteQaScenario } from '@/modules/documents/qa/credit-note-qa-fixtures';
import { getDefaultDocumentLayout } from '@/modules/documents/registry/document-types';
import type { DocItemsColumn, DocSectionLayoutItem } from '@/modules/documents/types';

/** أعمدة تخطيطٍ محفوظ بأعمدة صريحة (الصيغة التي كانت تُحفظ قبل أعمدة التسوية). */
const SAVED_GENERIC: DocItemsColumn[] = [
  { id: 'number' }, { id: 'description' }, { id: 'quantity' }, { id: 'unit_price' }, { id: 'tax' }, { id: 'total' },
];
const SAVED_WITH_NET: DocItemsColumn[] = [
  { id: 'number' }, { id: 'description' }, { id: 'quantity' }, { id: 'price_before_tax' }, { id: 'tax' }, { id: 'total' },
];

function layoutFor(kind: string): DocSectionLayoutItem[] | null {
  const columns = kind === 'saved-generic' ? SAVED_GENERIC : kind === 'saved-price' ? SAVED_WITH_NET : null;
  if (!columns) return null;
  return getDefaultDocumentLayout('credit_note').map((item) => (
    item.key === 'items' ? { ...item, properties: { ...item.properties, columns } } : item
  ));
}

function themeFor(templateId: string) {
  if (templateId.includes('erp') || templateId === 'purchase-order-formal') return 'gray';
  if (templateId.includes('minimal') || templateId.includes('thermal')) return 'black';
  return 'blue';
}

/**
 * سطح تحقق بصري يدوي معزول (لا بيانات أعمال، لا تنقل): يرسم `CreditNoteDocument` الحقيقي
 * بلا مقياس عرض، فيُلتقط الجذر `#print-root` بمقاسه الطبيعي كما تطبعه الصفحة الفعلية.
 */
function Inner() {
  const params = useSearchParams();
  const scenario = (params.get('scenario') ?? 'inclusive') as CreditNoteQaScenario;
  const templateId = params.get('template') ?? 'tax-invoice-classic';
  const layoutKind = params.get('layout') ?? 'default';
  const safe = CREDIT_NOTE_QA_SCENARIOS.includes(scenario) ? scenario : 'inclusive';
  const note = useMemo(() => makeCreditNoteQaNote(safe), [safe]);
  const layout = useMemo(() => layoutFor(layoutKind), [layoutKind]);
  const paperId = (params.get('paper') ?? 'a4') as keyof typeof PAPER_SIZES;
  const exportPdf = async () => {
    const element = document.getElementById('print-root');
    const paper = PAPER_SIZES[paperId] ?? PAPER_SIZES.a4;
    if (element) await documentExporter.download({ element, fileName: `cn-qa-${safe}`, paper: { widthMm: paper.widthMm, heightMm: paper.heightMm } });
  };
  return (
    <main className="inline-block" data-testid="credit-note-qa">
      <button type="button" data-testid="qa-export-pdf" hidden onClick={() => void exportPdf()}>PDF</button>
      <CreditNoteDocument
        note={note}
        company={CREDIT_NOTE_QA_COMPANY}
        customer={CREDIT_NOTE_QA_CUSTOMER}
        templateId={templateId}
        themeId={themeFor(templateId)}
        layout={layout}
        showLogo={false}
        rootId="print-root"
      />
    </main>
  );
}

export default function CreditNoteQaPage() {
  return <Suspense fallback={null}><Inner /></Suspense>;
}
