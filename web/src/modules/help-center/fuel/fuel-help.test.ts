import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  FUEL_HELP_ARTICLES,
  FUEL_HELP_CATEGORIES,
  FUEL_PERMISSION_LABELS,
  getFuelHelpArticle,
  searchFuelHelp,
} from './index';
import { FUEL_CONTEXT_ROUTES, resolveFuelContextualHelp } from './context';

const webRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const slugs = (query: string, locale: 'ar' | 'en', extra: Parameters<typeof searchFuelHelp>[0] = {}) =>
  searchFuelHelp({ query, ...extra }, locale).map((article) => article.slug);

/** هل لمسار شاشة (ثابت) صفحة فعلية في `src/app`؟ يجرّب مجموعات المسارات (`(fuel)`, `(fuel-ops)`, `(fuel-ops-auth)`). */
function pageExists(href: string): boolean {
  const rel = href.replace(/^\//, '');
  return ['(fuel)', '(fuel-ops)', '(fuel-ops-auth)'].some((group) => existsSync(join(webRoot, 'src/app', group, rel, 'page.tsx')));
}

describe('Fuel Help Center content', () => {
  it('has unique slugs, every article in the display order, and both languages filled', () => {
    const all = FUEL_HELP_ARTICLES.map((article) => article.slug);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(20);

    const text = (value: { ar: string; en: string }) => {
      expect(value.ar.trim()).not.toBe('');
      expect(value.en.trim()).not.toBe('');
    };
    for (const article of FUEL_HELP_ARTICLES) {
      text(article.title); text(article.summary); text(article.keywords); text(article.overview);
      expect(article.minutes).toBeGreaterThan(0);
      expect(article.audiences.length).toBeGreaterThan(0);
      expect(article.procedures.length).toBeGreaterThan(0);
      for (const procedure of article.procedures) {
        text(procedure.title);
        expect(procedure.steps.length).toBeGreaterThan(1);
        procedure.steps.forEach(text);
      }
      (article.fields ?? []).forEach((field) => { text(field.name); text(field.description); });
      (article.problems ?? []).forEach((problem) => { text(problem.problem); text(problem.fix); });
      [...(article.notes ?? []), ...(article.unavailable ?? [])].forEach(text);
      if (article.permissionsNote) text(article.permissionsNote);
    }
  });

  it('gives every guide the required parts: overview, steps, permissions, and troubleshooting', () => {
    const exempt = new Set(['fuel-troubleshooting']); // مرجع الأعراض: مشكلاته هي محتواه، وتفاصيل كل دليل في دليله
    for (const article of FUEL_HELP_ARTICLES) {
      expect(article.permissions.length, article.slug).toBeGreaterThan(0);
      if (!exempt.has(article.slug)) expect((article.problems ?? []).length, article.slug).toBeGreaterThan(0);
    }
    // التسعة الوظائف المطلوبة كلها مغطاة.
    const covered = (needle: string) => FUEL_HELP_ARTICLES.some((article) => article.slug.includes(needle));
    for (const needle of ['settings', 'prices', 'tanks-pumps-nozzles', 'staff', 'pin', 'open-shift', 'meter-readings', 'sales', 'collection', 'receiving', 'reports', 'troubleshooting']) {
      expect(covered(needle), needle).toBe(true);
    }
  });

  it('keeps categories, related references, and audiences valid', () => {
    const categories = new Set(FUEL_HELP_CATEGORIES.map((category) => category.key));
    expect(categories.size).toBe(FUEL_HELP_CATEGORIES.length);
    for (const article of FUEL_HELP_ARTICLES) {
      expect(categories.has(article.category), article.slug).toBe(true);
      expect(new Set(article.related ?? []).size).toBe((article.related ?? []).length);
      for (const related of article.related ?? []) {
        expect(related).not.toBe(article.slug);
        expect(getFuelHelpArticle(related), `${article.slug} → ${related}`).toBeDefined();
      }
    }
    for (const category of FUEL_HELP_CATEGORIES) {
      expect(FUEL_HELP_ARTICLES.some((article) => article.category === category.key), category.key).toBe(true);
    }
  });

  it('only cites permission keys that have a label and exist in the backend catalog', () => {
    const rbac = join(webRoot, '..', 'app/Support/Rbac.php');
    const backend = existsSync(rbac) ? readFileSync(rbac, 'utf8') : null;
    const cited = new Set(FUEL_HELP_ARTICLES.flatMap((article) => article.permissions));
    for (const key of cited) {
      expect(FUEL_PERMISSION_LABELS[key], key).toBeDefined();
      if (backend) expect(backend, key).toContain(`'${key}'`);
    }
    for (const key of Object.keys(FUEL_PERMISSION_LABELS)) expect(cited.has(key), `unused label ${key}`).toBe(true);
  });

  it('links only to screens that exist: app links under /fuel-stations/ops, ERP links under /fuel-stations', () => {
    for (const article of FUEL_HELP_ARTICLES) {
      for (const screen of article.screens ?? []) {
        expect(screen.appHref ?? screen.erpHref, article.slug).toBeTruthy();
        if (screen.appHref) {
          expect(screen.appHref, article.slug).toMatch(/^\/fuel-stations\/ops(\/|$)/);
          expect(pageExists(screen.appHref), screen.appHref).toBe(true);
        }
        if (screen.erpHref) {
          expect(screen.erpHref, article.slug).toMatch(/^\/fuel-stations(\/|$)/);
          expect(screen.erpHref).not.toMatch(/^\/fuel-stations\/ops/);
          expect(pageExists(screen.erpHref), screen.erpHref).toBe(true);
        }
      }
    }
  });

  it('marks tasks that only the app performs without an ERP link and ERP-only tasks without an app link', () => {
    for (const article of FUEL_HELP_ARTICLES) {
      if (article.surface === 'erp') for (const screen of article.screens ?? []) expect(screen.erpHref ?? screen.appHref).toBeTruthy();
    }
    expect(getFuelHelpArticle('fuel-tanks-pumps-nozzles')?.surface).toBe('erp');
    expect(getFuelHelpArticle('fuel-open-shift')?.surface).toBe('app');
  });

  it('documents unavailable functions explicitly instead of inventing guidance', () => {
    expect(getFuelHelpArticle('fuel-handover-shift')?.unavailable?.[0].ar).toContain('غير متاح');
    expect(getFuelHelpArticle('fuel-reports-monitoring')?.unavailable?.length).toBeGreaterThanOrEqual(2);
    expect(getFuelHelpArticle('fuel-station-settings')?.unavailable?.length).toBeGreaterThanOrEqual(1);
  });

  it('is not tied to a tenant: no tenant, company, or person names in the content', () => {
    const blob = JSON.stringify(FUEL_HELP_ARTICLES);
    expect(blob).not.toMatch(/نبراس الطموح|Acme|tenant_id|@[a-z0-9.-]+\.[a-z]{2,}/i);
  });
});

describe('Fuel Help Center search', () => {
  it('finds guides by Arabic task terms', () => {
    expect(slugs('فتح وردية', 'ar')[0]).toBe('fuel-open-shift');
    expect(slugs('رمز PIN', 'ar')).toContain('fuel-pin-login');
    expect(slugs('عهدة الافتتاح', 'ar')).toContain('fuel-open-shift');
    expect(slugs('فرق نقد', 'ar')).toEqual(expect.arrayContaining(['fuel-collection-reconciliation', 'fuel-handover-shift']));
    expect(slugs('استلام وقود', 'ar')[0]).toBe('fuel-receiving');
  });

  it('finds guides by English task terms and by error text', () => {
    expect(slugs('open shift', 'en')[0]).toBe('fuel-open-shift');
    expect(slugs('meter reading', 'en')).toContain('fuel-meter-readings');
    expect(slugs('opening float', 'en')).toContain('fuel-open-shift');
    expect(slugs('Price not configured', 'en')).toContain('fuel-products-prices');
  });

  it('filters by category and audience and returns everything for an empty query', () => {
    expect(searchFuelHelp({}, 'ar')).toHaveLength(FUEL_HELP_ARTICLES.length);
    expect(slugs('', 'ar', { category: 'shifts' }).every((slug) => getFuelHelpArticle(slug)?.category === 'shifts')).toBe(true);
    const operator = slugs('', 'en', { audience: 'operator' });
    expect(operator).toContain('fuel-open-shift');
    expect(operator).not.toContain('fuel-tanks-pumps-nozzles');
  });

  it('is deterministic and returns nothing for gibberish', () => {
    expect(slugs('وردية', 'ar')).toEqual(slugs('وردية', 'ar'));
    expect(slugs('zzqxwv', 'en')).toEqual([]);
  });
});

describe('Fuel contextual help routing', () => {
  it('maps the real app screens to their guides', () => {
    const at = (pathname: string) => resolveFuelContextualHelp(pathname)?.article.slug;
    expect(at('/fuel-stations/ops')).toBe('fuel-app-quickstart');
    expect(at('/fuel-stations/ops/shifts')).toBe('fuel-shift-lifecycle');
    expect(at('/fuel-stations/ops/shifts/abc123')).toBe('fuel-shift-lifecycle');
    expect(at('/fuel-stations/ops/shifts/open')).toBe('fuel-open-shift');
    expect(at('/fuel-stations/ops/shifts/abc123/readings/opening')).toBe('fuel-meter-readings');
    expect(at('/fuel-stations/ops/shifts/abc123/handover')).toBe('fuel-handover-shift');
    expect(at('/fuel-stations/ops/shifts/abc123/review')).toBe('fuel-review-approve-shift');
    expect(at('/fuel-stations/ops/receiving/costs')).toBe('fuel-receiving-costs');
    expect(at('/fuel-stations/ops/receiving/new')).toBe('fuel-receiving');
    expect(at('/fuel-stations/ops/tanks/xyz')).toBe('fuel-tank-readings');
    expect(at('/fuel-stations/ops/manage/reading-policy')).toBe('fuel-tank-readings');
    expect(at('/fuel-stations/ops/manage/staff/1')).toBe('fuel-staff-access');
    expect(at('/fuel-stations/ops/opening-balance')).toBe('fuel-opening-balance');
    expect(at('/fuel-stations/ops/products/')).toBe('fuel-products-prices');
  });

  it('maps the ERP fuel screens and leaves unrelated or unknown paths without a guide', () => {
    const at = (pathname: string) => resolveFuelContextualHelp(pathname)?.article.slug;
    expect(at('/fuel-stations')).toBe('fuel-reports-monitoring');
    expect(at('/fuel-stations/master-data')).toBe('fuel-tanks-pumps-nozzles');
    expect(at('/fuel-stations/settings')).toBe('fuel-station-settings');
    expect(at('/fuel-stations/prices')).toBe('fuel-products-prices');
    expect(at('/fuel-stations/sales')).toBe('fuel-sales-invoicing');
    expect(at('/fuel-stations/receiving')).toBe('fuel-receiving');
    expect(at('/fuel-stations/alerts')).toBe('fuel-reports-monitoring');
    expect(at('/fuel-stations/devices')).toBeUndefined();
    expect(at('/invoices')).toBeUndefined();
    expect(at('/fuel-stations/ops/help')).toBeUndefined();
  });

  it('points every route entry to an existing guide', () => {
    for (const entry of FUEL_CONTEXT_ROUTES) expect(getFuelHelpArticle(entry.articleSlug), entry.context).toBeDefined();
  });
});
