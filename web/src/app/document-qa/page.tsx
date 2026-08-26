'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { DocumentScaler } from '@/modules/documents/components/document-scaler';
import { DocumentView } from '@/modules/documents/components/document-view';
import { downloadPdf } from '@/lib/pdf';
import { makeDocumentQaModel, type DocumentQaScenario } from '@/modules/documents/qa/document-qa-fixtures';
import { getDefaultDocumentLayout } from '@/modules/documents/registry/document-types';
import type { DocumentTypeId } from '@/modules/documents/types';

const SCENARIOS: DocumentQaScenario[] = ['single', 'five', 'twenty', 'multipage'];
const TEMPLATES = ['tax-invoice-erp', 'tax-invoice-modern', 'tax-invoice-minimal'] as const;
const DOCUMENT_TYPES = ['quotation', 'sales_order', 'purchase_order', 'purchase_invoice', 'delivery_note'] as const satisfies readonly DocumentTypeId[];

function option(value: string | null, values: readonly string[], fallback: string): string {
  return value && values.includes(value) ? value : fallback;
}

/**
 * سطح تحقق تطويري معزول: لا يقرأ أو يكتب سجلات أعمال ولا يظهر في التنقل.
 * يتيح اختبار القالب ومصدّر PDF نفسهما على نماذج طويلة وآمنة ضمن Playwright.
 */
export default function DocumentQaPage() {
  const searchParams = useSearchParams();
  const scenario = option(searchParams.get('scenario'), SCENARIOS, 'single') as DocumentQaScenario;
  const direction = option(searchParams.get('direction'), ['rtl', 'ltr'], 'rtl') as 'rtl' | 'ltr';
  const templateId = option(searchParams.get('template'), TEMPLATES, 'tax-invoice-erp');
  const documentType = option(searchParams.get('type'), DOCUMENT_TYPES, 'quotation') as typeof DOCUMENT_TYPES[number];
  const showQr = searchParams.get('qr') !== 'off';
  const showLogo = searchParams.get('logo') !== 'off';
  const showAssets = searchParams.get('assets') !== 'off';
  const model = useMemo(
    () => makeDocumentQaModel({ documentType, scenario, direction, showQr, showAssets }),
    [direction, documentType, scenario, showAssets, showQr],
  );
  const layout = useMemo(() => getDefaultDocumentLayout(documentType).map((item) => ({
    ...item,
    visible: item.visible && (showAssets || !['bank', 'stamp', 'signature'].includes(item.key)),
  })), [documentType, showAssets]);

  const exportPdf = async () => {
    const root = document.getElementById('qa-print-root');
    if (root) await downloadPdf(root, `nebrax-document-qa-${documentType}-${templateId}-${scenario}.pdf`);
  };

  return (
    <main className="min-h-screen bg-[color:var(--background)] p-3 sm:p-6" data-testid="document-qa-page">
      <header className="no-print mx-auto mb-4 flex max-w-[1440px] flex-wrap items-center justify-between gap-3 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] p-3">
        <div>
          <h1 className="font-semibold text-[color:var(--text)]">Nebrax document QA</h1>
          <p className="text-sm text-[color:var(--muted)]">{documentType} · {templateId} · {scenario} · {direction}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-[color:var(--text)]" htmlFor="qa-document-type">Document type</label>
          <select id="qa-document-type" data-testid="qa-document-type-selector" value={documentType} onChange={(event) => { window.location.search = new URLSearchParams({ type: event.target.value, scenario, direction, template: templateId, qr: showQr ? 'on' : 'off', logo: showLogo ? 'on' : 'off', assets: showAssets ? 'on' : 'off' }).toString(); }}>
            {DOCUMENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}
          </select>
          <label className="text-sm text-[color:var(--text)]" htmlFor="qa-template">Template</label>
          <select id="qa-template" data-testid="qa-template-selector" value={templateId} onChange={(event) => { window.location.search = new URLSearchParams({ type: documentType, scenario, direction, template: event.target.value, qr: showQr ? 'on' : 'off', logo: showLogo ? 'on' : 'off', assets: showAssets ? 'on' : 'off' }).toString(); }}>
            {TEMPLATES.map((template) => <option key={template} value={template}>{template}</option>)}
          </select>
          <button type="button" onClick={() => void exportPdf()}>Download PDF</button>
        </div>
      </header>
      <section className="mx-auto max-w-[1440px]" aria-label="Document preview" data-testid="qa-preview-shell">
        <DocumentScaler>
          <DocumentView
            model={model}
            templateId={templateId}
            themeId={templateId === 'tax-invoice-erp' ? 'gray' : templateId === 'tax-invoice-minimal' ? 'black' : 'blue'}
            showLogo={showLogo}
            layout={layout}
            rootId="qa-print-root"
          />
        </DocumentScaler>
      </section>
    </main>
  );
}
