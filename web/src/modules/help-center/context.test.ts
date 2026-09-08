import { describe, expect, it } from 'vitest';
import { CONTEXTUAL_HELP_ROUTES, resolveContextualHelp } from './context';

describe('contextual Help Center route mapping', () => {
  it.each([
    ['/dashboard', 'first-steps'],
    ['/branches/settings', 'switch-active-branch'],
    ['/invoices/new', 'create-sales-invoice'],
    ['/invoices/inv-1/edit', 'create-sales-invoice'],
    ['/payments/new', 'record-customer-payment'],
    ['/purchases/p-1', 'record-purchase-invoice'],
    ['/products/product-1', 'create-product'],
    ['/stocktaking', 'run-stocktake'],
    ['/manual-journals/new', 'manual-journal-entry'],
    ['/journal-entries/entry-1', 'manual-journal-entry'],
    ['/accounting-settings/period-locks', 'period-locks'],
    ['/pos/start', 'pos-session-and-sale'],
    ['/partners/new', 'create-partner'],
    ['/quotes/new', 'create-sales-quote'],
    ['/delivery-notes/note-1', 'delivery-notes'],
    ['/delivery-notes/invoice-draft?notes=note-1', 'delivery-notes'],
    ['/inventory-openings/import', 'import-inventory-opening'],
    ['/stock-permits/permit-1', 'stock-permits'],
    ['/expenses/new?edit=expense-1', 'record-expense'],
    ['/accounting-settings/fiscal-years', 'fiscal-year-close'],
  ])('maps %s to %s', (pathname, slug) => {
    expect(resolveContextualHelp(pathname)?.article.slug).toBe(slug);
  });

  it('normalizes trailing slashes and ignores query/hash fragments safely', () => {
    expect(resolveContextualHelp('/dashboard/?tab=today#summary')?.article.slug).toBe('first-steps');
  });

  it.each([
    '/unknown',
    '/invoice',
    '/invoices-archive',
    '/partners-archive',
    '/partners/partner-1/statement',
    '/cash-and-bank/transfer',
    '/returns',
    '/purchase-requests',
    '/',
    '/help',
  ])('does not guess for unmapped route %s', (pathname) => {
    expect(resolveContextualHelp(pathname)).toBeUndefined();
  });

  it('keeps every mapped slug connected to the existing V1 article source', () => {
    for (const entry of CONTEXTUAL_HELP_ROUTES) {
      expect(resolveContextualHelp(entry.routes[0].pathname)?.article.slug).toBe(entry.articleSlug);
    }
  });
});
