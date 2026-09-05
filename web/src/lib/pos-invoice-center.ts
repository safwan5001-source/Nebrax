/**
 * PR-4: مركز فواتير POS — دوال نقية بلا React.
 *
 * القائمة نفسها تصل من `GET /pos/recent-invoices` (فواتير POS للفرع النشط
 * فقط، صلاحية `invoices.manage` موجودة أصلاً) — هذا الملف لا يستدعي أي شيء
 * خادمياً، فقط يصفّي محلياً ما وصل بالفعل. لا بحث خادمي على هذا المسار اليوم
 * (الحقل الوحيد المدعوم هو `limit`)، فالتصفية هنا تعويضٌ واجهي صريح، لا محاكاة
 * لقدرة خادمية غير موجودة.
 */

export interface PosCenterInvoice {
  id: string;
  number: string;
  invoice_date: string | null;
  created_at: string | null;
  customer_name: string | null;
  total: string;
  payment_status: string | null;
  payment_methods: string[];
  status: string;
}

/** تصفية محلية بحتة: رقم الفاتورة أو اسم العميل. لا حساسية لحالة الأحرف. */
export function filterPosCenterInvoices(
  invoices: readonly PosCenterInvoice[],
  query: string,
): PosCenterInvoice[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...invoices];
  return invoices.filter((invoice) => (
    invoice.number.toLowerCase().includes(q)
    || (invoice.customer_name ?? '').toLowerCase().includes(q)
  ));
}
