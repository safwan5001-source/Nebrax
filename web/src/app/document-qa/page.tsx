'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { DocumentScaler } from '@/modules/documents/components/document-scaler';
import { DocumentView } from '@/modules/documents/components/document-view';
import { downloadPdf } from '@/lib/pdf';
import { printDocument } from '@/modules/documents/services/export';
import { PAPER_SIZES } from '@/modules/documents/constants/paper';
import { makeDocumentQaModel, type DocumentQaScenario } from '@/modules/documents/qa/document-qa-fixtures';
import { resolveDocumentOutputSpec } from '@/modules/documents/services/output-spec';
import { normalizeOutputProfile, type OutputProfile } from '@/modules/print-templates/services/output-profile';
import { getDefaultDocumentLayout } from '@/modules/documents/registry/document-types';
import type { DocumentTypeId } from '@/modules/documents/types';

const SCENARIOS = ['single', 'three', 'five', 'twenty', 'multipage', 'long_content'] as const satisfies readonly DocumentQaScenario[];
const DIRECTIONS = ['rtl', 'ltr'] as const;
const TEMPLATES = [
  { id: 'tax-invoice-classic', labelKey: 'classic' },
  { id: 'tax-invoice-classic-v2', labelKey: 'classic_v2' },
  { id: 'tax-invoice-erp', labelKey: 'erp' },
  { id: 'tax-invoice-erp-v2', labelKey: 'erp_v2' },
  { id: 'tax-invoice-modern', labelKey: 'modern' },
  { id: 'tax-invoice-modern-v2', labelKey: 'modern_v2' },
  { id: 'tax-invoice-minimal', labelKey: 'minimal' },
  { id: 'tax-invoice-minimal-v2', labelKey: 'minimal_v2' },
  { id: 'tax-invoice-retail', labelKey: 'retail' },
  { id: 'tax-invoice-retail-v2', labelKey: 'retail_v2' },
  { id: 'quotation-proposal', labelKey: 'quotation_proposal' },
  { id: 'purchase-order-formal', labelKey: 'purchase_order_formal' },
  // AWJ-DOC-V2-PR2: الإيصال الحراري يُفحص بالمسارات نفسها (معاينة/طباعة/PDF) بمقاسه الحقيقي.
  { id: 'tax-invoice-thermal58', labelKey: 'thermal58' },
  { id: 'tax-invoice-thermal80', labelKey: 'thermal80' },
] as const;
const DOCUMENT_TYPES = [
  'tax_invoice',
  'simplified_tax_invoice',
  'quotation',
  'sales_order',
  'purchase_order',
  'purchase_invoice',
  'delivery_note',
  'receipt_voucher',
  'payment_voucher',
] as const satisfies readonly DocumentTypeId[];

// AWJ-DOC-V2-PR3B: مقاسات الإخراج القابلة للاختبار من الرابط (`paper` + `orientation` + `margins`).
const QA_PAPERS = ['default', 'a4', 'a5', 'a6', 'letter', 'legal', 'custom'] as const;
const QA_ORIENTATIONS = ['portrait', 'landscape'] as const;

/**
 * يبني Output Profile من معاملات الرابط عبر العقد نفسه (`normalizeOutputProfile`). `default`
 * أو أي مدخل غير صالح = بلا ملف (السلوك السابق). الهوامش: رقم واحد لكل الأضلاع أو «t,r,b,l».
 */
function qaOutputProfile(params: URLSearchParams): OutputProfile | null {
  const paper = params.get('paper');
  if (!paper || paper === 'default') return null;
  const input: Record<string, unknown> = { paper };
  const orientation = params.get('orientation');
  if (orientation) input.orientation = orientation;
  const margins = params.get('margins');
  if (margins) {
    const parts = margins.split(',').map((value) => Number(value));
    if (parts.length === 1) input.margins_mm = { top: parts[0], right: parts[0], bottom: parts[0], left: parts[0] };
    else if (parts.length === 4) input.margins_mm = { top: parts[0], right: parts[1], bottom: parts[2], left: parts[3] };
  }
  if (paper === 'custom') {
    const height = params.get('custom_h');
    input.custom = { width_mm: Number(params.get('custom_w')), ...(height ? { height_mm: Number(height) } : {}) };
  }
  const result = normalizeOutputProfile(input);
  return result.ok ? result.profile : null;
}

type QaDocumentType = (typeof DOCUMENT_TYPES)[number];
type QaTemplateId = (typeof TEMPLATES)[number]['id'];
type QaDirection = (typeof DIRECTIONS)[number];

function option<T extends string>(value: string | null, values: readonly T[], fallback: T): T {
  return value && values.includes(value as T) ? value as T : fallback;
}

const controlClassName = 'min-h-11 w-full rounded-md border border-[color:var(--border)] bg-[color:var(--background)] px-3 text-sm text-[color:var(--text)] shadow-sm outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[color:var(--primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--surface)]';

/**
 * سطح تحقق يدوي معزول: لا يقرأ أو يكتب سجلات أعمال ولا يظهر في التنقل.
 * يعرض نماذج آمنة عبر محرك المستند المشترك ومصدّر PDF نفسه.
 */
export default function DocumentQaPage() {
  const searchParams = useSearchParams();
  const t = useTranslations('documentQa');
  const tDocumentType = useTranslations('documentTypes');
  const tTemplate = useTranslations('invoiceTemplates');
  const scenario = option(searchParams.get('scenario'), SCENARIOS, 'single');
  const direction = option(searchParams.get('direction'), DIRECTIONS, 'rtl');
  const templateId = option(searchParams.get('template'), TEMPLATES.map((template) => template.id), 'tax-invoice-erp');
  const documentType = option(searchParams.get('type'), DOCUMENT_TYPES, 'tax_invoice');
  const showQr = searchParams.get('qr') !== 'off';
  const showLogo = searchParams.get('logo') !== 'off';
  const showAssets = searchParams.get('assets') !== 'off';
  const outputProfile = useMemo(() => qaOutputProfile(new URLSearchParams(searchParams.toString())), [searchParams]);
  const spec = useMemo(() => resolveDocumentOutputSpec(templateId, outputProfile), [outputProfile, templateId]);
  const model = useMemo(
    () => makeDocumentQaModel({ documentType, scenario, direction, showQr, showAssets }),
    [direction, documentType, scenario, showAssets, showQr],
  );
  const layout = useMemo(() => getDefaultDocumentLayout(documentType).map((item) => ({
    ...item,
    visible: (item.visible && (showAssets || !['bank', 'stamp', 'signature'].includes(item.key)))
      || (item.key === 'barcode' && (templateId === 'tax-invoice-retail' || templateId === 'tax-invoice-retail-v2')),
  })), [documentType, showAssets, templateId]);

  const updateQuery = (key: 'type' | 'template' | 'scenario' | 'direction' | 'paper' | 'orientation', value: string) => {
    const next = new URLSearchParams({
      type: documentType,
      template: templateId,
      scenario,
      direction,
      qr: showQr ? 'on' : 'off',
      logo: showLogo ? 'on' : 'off',
      assets: showAssets ? 'on' : 'off',
    });
    for (const extra of ['paper', 'orientation', 'margins', 'custom_w', 'custom_h']) {
      const current = searchParams.get(extra);
      if (current) next.set(extra, current);
    }
    next.set(key, value);
    window.location.search = next.toString();
  };

  // الحراري: رول 58/80mm وارتفاع مفتوح (من القالب)؛ غيره A4 كما كان ما لم يوجد Output Profile يدعمه القالب.
  const thermalPaperId = templateId === 'tax-invoice-thermal58' ? 'thermal_58' : templateId === 'tax-invoice-thermal80' ? 'thermal_80' : null;
  const paper = spec.paper;

  const exportPdf = async () => {
    const root = document.getElementById('qa-print-root');
    if (root) await downloadPdf(root, `nebrax-document-qa-${documentType}-${templateId}-${scenario}.pdf`, paper);
  };
  const printQa = () => printDocument(paper, 'qa-print-root');

  return (
    <main className="min-h-screen overflow-x-hidden bg-[color:var(--background)] p-3 sm:p-6" data-testid="document-qa-page">
      <header className="no-print mx-auto mb-4 max-w-[1440px] rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] p-4 shadow-sm">
        <div className="flex flex-col gap-1 border-b border-[color:var(--border)] pb-4 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <h1 className="text-lg font-semibold text-[color:var(--text)]">{t('title')}</h1>
            <p className="mt-1 text-sm text-[color:var(--muted)]">{t('subtitle')}</p>
          </div>
          <p className="text-sm text-[color:var(--muted)]" aria-live="polite">
            {t('current_selection', {
              document: tDocumentType(documentType),
              template: tTemplate(TEMPLATES.find((template) => template.id === templateId)?.labelKey ?? 'erp'),
              scenario: t(`scenario_${scenario}`),
              direction: t(`direction_${direction}`),
            })}
          </p>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-7">
          <label className="grid min-w-0 gap-1.5 text-sm font-medium text-[color:var(--text)]" htmlFor="qa-document-type">
            {t('document_type')}
            <select id="qa-document-type" data-testid="qa-document-type-selector" className={controlClassName} value={documentType} onChange={(event) => updateQuery('type', event.target.value)}>
              {DOCUMENT_TYPES.map((type) => <option key={type} value={type}>{tDocumentType(type)}</option>)}
            </select>
          </label>

          <label className="grid min-w-0 gap-1.5 text-sm font-medium text-[color:var(--text)]" htmlFor="qa-template">
            {t('template')}
            <select id="qa-template" data-testid="qa-template-selector" className={controlClassName} value={templateId} onChange={(event) => updateQuery('template', event.target.value)}>
              {TEMPLATES.map((template) => <option key={template.id} value={template.id}>{tTemplate(template.labelKey)}</option>)}
            </select>
          </label>

          <label className="grid min-w-0 gap-1.5 text-sm font-medium text-[color:var(--text)]" htmlFor="qa-scenario">
            {t('scenario')}
            <select id="qa-scenario" data-testid="qa-scenario-selector" className={controlClassName} value={scenario} onChange={(event) => updateQuery('scenario', event.target.value)}>
              {SCENARIOS.map((value) => <option key={value} value={value}>{t(`scenario_${value}`)}</option>)}
            </select>
          </label>

          <label className="grid min-w-0 gap-1.5 text-sm font-medium text-[color:var(--text)]" htmlFor="qa-direction">
            {t('direction')}
            <select id="qa-direction" data-testid="qa-direction-selector" className={controlClassName} value={direction} onChange={(event) => updateQuery('direction', event.target.value)}>
              {DIRECTIONS.map((value) => <option key={value} value={value}>{t(`direction_${value}`)}</option>)}
            </select>
          </label>

          <label className="grid min-w-0 gap-1.5 text-sm font-medium text-[color:var(--text)]" htmlFor="qa-paper">
            {t('paper')}
            <select id="qa-paper" data-testid="qa-paper-selector" className={controlClassName} value={searchParams.get('paper') ?? 'default'} onChange={(event) => updateQuery('paper', event.target.value)}>
              {QA_PAPERS.map((value) => <option key={value} value={value}>{t(`paper_${value}`)}</option>)}
            </select>
          </label>

          <label className="grid min-w-0 gap-1.5 text-sm font-medium text-[color:var(--text)]" htmlFor="qa-orientation">
            {t('orientation')}
            <select id="qa-orientation" data-testid="qa-orientation-selector" className={controlClassName} value={searchParams.get('orientation') ?? 'portrait'} onChange={(event) => updateQuery('orientation', event.target.value)}>
              {QA_ORIENTATIONS.map((value) => <option key={value} value={value}>{t(`orientation_${value}`)}</option>)}
            </select>
          </label>

          <div className="grid gap-1.5 text-sm font-medium text-[color:var(--text)]">
            <span aria-hidden="true">{t('pdf')}</span>
            <button type="button" data-testid="qa-download-pdf" className="min-h-11 rounded-md bg-[color:var(--primary)] px-4 text-sm font-semibold text-[color:var(--primary-foreground)] shadow-sm transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--primary)] focus-visible:ring-offset-2 focus-visible:ring-offset-[color:var(--surface)]" onClick={() => void exportPdf()}>
              {t('download_pdf')}
            </button>
            <button type="button" data-testid="qa-print" className="min-h-11 rounded-md border border-[color:var(--border)] bg-[color:var(--background)] px-4 text-sm font-semibold text-[color:var(--text)] shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--primary)]" onClick={printQa}>
              {t('print')}
            </button>
          </div>
        </div>
      </header>
      <section
        className="mx-auto max-w-[1440px]"
        aria-label={t('preview_label')}
        data-testid="qa-preview-shell"
        data-output-applied={spec.profile ? 'true' : 'false'}
        data-output-paper={`${spec.paper.widthMm}x${spec.paper.heightMm}`}
      >
        {thermalPaperId ? (
          // `w-max`: يمنع انكماش الجذر (58/80mm) داخل حاوية ضيقة أثناء التقاط PDF (windowWidth = عرض الإيصال).
          <div className="mx-auto w-max" data-testid="qa-thermal-shell">
            <DocumentView
              model={model}
              templateId={templateId}
              themeId={templateId === 'tax-invoice-erp' || templateId === 'tax-invoice-erp-v2' || templateId === 'purchase-order-formal' ? 'gray' : templateId === 'tax-invoice-minimal' || templateId === 'tax-invoice-minimal-v2' ? 'black' : 'blue'}
              showLogo={showLogo}
              layout={layout}
              rootId="qa-print-root"
              outputProfile={outputProfile}
            />
          </div>
        ) : (
          <DocumentScaler>
            <DocumentView
              model={model}
              templateId={templateId}
              themeId={templateId === 'tax-invoice-erp' || templateId === 'tax-invoice-erp-v2' || templateId === 'purchase-order-formal' ? 'gray' : templateId === 'tax-invoice-minimal' || templateId === 'tax-invoice-minimal-v2' ? 'black' : 'blue'}
              showLogo={showLogo}
              layout={layout}
              rootId="qa-print-root"
              outputProfile={outputProfile}
            />
          </DocumentScaler>
        )}
      </section>
    </main>
  );
}
