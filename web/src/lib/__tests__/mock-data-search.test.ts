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
