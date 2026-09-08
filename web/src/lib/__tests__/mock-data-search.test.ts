import { describe, expect, it } from 'vitest';
import { mockApi } from '../mock-data';

interface ListResponse<T> {
  data: T[];
}

interface MockInvoiceRow {
  id: string;
  number: string;
}

interface MockPurchaseRow {
  id: string;
  number: string;
  supplier_invoice_no: string | null;
}

interface MockProductRow {
  id: string;
  name: string;
  sku: string | null;
}

interface MockJournalEntryRow {
  id: string;
  number: string;
}

interface MockPartnerRow {
  id: string;
  name: string;
  type: string;
  code?: string | null;
}

/**
 * إعادة إنتاج عطل الإنتاج المؤكَّد (PR #678 على وضع المعاينة فقط):
 * `mockApi` كانت تشتقّ مسار المطابقة عبر `path.split('?')[0]` فتتجاهل
 * سلسلة الاستعلام بالكامل — أي بحث AWJ عن `INV-2026-0116` كان يعيد قائمة
 * الفواتير الكاملة غير المصفّاة (بما فيها INV-2026-0118 وINV-2026-0117)
 * بدل الفاتورة المطابقة وحدها. هذا لا يمسّ الخادم الحقيقي (`InvoiceController`
 * وبقية المتحكّمات تُصفّي بمعامل `search` بشكل صحيح فعلاً) — العطل محصور في
 * طبقة المعاينة المحلية وحدها.
 */
describe('mockApi — تصفية البحث (وضع المعاينة)', () => {
  it('فواتير: بحث برقم فاتورة كامل يعيد تلك الفاتورة فقط، لا القائمة كاملة', async () => {
    const res = await mockApi<ListResponse<MockInvoiceRow>>('/invoices?search=INV-2026-0116&per_page=4');

    expect(res.data.map((row) => row.number)).toEqual(['INV-2026-0116']);
    // إعادة إنتاج صريحة لما رآه Safwan فعلياً: هاتان الفاتورتان يجب ألا تظهرا.
    expect(res.data.some((row) => row.number === 'INV-2026-0118')).toBe(false);
    expect(res.data.some((row) => row.number === 'INV-2026-0117')).toBe(false);
  });

  it('فواتير: بحث جزئي بالرقم يطابق كل الفواتير المحتوية عليه', async () => {
    const res = await mockApi<ListResponse<MockInvoiceRow>>('/invoices?search=0116');
    expect(res.data.map((row) => row.number)).toEqual(['INV-2026-0116']);
  });

  it('فواتير: بحث باسم العميل يطابق فواتيره', async () => {
    const res = await mockApi<ListResponse<MockInvoiceRow>>('/invoices?search=' + encodeURIComponent('مصنع الشرق للبلاستيك'));
    expect(res.data.map((row) => row.number)).toContain('INV-2026-0116');
  });

  it('فواتير: بحث بلا تطابق يعيد قائمة فارغة، لا القائمة الافتراضية', async () => {
    const res = await mockApi<ListResponse<MockInvoiceRow>>('/invoices?search=NO-SUCH-INVOICE-ZZZ');
    expect(res.data).toEqual([]);
  });

  it('فواتير: بلا معامل search يستمرّ إرجاع القائمة الكاملة (توافق رجعي)', async () => {
    const withoutSearch = await mockApi<ListResponse<MockInvoiceRow>>('/invoices');
    const withEmptySearch = await mockApi<ListResponse<MockInvoiceRow>>('/invoices?search=');
    expect(withoutSearch.data.length).toBeGreaterThan(1);
    expect(withEmptySearch.data.length).toBe(withoutSearch.data.length);
  });

  it('مشتريات: بحث برقم فاتورة المورد يطابق المشترى الصحيح وحده', async () => {
    const res = await mockApi<ListResponse<MockPurchaseRow>>('/purchases?search=S-9921');
    expect(res.data.map((row) => row.number)).toEqual(['PUR-2026-0042']);
  });

  it('منتجات: بحث بالاسم لا يعيد كتالوجاً غير مصفّى', async () => {
    const all = await mockApi<ListResponse<MockProductRow>>('/products');
    const first = all.data[0];
    const res = await mockApi<ListResponse<MockProductRow>>(`/products?search=${encodeURIComponent(first.name)}`);

    expect(res.data.length).toBeGreaterThan(0);
    expect(res.data.every((row) => row.name === first.name)).toBe(true);
    expect(res.data.length).toBeLessThanOrEqual(all.data.length);
  });

  it('قيود يومية: بحث برقم القيد يعيد ذلك القيد وحده', async () => {
    const res = await mockApi<ListResponse<MockJournalEntryRow>>('/journal-entries?search=JE-2026-0003');
    expect(res.data.map((row) => row.number)).toEqual(['JE-2026-0003']);
  });

  it('قيود يومية: بحث بلا تطابق يعيد قائمة فارغة', async () => {
    const res = await mockApi<ListResponse<MockJournalEntryRow>>('/journal-entries?search=ZZZ-NOPE');
    expect(res.data).toEqual([]);
  });
});

/**
 * تفادي تكرار عطل PR #680 (تجاهل سلسلة الاستعلام في وضع المعاينة) لكن على
 * `/partners` تحديداً — الشريحة التي تضيفها هذه المهمة (عملاء/موردون) في AWJ
 * Global Search. القواعد يجب أن تطابق `PartnerController::index` الحقيقي:
 * type=customer|supplier يُطبَّق أولاً (customer/both أو supplier/both)، ثم
 * search يُصفّي فوقه بحقول الهوية نفسها (name/name_en/code/vat/cr/phone/mobile/email).
 */
describe('mockApi — تصفية الأطراف (عملاء/موردون، وضع المعاينة)', () => {
  it('عملاء: بحث بالكود يعيد ذلك الطرف وحده ضمن نطاق customer', async () => {
    const res = await mockApi<ListResponse<MockPartnerRow>>('/partners?type=customer&search=C-001');
    expect(res.data.map((row) => row.code)).toEqual(['C-001']);
    expect(res.data.every((row) => row.type === 'customer' || row.type === 'both')).toBe(true);
  });

  it('موردون: بحث بالكود يعيد ذلك الطرف وحده ضمن نطاق supplier', async () => {
    // S-002 لا يتقاطع مع كود الطرف المزدوج (CS-001) خلافاً لـS-001 — سلوك LIKE
    // الحقيقي في الـbackend يطابق أي جزء نصي أيضاً، لا مطابقة كاملة للكود.
    const res = await mockApi<ListResponse<MockPartnerRow>>('/partners?type=supplier&search=S-002');
    expect(res.data.map((row) => row.code)).toEqual(['S-002']);
    expect(res.data.every((row) => row.type === 'supplier' || row.type === 'both')).toBe(true);
  });

  it('طرف من نوع both يظهر في نتائج العملاء والموردين معاً', async () => {
    const asCustomer = await mockApi<ListResponse<MockPartnerRow>>('/partners?type=customer&search=CS-001');
    const asSupplier = await mockApi<ListResponse<MockPartnerRow>>('/partners?type=supplier&search=CS-001');

    expect(asCustomer.data.map((row) => row.code)).toEqual(['CS-001']);
    expect(asSupplier.data.map((row) => row.code)).toEqual(['CS-001']);
    expect(asCustomer.data[0].type).toBe('both');
  });

  it('عزل النوع: بحث برقم ضريبي عميل بحت لا يظهر ضمن نطاق supplier', async () => {
    const res = await mockApi<ListResponse<MockPartnerRow>>('/partners?type=supplier&search=311111111100003');
    expect(res.data).toEqual([]);
  });

  it('بلا معامل search يستمرّ إرجاع قائمة النوع الكاملة (توافق رجعي)', async () => {
    const withoutSearch = await mockApi<ListResponse<MockPartnerRow>>('/partners?type=customer');
    const withEmptySearch = await mockApi<ListResponse<MockPartnerRow>>('/partners?type=customer&search=');
    expect(withoutSearch.data.length).toBeGreaterThan(1);
    expect(withEmptySearch.data.length).toBe(withoutSearch.data.length);
  });

  it('بلا type أو search يعيد كل الأطراف كما في السلوك الحالي', async () => {
    const res = await mockApi<ListResponse<MockPartnerRow>>('/partners');
    expect(res.data.length).toBeGreaterThan(1);
  });

  it('per_page يحدّ عدد نتائج البحث حين يُدعم', async () => {
    const res = await mockApi<ListResponse<MockPartnerRow>>('/partners?search=' + encodeURIComponent('ة') + '&per_page=2');
    expect(res.data.length).toBeLessThanOrEqual(2);
  });
});
