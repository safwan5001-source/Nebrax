// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AccordionItem } from '@/components/ui/accordion';
import { CodeBlock } from '@/components/developer/code-block';
import { renderIntl } from '@/test-utils/intl';

afterEach(cleanup);
const src = (rel: string) => readFileSync(resolve(__dirname, '../..', rel), 'utf8');

describe('ERP-UX-H1-7F residual fixes', () => {
  it('mobile detail sections are h2, directly under the page h1 (ERP-UX-014)', () => {
    render(<AccordionItem id="effect" title="Accounting effect" open={false} onToggle={() => {}}><p>x</p></AccordionItem>);
    expect(screen.getByRole('heading', { level: 2, name: 'Accounting effect' })).toBeTruthy();
  });

  it('horizontally scrollable code samples are reachable by keyboard and named', () => {
    renderIntl(<CodeBlock code={'curl https://example.test/api/v1/health'} label="cURL" />, 'en');
    const region = screen.getByLabelText('cURL');
    expect(region.tagName).toBe('PRE');
    expect(region.getAttribute('tabindex')).toBe('0');
  });

  it('settings links inside sentences are underlined, and the landing CTA band uses the on-primary token', () => {
    for (const page of ['app/(app)/purchase-settings/page.tsx', 'app/(app)/sales-settings/invoices/page.tsx']) {
      expect(src(page)).not.toMatch(/href="\/numbering-settings" className="text-primary hover:underline"/);
    }
    const landing = src('app/page.tsx');
    expect(landing).toMatch(/bg-primary px-6 py-10 text-primary-foreground/);
    expect(landing).not.toMatch(/text-white\/75/);
  });
});
