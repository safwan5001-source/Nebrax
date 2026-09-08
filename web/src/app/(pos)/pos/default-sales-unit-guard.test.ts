import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * PR-UOM2-3: قرار المالك الصريح — `default_sales_unit` يبقى معلوماتياً بحتاً في
 * نقطة البيع. لا يُطبَّق تلقائياً عند إضافة منتجٍ للسلة (`addProduct`) ولا عند
 * حلّ الوحدة المُسعَّرة (`pricedUnit`) ولا في حمولة الدفع — الإضافة العادية
 * بالنقر تستمر على الوحدة الأساسية كما كانت قبل هذه المهمّة تماماً.
 *
 * هذا اختبارٌ بنيويّ (وليس اختبار سلوكٍ عبر render) يثبت الالتزام ببقاء
 * `default_sales_unit` محصوراً في مكانين فقط داخل `page.tsx`: تعريف حقل
 * `Product.default_sales_unit`، ووسم الخيار الافتراضي داخل قائمة اختيار
 * الوحدة بالسطر. أي استعمالٍ ثالثٍ لاحق (مثلاً تمريره إلى `addProduct` أو
 * `pricedUnit` أو حمولة الدفع) يكسر هذا الاختبار عمداً — فهذا بالضبط ما
 * يُمنع القرار D-A حدوثه.
 */
describe('PR-UOM2-3: default_sales_unit يبقى معلوماتياً فقط في POS', () => {
  it('لا يُستعمَل إلا في تعريف النوع ووسم الخيار — لا في أي منطق اختيارٍ أو دفع', () => {
    const source = fs.readFileSync(path.join(process.cwd(), 'src/app/(pos)/pos/page.tsx'), 'utf8');

    // كل سطرٍ يذكر `default_sales_unit` (باستثناء مفتاح الترجمة
    // `default_sales_unit_marker`، وهو معرِّفٌ مختلف) يجب أن يكون إمّا تعريف
    // الحقل في النوع، أو وسم الخيار داخل قائمة الاختيار — لا مكان ثالث.
    const allowedLines = [
      'default_sales_unit?: string | null;',
      "{lineProduct?.default_sales_unit && unit.name === lineProduct.default_sales_unit ? ` (${tprod('default_sales_unit_marker')})` : ''}",
    ];
    const offendingLines = source
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.includes('default_sales_unit') && !line.includes('default_sales_unit_marker'))
      .filter((line) => !allowedLines.includes(line));

    expect(offendingLines, 'default_sales_unit استُعمل خارج تعريف النوع/وسم الخيار — راجع القرار D-A لنقطة البيع').toEqual([]);

    expect(source).toContain('default_sales_unit?: string | null;');
    expect(source).toContain("tprod('default_sales_unit_marker')");
  });
});
