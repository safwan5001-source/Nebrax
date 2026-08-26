'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { DocumentScaler } from '@/modules/documents/components/document-scaler';
import { DocumentView } from '@/modules/documents/components/document-view';
import { downloadPdf } from '@/lib/pdf';
import { makeDocumentQaModel, type DocumentQaScenario } from '@/modules/documents/qa/document-qa-fixtures';
import type { DocSectionLayoutItem } from '@/modules/documents/types';

const SCENARIOS: DocumentQaScenario[] = ['single', 'five', 'twenty', 'multipage'];
const TEMPLATES = ['tax-invoice-erp', 'tax-invoice-modern', 'tax-invoice-minimal'] as const;

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
  const showQr = searchParams.get('qr') !== 'off';
  const showLogo = searchParams.get('logo') !== 'off';
  const showAssets = searchParams.get('assets') !== 'off';
  const model = useMemo(
    () => makeDocumentQaModel({ scenario, direction, showQr, showAssets }),
    [direction, scenario, showAssets, showQr],
  );
  const layout = useMemo<DocSectionLayoutItem[]>(() => [
    { key: 'header', visible: true },
    { key: 'parties', visible: true },
    { key: 'items', visible: true },
    { key: 'summary', visible: true },
    { key: 'notes', visible: true },
    { key: 'terms', visible: true },
    { key: 'bank', visible: showAssets },
    { key: 'stamp', visible: showAssets },
    { key: 'signature', visible: showAssets },
    { key: 'footer', visible: true },
  ], [showAssets]);

  const exportPdf = async () => {
    const root = document.getElementById('qa-print-root');
    if (root) await downloadPdf(root, `nebrax-document-qa-${templateId}-${scenario}.pdf`);
  };

  return (
    <main className="min-h-screen bg-[color:var(--background)] p-3 sm:p-6" data-testid="document-qa-page">
      <header className="no-print mx-auto mb-4 flex max-w-[1440px] flex-wrap items-center justify-between gap-3 rounded-md border border-[color:var(--border)] bg-[color:var(--surface)] p-3">
        <div>
          <h1 className="font-semibold text-[color:var(--text)]">Nebrax document QA</h1>
          <p className="text-sm text-[color:var(--muted)]">{templateId} · {scenario} · {direction}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-sm text-[color:var(--text)]" htmlFor="qa-template">Template</label>
          <select id="qa-template" data-testid="qa-template-selector" value={templateId} onChange={(event) => { window.location.search = new URLSearchParams({ scenario, direction, template: event.target.value, qr: showQr ? 'on' : 'off', logo: showLogo ? 'on' : 'off', assets: showAssets ? 'on' : 'off' }).toString(); }}>
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
