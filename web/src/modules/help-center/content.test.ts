import { describe, expect, it } from 'vitest';
import { HELP_ARTICLES, getHelpArticle, normalizeHelpSearch, searchHelpArticles } from './content';

describe('Help Center content', () => {
  it('keeps article slugs unique and every article readable in both languages', () => {
    const slugs = HELP_ARTICLES.map((article) => article.slug);
    expect(new Set(slugs).size).toBe(slugs.length);

    for (const article of HELP_ARTICLES) {
      expect(article.title.ar).toBeTruthy();
      expect(article.title.en).toBeTruthy();
      expect(article.sections.length).toBeGreaterThan(0);
      expect(getHelpArticle(article.slug)).toBe(article);
    }
  });

  it('normalizes common Arabic spelling forms and diacritics', () => {
    expect(normalizeHelpSearch('إِنشاءُ قَيْدٍ')).toBe('انشاء قيد');
    expect(normalizeHelpSearch('الأرصدة الافتتاحية')).toContain('الافتتاحيه');
  });

  it('finds Arabic articles by task terms and supports category filtering', () => {
    expect(searchHelpArticles('فاتورة عميل', 'ar').map((article) => article.slug)).toContain('create-sales-invoice');
    expect(searchHelpArticles('فاتورة', 'ar', 'purchases').map((article) => article.slug)).toEqual(['record-purchase-invoice']);
  });

  it('finds English articles by keywords', () => {
    expect(searchHelpArticles('cashier checkout', 'en').map((article) => article.slug)).toEqual(['pos-session-and-sale']);
  });
});
