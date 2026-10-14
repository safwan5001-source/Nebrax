// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen } from '@testing-library/react';
import { CardTitleLevel } from '@/components/ui/card';
import { renderIntl } from '@/test-utils/intl';
import { PrintTemplateCenter } from '../print-template-center';

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

  it('nests the governance tab cards under the tab h2', () => {
    const studio = readFileSync(resolve(__dirname, '../print-template-studio.tsx'), 'utf8');
    expect(studio).toMatch(/<CardTitleLevel level="h3"><section id="template-revision-history"[\s\S]*?<PrintTemplateAssignments [^>]*\/><\/section><\/CardTitleLevel>/);
  });
});
