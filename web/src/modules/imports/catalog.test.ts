import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HUB_ENTITIES, HUB_JOB_DOMAINS, resumeHref } from './catalog';

const pageExists = (href: string) => existsSync(join(process.cwd(), 'src/app/(app)', href, 'page.tsx'));
const job = (patch: Record<string, unknown>) => ({ id: 'j1', domain: 'product_catalog', status: 'ready', target_id: null, ...patch }) as Parameters<typeof resumeHref>[0];

describe('import hub catalog', () => {
  it('only links to screens that exist, so the hub never leads to a 404', () => {
    for (const entity of HUB_ENTITIES) {
      expect(pageExists(entity.standardHref), entity.standardHref).toBe(true);
      if (entity.secondary) expect(pageExists(entity.secondary.href), entity.secondary.href).toBe(true);
      if (entity.aiHref) expect(pageExists(entity.aiHref), entity.aiHref).toBe(true);
    }
  });

  it('keys are unique and every entity declares a manage permission', () => {
    expect(new Set(HUB_ENTITIES.map((entity) => entity.key)).size).toBe(HUB_ENTITIES.length);
    for (const entity of HUB_ENTITIES) expect(entity.permission).toMatch(/\.manage$/);
  });

  it('declares an assistant path only for products (no invented link for other entities)', () => {
    expect(HUB_ENTITIES.filter((entity) => entity.aiHref).map((entity) => entity.key)).toEqual(['products']);
  });

  it('resumes only unfinished runs, at their own wizard, carrying the job id', () => {
    expect(resumeHref(job({ status: 'ready' }))).toBe('/products/import?job=j1');
    expect(resumeHref(job({ status: 'processing', domain: 'stock_permit_import' }))).toBe('/stock-permits/import?job=j1');
    expect(resumeHref(job({ status: 'processing', domain: 'purchase_import', id: 'a b' }))).toBe('/purchases/import?job=a%20b');
    for (const status of ['completed', 'failed', 'cancelled', 'uploaded', 'queued']) expect(resumeHref(job({ status }))).toBeNull();
  });

  it('resumes a stocktake count at its frozen stocktake, and refuses to guess ambiguous domains', () => {
    expect(resumeHref(job({ domain: 'stocktake_count', target_id: 'st-1' }))).toBe('/stocktaking/st-1/import?job=j1');
    expect(resumeHref(job({ domain: 'stocktake_count', target_id: null }))).toBeNull();
    // عملاء/موردون وتصنيفات/ماركات يتشاركان مجالاً واحداً ولا يعرض الخادم النوع
    expect(resumeHref(job({ domain: 'partner_master' }))).toBeNull();
    expect(resumeHref(job({ domain: 'product_taxonomy' }))).toBeNull();
  });

  it('a partner statement run has no resume link until its wizard exists (PS-A4)', () => {
    expect(resumeHref(job({ domain: 'partner_statement', status: 'ready' }))).toBeNull();
  });

  it('every filterable domain has either a resume route or a documented reason not to', () => {
    const ambiguous = ['partner_master', 'product_taxonomy', 'stocktake_count'];
    // IMP-PS-A1: كشوف الأطراف بلا معالج واجهة بعد (الواجهة PS-A4)؛ تظهر تشغيلاتها في السجلّ بلا زر استئناف إلى أن يوجد المعالج.
    const noWizardYet = ['partner_statement'];
    for (const domain of HUB_JOB_DOMAINS.filter((value) => ![...ambiguous, ...noWizardYet].includes(value))) {
      expect(resumeHref(job({ domain, status: 'ready' })), domain).not.toBeNull();
    }
  });
});
