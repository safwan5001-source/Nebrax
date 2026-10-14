// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { CardTitleLevel } from '@/components/ui/card';
import { ToastProvider } from '@/components/ui/toast';
import { renderIntl } from '@/test-utils/intl';
import { PrintTemplateAssignments } from '../print-template-assignments';
import { PrintTemplateCenter } from '../print-template-center';
import { TemplateRevisionHistory } from '../template-revision-history';

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/api')>()),
  api: vi.fn(async () => ({ data: [] })),
}));

/** Every visible heading in document order, as `h<level> text`; a skipped level fails the outline. */
function outline(root: HTMLElement) {
  return [...root.querySelectorAll('h1,h2,h3,h4,h5,h6')].map((h) => `${h.tagName.toLowerCase()} ${h.textContent?.trim()}`);
}
function skips(levels: string[]) {
  return levels.map((h) => Number(h[1])).filter((level, i, all) => i > 0 && level > all[i - 1] + 1);
}

beforeAll(() => {
  // jsdom has no ResizeObserver; the revision previews scale through one.
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});

afterEach(cleanup);

describe('Print template headings under the ERP layout (ERP-UX-014)', () => {
  it('keeps family cards as h3 children of the "Choose a work area" h2', () => {
    // The ERP layout sets card titles to h2; the families section owns its own h2.
    renderIntl(
      <CardTitleLevel level="h2">
        <PrintTemplateCenter templates={[]} loadState="ready" onOpenDocumentType={vi.fn()} onRetry={vi.fn()} />
      </CardTitleLevel>,
      'en',
    );
    expect(screen.getByRole('heading', { level: 2, name: 'Choose a work area' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Sales' })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 3, name: 'Purchases and suppliers' })).toBeTruthy();
    expect(screen.queryByRole('heading', { level: 2, name: 'Sales' })).toBeNull();
  });

  it('renders the governance tab outline without skips: tab h2 > card h3 > section h4 > item h5', async () => {
    const revisions = [
      { id: 'r2', version: 2, status: 'published' as const, document_types: ['tax_invoice'], definition: {} },
      { id: 'r1', version: 1, status: 'superseded' as const, document_types: ['tax_invoice'], definition: {} },
    ];
    const template = { id: 't1', name: 'Invoice', published_revision: { id: 'r2', version: 2, status: 'published' as const, document_types: ['tax_invoice' as const] } };
    // Same nesting as the studio: ERP layout (h2) → governance tab h2 → CardTitleLevel h3.
    const { container } = renderIntl(
      <ToastProvider>
        <CardTitleLevel level="h2">
          <h2>Governance</h2>
          <CardTitleLevel level="h3">
            <TemplateRevisionHistory revisions={revisions} loading={false} failed={false} />
            <PrintTemplateAssignments template={template} canManage />
          </CardTitleLevel>
        </CardTitleLevel>
      </ToastProvider>,
      'en',
    );
    await waitFor(() => expect(container.querySelectorAll('h5').length).toBeGreaterThanOrEqual(3));
    const levels = outline(container);
    expect(levels.map((h) => h.slice(0, 2))).toEqual(['h2', 'h3', 'h4', 'h5', 'h5', 'h3', 'h4', 'h5']);
    expect(skips(levels)).toEqual([]);
  });

  it('nests the governance tab cards under the tab h2', () => {
    const studio = readFileSync(resolve(__dirname, '../print-template-studio.tsx'), 'utf8');
    expect(studio).toMatch(/<CardTitleLevel level="h3"><section id="template-revision-history"[\s\S]*?<PrintTemplateAssignments [^>]*\/><\/section><\/CardTitleLevel>/);
  });
});
