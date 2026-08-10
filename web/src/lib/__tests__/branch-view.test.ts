import { describe, expect, it } from 'vitest';
import { branchViewQuery } from '../branch-view';

/**
 * لاحقة نطاق العرض. أهميتها أن الخادم يصفّي بالفرع النشط **افتراضياً**،
 * فغياب اللاحقة هو ما يُنتج العرض المعزول — وحضورها وحده يفتح كل الفروع.
 */
describe('branchViewQuery', () => {
  it('لا يضيف شيئاً لعرض الفرع الحالي (الافتراضي المعزول)', () => {
    expect(branchViewQuery('current')).toBe('');
    expect(branchViewQuery('current', true)).toBe('');
  });

  it('يبدأ سلسلة استعلام جديدة حين لا توجد', () => {
    expect(branchViewQuery('all')).toBe('?branch=all');
  });

  it('يُلحق بسلسلة قائمة بدل كسرها', () => {
    // شاشات المرتجعات تحمل `?type=` أصلاً — فاللاحقة يجب أن تكون `&`.
    expect(branchViewQuery('all', true)).toBe('&branch=all');
  });
});
