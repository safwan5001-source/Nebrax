import { describe, expect, it } from 'vitest';
import { HELP_ARTICLES, HELP_SEARCH_ALIASES, getHelpArticle, normalizeHelpSearch, searchHelpArticles } from './content';

const slugs = (query: string, locale: 'ar' | 'en', category?: Parameters<typeof searchHelpArticles>[2]) =>
  searchHelpArticles(query, locale, category).map((article) => article.slug);

describe('Help Center search and discovery', () => {
  it('normalizes Arabic diacritics, tatweel, letter variants, and Arabic/Persian digits', () => {
    expect(normalizeHelpSearch('إِقــفَالُ السَّنَة')).toBe('اقفال السنه');
    expect(normalizeHelpSearch('کشف حساب ١٢۳')).toBe('كشف حساب 123');
    expect(normalizeHelpSearch('  أَوْج—ERP  ')).toBe('اوج erp');
  });

  it('resolves curated Arabic aliases from AWJ terminology', () => {
    expect(slugs('سند قبض', 'ar')[0]).toBe('record-customer-payment');
    expect(slugs('رصيد اول المدة', 'ar')[0]).toBe('import-inventory-opening');
    expect(slugs('اغلاق السنة', 'ar')[0]).toBe('fiscal-year-close');
  });

  it('resolves curated English aliases from AWJ terminology', () => {
    expect(slugs('client', 'en')[0]).toBe('create-partner');
    expect(slugs('receipt voucher', 'en')[0]).toBe('record-customer-payment');
    expect(slugs('stock count', 'en')[0]).toBe('run-stocktake');
  });

  it('ranks exact and strong title matches above weaker body matches', () => {
    expect(slugs('تسجيل فاتورة مشتريات', 'ar')[0]).toBe('record-purchase-invoice');
    const arabicCustomerResults = slugs('عميل', 'ar');
    expect(arabicCustomerResults.indexOf('create-partner')).toBeLessThan(arabicCustomerResults.indexOf('create-sales-invoice'));
    expect(slugs('customer', 'en')[0]).toBe('create-partner');
  });

  it('ranks keyword matches and retains summary/content fallback', () => {
    expect(slugs('باركود', 'ar')[0]).toBe('create-product');
    expect(slugs('correct financial destination', 'en')).toContain('record-customer-payment');
    expect(slugs('اعتماد الجرد', 'ar')).toContain('run-stocktake');
  });

  it('uses deterministic ordering for ambiguous result sets', () => {
    const first = slugs('فاتورة', 'ar');
    expect(first).toEqual(slugs('فاتورة', 'ar'));
    expect(first.length).toBeGreaterThan(1);
  });

  it('preserves no-results and category-filter behavior', () => {
    expect(slugs('مصطلح غير موجود إطلاقا', 'ar')).toEqual([]);
    expect(slugs('invoice', 'en', 'purchases')).toEqual(['record-purchase-invoice']);
    expect(slugs('invoice', 'en', 'inventory')).toEqual([]);
    expect(slugs('client', 'en', 'sales')).toEqual(['create-partner']);
    expect(slugs('client', 'en', 'purchases')).toEqual([]);
  });

  it('keeps all 17 existing articles and slugs searchable without mutation', () => {
    const before = HELP_ARTICLES.map((article) => article.slug);
    searchHelpArticles('invoice', 'en');
    expect(HELP_ARTICLES).toHaveLength(17);
    expect(HELP_ARTICLES.map((article) => article.slug)).toEqual(before);
  });

  it('keeps every curated alias centralized, normalized, and connected to an existing article', () => {
    for (const locale of ['ar', 'en'] as const) {
      const normalizedAliases = HELP_SEARCH_ALIASES[locale].flatMap((entry) => entry.aliases.map(normalizeHelpSearch));
      expect(new Set(normalizedAliases).size).toBe(normalizedAliases.length);
      for (const entry of HELP_SEARCH_ALIASES[locale]) {
        expect(normalizeHelpSearch(entry.canonical)).toBeTruthy();
        expect(entry.aliases.length).toBeGreaterThan(0);
        for (const alias of entry.aliases) expect(normalizeHelpSearch(alias)).toBeTruthy();
        for (const slug of entry.articleSlugs) expect(getHelpArticle(slug)).toBeDefined();
      }
    }
  });
});
