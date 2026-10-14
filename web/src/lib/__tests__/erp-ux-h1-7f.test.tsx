// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { AccordionItem } from '@/components/ui/accordion';
import { CodeBlock } from '@/components/developer/code-block';
import { EmptyState } from '@/components/nebrax';
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

  it('a page-level forbidden state is the page h1; other empty states keep a plain title', () => {
    render(<><EmptyState titleAs="h1" title="No access" /><EmptyState title="No rows" /></>);
    expect(screen.getByRole('heading', { level: 1, name: 'No access' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'No rows' })).toBeNull();
    for (const page of ['app/(app)/accounting-settings/page.tsx', 'app/(app)/accounting-settings/fiscal-years/page.tsx', 'app/(app)/accounting-settings/period-locks/page.tsx', 'app/(app)/accounting-settings/account-routing/page.tsx']) {
      expect(src(page)).toMatch(/<EmptyState titleAs="h1" icon=\{(Lock|LockKeyhole)\} title=\{t\('forbidden'\)\}/);
    }
  });

  it('the Developers gate is h1 only where it is the whole page, h2 under a page header (no second h1)', () => {
    const shell = src('components/developer/developer-shell.tsx');
    expect(shell).toMatch(/titleAs=\{pageLevel \? 'h1' : 'h2'\}/);
    for (const page of ['app/(app)/developer/keys/page.tsx', 'app/(app)/developer/webhooks/page.tsx']) expect(src(page)).toMatch(/<DeveloperGate access=\{access\} demoGate pageLevel>/);
    for (const page of ['app/(app)/developer/page.tsx', 'app/(app)/developer/docs/page.tsx', 'app/(app)/developer/security/page.tsx']) {
      const body = src(page);
      expect(body).toMatch(/<PageHeader /);
      expect(body).not.toMatch(/<DeveloperGate[^>]*pageLevel/);
    }
  });
});
