import { describe, expect, it } from 'vitest';
import { HELP_ARTICLES, HELP_CATEGORIES, getHelpArticle, normalizeHelpSearch, searchHelpArticles } from './content';

describe('Help Center content', () => {
  it('keeps article slugs unique and every article readable in both languages', () => {
    const slugs = HELP_ARTICLES.map((article) => article.slug);
    expect(new Set(slugs).size).toBe(slugs.length);

    for (const article of HELP_ARTICLES) {
      expect(article.title.ar).toBeTruthy();
      expect(article.title.en).toBeTruthy();
      expect(article.summary.ar).toBeTruthy();
      expect(article.summary.en).toBeTruthy();
      expect(article.keywords.ar).toBeTruthy();
      expect(article.keywords.en).toBeTruthy();
      expect(article.sections.length).toBeGreaterThan(0);
      for (const section of article.sections) {
        expect(section.title.ar).toBeTruthy();
        expect(section.title.en).toBeTruthy();
        for (const paragraph of section.paragraphs ?? []) {
          expect(paragraph.ar).toBeTruthy();
          expect(paragraph.en).toBeTruthy();
        }
        for (const step of section.steps ?? []) {
          expect(step.ar).toBeTruthy();
          expect(step.en).toBeTruthy();
        }
        if (section.note) {
          expect(section.note.ar).toBeTruthy();
          expect(section.note.en).toBeTruthy();
        }
      }
      expect(getHelpArticle(article.slug)).toBe(article);
    }
  });

  it('keeps categories, actions, and curated related-article references valid', () => {
    const categoryKeys = new Set(HELP_CATEGORIES.map((category) => category.key));

    for (const article of HELP_ARTICLES) {
      expect(categoryKeys.has(article.category)).toBe(true);
      if (article.action) {
        expect(article.action.href).toMatch(/^\/[a-z0-9][a-z0-9/?=&-]*$/i);
        expect(article.action.label.ar).toBeTruthy();
        expect(article.action.label.en).toBeTruthy();
      }
      for (const relatedSlug of article.related ?? []) {
        expect(relatedSlug).not.toBe(article.slug);
        expect(getHelpArticle(relatedSlug)).toBeDefined();
      }
    }
  });

  it('adds the reviewed PR-HELP-2B workflows without changing V1 slugs', () => {
    expect(HELP_ARTICLES).toHaveLength(17);
    expect(HELP_ARTICLES.slice(0, 10).map((article) => article.slug)).toEqual([
      'first-steps',
      'switch-active-branch',
      'create-sales-invoice',
      'record-customer-payment',
      'record-purchase-invoice',
      'create-product',
      'run-stocktake',
      'manual-journal-entry',
      'period-locks',
      'pos-session-and-sale',
    ]);
    expect(HELP_ARTICLES.map((article) => article.slug)).toEqual(expect.arrayContaining([
      'create-partner',
      'create-sales-quote',
      'delivery-notes',
      'import-inventory-opening',
      'stock-permits',
      'record-expense',
      'fiscal-year-close',
    ]));
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

  it('finds the new workflows in Arabic and English', () => {
    expect(searchHelpArticles('سند تسليم', 'ar').map((article) => article.slug)).toContain('delivery-notes');
    expect(searchHelpArticles('opening balance import', 'en').map((article) => article.slug)).toContain('import-inventory-opening');
    expect(searchHelpArticles('إقفال سنة مالية', 'ar').map((article) => article.slug)).toContain('fiscal-year-close');
  });

  it('documents the reviewed partner price-list and linked-expense edge cases accurately', () => {
    const partnerProblem = getHelpArticle('create-partner')?.sections.find((section) => section.title.en === 'Common problem');
    expect(partnerProblem?.paragraphs?.[0].en).toContain('invoice-view permission');
    expect(partnerProblem?.paragraphs?.[0].en).toContain('Inactive lists appear disabled');
    expect(partnerProblem?.paragraphs?.[0].ar).toContain('صلاحية عرض الفواتير');
    expect(partnerProblem?.paragraphs?.[0].ar).toContain('القوائم غير النشطة معطلة');

    const expenseNote = getHelpArticle('record-expense')?.sections[0].note;
    expect(expenseNote?.en).toContain('Any draft can be edited');
    expect(expenseNote?.en).toContain('deleted unless it is linked to a source document');
    expect(expenseNote?.ar).toContain('يمكن تعديل أي مسودة');
    expect(expenseNote?.ar).toContain('حذفها ما لم تكن مرتبطة بمستند مصدر');
  });
});
