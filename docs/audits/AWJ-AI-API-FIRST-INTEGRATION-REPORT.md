# AWJ AI API — أول تكامل عملي لوكلاء الذكاء الاصطناعي

**الفرع:** `claude/awj-ai-api-first-integration-e0lkfs` · **PR:** https://github.com/safwan5001-source/Nebrax/pull/2026 (مفتوح، غير مسوَّدة، `mergeable_state: clean`)
**Base SHA (فرع التطوير):** `8e59782` · **قاعدة الـ PR (`main`):** `2c78b221` · **Head SHA المُختبَر:** `6f8388684a8d809cefb97c72e8246dcc9481a749` (بعده commit توثيق فقط لهذا التقرير).
**الحالة النهائية: جاهز للمراجعة — لم يُنفَّذ Merge ولا Deploy، ولم يُصدَر أي مفتاح API حقيقي.**

## الخلاصة

لا يلزم نظام جديد: **الـ Public API v1 القائمة** (`/api/v1`) هي قناة الوكيل — مفتاح M2M (توكن Sanctum على `ApiClient`)، scopes أقل امتياز، عزل مستأجر، idempotency، حدود معدّل، تدقيق. الناقص الوحيد كان **كشف حساب الطرف**، فأُضيف كمسار قراءة فقط. لم يُنشأ MCP/Gateway/واجهة، ولم تُمسّ قواعد المحاسبة أو قاعدة البيانات أو الهجرات.

## الوظائف الجاهزة فعلياً

| العملية | المسار | Scope | ملاحظات |
|---|---|---|---|
| البحث عن العملاء | `GET /api/v1/partners?search=&type=customer` | `partners:read` | قائم سابقاً |
| البحث عن المنتجات | `GET /api/v1/products?search=` | `products:read` | قائم سابقاً |
| إنشاء منتج | `POST /api/v1/products` | `products:write` | `Idempotency-Key` إلزامي؛ بلا مخزون/قيد |
| فاتورة مبيعات **مسودة** | `POST /api/v1/invoices` | `invoices:write` | `InvoiceService::create` فقط؛ الخادم يحسب الإجماليات؛ بلا قيد/ترحيل/سداد/ZATCA |
| كشف حساب عميل | `GET /api/v1/partners/{id}/statement?from=&to=&role=` | `statements:read` (**جديد**) | قراءة فقط، هللات، سقف 2000 حركة |

## أمثلة الاستدعاء (بلا أسرار)

```bash
BASE="https://<api-host>/api/v1"; H="Authorization: Bearer $AWJ_API_KEY"   # المفتاح من متغير بيئة

curl -s -H "$H" "$BASE/partners?search=النور&type=customer"
curl -s -H "$H" "$BASE/products?search=AGENT-001"

curl -s -H "$H" -H "Idempotency-Key: agent-product-1" -H "Content-Type: application/json" \
  -X POST "$BASE/products" \
  -d '{"name":"منتج الوكيل","sku":"AGENT-001","sale_price_minor":10000,"tax_rate":15}'

curl -s -H "$H" -H "Idempotency-Key: agent-invoice-1" -H "Content-Type: application/json" \
  -X POST "$BASE/invoices" \
  -d '{"partner_id":"<uuid>","items":[{"product_id":"<uuid>","quantity":2,"unit_price_minor":10000,"tax_rate":15}]}'

curl -s -H "$H" "$BASE/partners/<uuid>/statement?from=2026-01-01&to=2026-03-31"
```

إصدار المفتاح: واجهة المطوّر في الإعدادات، أو `php artisan public-api:create-client <tenant> <name> --issuer=<email> --scopes=partners:read,products:read,products:write,invoices:write,statements:read --expires-days=90` (**`--issuer` إلزامي منذ AIA-0.4**: يُطبَّق سقف صلاحيات المستخدم؛ الأمر بلا `--issuer` يفشل). يُعرض النص الصريح مرة واحدة فقط.

## الملفات المتغيرة

- `app/Support/PublicApiScope.php` — إضافة `statements:read` (⇒ `reports.view`).
- `app/Http/Controllers/Api/PublicPartnerStatementController.php` (جديد) — غلاف فوق `ReportService::partnerStatement`، لا منطق محاسبي موازٍ.
- `routes/api_public.php` — المسار تحت سلسلة القراءة (مصادقة ← حارس المستأجر ← تدقيق ← حدّ القراءة ← اشتراك ← scope).
- `docs/openapi/public-api-v1.yaml` — العملية والمخططات (يحرسه `PublicApiOpenApiContractTest`).
- `web/` — `openapi-model.generated.ts` (مُولَّد بـ `npm run openapi:generate`)، رسائل ar/en للـ scope الجديد، تحديث عدّادات اختبارَي الانحراف/المطوّر (8→9 scopes، 16→17 عملية). لا واجهة جديدة.
- `tests/Feature/PublicApiPartnerStatementTest.php` (جديد، 11 اختباراً) · `CLAUDE.md` (فقرة موجزة) · هذا التقرير.

## الاختبارات

- `PublicApiPartnerStatementTest`: **11/11** — 401 بلا مفتاح، 403 لscopes أخرى، توكن مستخدم بشري مرفوض، دقّة الهللات، تدوير الرصيد الافتتاحي بفلتر الفترة، 422 للفلاتر المعيبة، UUID غير صالح، GET فقط (405)، **عزل المستأجر (404 بلا تسريب)**، رفض الكشف الضخم دون اقتطاع، وتدفق الوكيل الكامل (بحث ← منتج + replay idempotent ← مسودة فاتورة بلا قيد ← كشف).
- `PublicApiInvoiceWriteTest` 16/16؛ `PublicApiOpenApiContractTest` ضمن الحزمة الكاملة.
- الويب: vitest لـ developer/OpenAPI 40/40 وكل اختبارات الرسائل خضراء. `tsc --noEmit` يُظهر أخطاء سابقة في ملفات اختبار/e2e غير ذات صلة (POS/commerce) لم تتغير.
- الحزمة الكاملة محلياً (SQLite): **11,037 ناجحة، 0 إخفاقات، 382 متخطّاة** (110,735 assertion). ملاحظة: أول تشغيل أظهر 41 إخفاقاً في وحدة الوقود لغياب ملحق `bcmath` في البيئة (`bcmul` غير معرّفة)؛ بعد تثبيته نجح كل شيء. لا علاقة للتغيير بالوقود.
- **CI على GitHub (الرأس `6f83886`) — كلها ناجحة:** `php artisan test (L11, pgsql)` ✅ · `php artisan test (L11, sqlite)` ✅ · `PostgreSQL feed-lock performance (COPS-H1-1)` ✅ · `web build (Next.js)` ✅ · `CI Gate` ✅. مراجعة Codex: اكتملت بلا ملاحظات.
- لم يلزم أي إصلاح بعد فتح الـ PR.

## المخاطر والمتبقي

1. **الكشف غير مقسَّم**: الرصيد الجاري يحتاج التسلسل كاملاً، فالسقف 2000 حركة يرفض (422) بدل الاقتطاع. ترقيم صفحات يحتاج قرار عقد.
2. **النطاق على مستوى المستأجر (كل الفروع)** كبقية الـ Public API؛ لا تقييد فرع للمفتاح بعد.
3. **`statements:read` يكشف أرصدة العملاء** — يُمنح فقط للوكلاء الذين يحتاجونه، مع `--expires-days`.
4. **تسريب حارس المصادقة في الاختبارات**: مسارات الـ Internal تترك `Auth::shouldUse('sanctum')` ضمن العملية فيكسر نداء Public لاحقاً في الاختبار نفسه؛ الإنتاج غير متأثر (طلب = عملية). عولج في الاختبار ووُثّق في `CLAUDE.md`، ولم يُعدَّل `ReportService`.
5. الفاتورة المسودة لا يرحّلها الوكيل؛ الترحيل/السداد يبقى للمستخدم البشري عمداً. كتابات أخرى (تعديل/حذف) غير مكشوفة.
6. لم يُختبر على بيئة حيّة/Staging؛ PostgreSQL مغطّى بـCI (ناجح).
7. أثر محاسبي جديد: **لا شيء** — لا قيود جديدة؛ المسودة بلا قيد، والكشف قراءة.

## الخطوة التالية الوحيدة المقترحة

إصدار مفتاح اختبار على Staging بالـ scopes الخمسة وتشغيل الأمثلة أعلاه يدوياً مرة واحدة ثم قرار المالك على فتحه لوكيل فعلي.
