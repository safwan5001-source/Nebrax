# P1-3b-2a-0 — تدقيق كتّاب الفواتير وتصليب ثبات تواريخها في القاعدة

> **الحالة:** PR مستقل، **بلا دمج تلقائي**. **لا يغيّر أي سلوك محاسبي أو ضريبي قائم**، ولا يلمس محرك الترحيل ولا البوابة ولا بيانات dominah، ولا ينشئ فاتورة أو سنداً أو قيداً. الأساس: D-E4 المعتمد في `AWJ_FUEL_SETTLEMENT_P1_3B_2_ENGINE_DESIGN.md` (#2079) بشرط «تدقيق جميع كتّاب الفواتير قبل تطبيق الحراس».

## 1) ما يفعله

هجرة واحدة `2027_01_20_010000_add_invoice_frozen_date_fences` — **مُشغّلات فقط** (PostgreSQL وSQLite): لا عمود، لا فهرس، لا تعديل لأي صف، لا Backfill.

| القاعدة | النص |
|---|---|
| R1 | `issued_at` متى خُزِّن لا يتغيّر ولا يُمسح |
| R2 | `issued_at` لا يُكتب (من NULL) على فاتورة **ليست مسودة** — لا ختم رجعي |
| R3 | `party_snapshot` متى خُزِّنت لا تتغيّر ولا تُمسح (JSON منطقياً على PostgreSQL) |
| R4 | `party_snapshot` لا تُكتب (من NULL) على فاتورة ليست مسودة |
| R5 | `invoice_date` لا يتغيّر بعد خروج الفاتورة من المسودة أو بعد وجود `issued_at` |

الكتابة الأولى لـ`issued_at`/`party_snapshot` تحدث **في التحديث الذي يرحّل المسودة** (`OLD.status = 'draft'`) وهو مسار `InvoiceService::post` الوحيد، فتبقى مسموحة.

## 2) تدقيق الكتّاب

**الطريقة:** (أ) فحص ساكن لكل تعبير يكتب `invoice_date`/`issued_at`/`party_snapshot` في `app/` و`database/`؛ (ب) فحص كل `Invoice::create`/`new Invoice`/`->update` على فاتورة؛ (ج) **فحص ديناميكي:** تشغيل المجموعة الكاملة على SQLite وPostgreSQL بالمُشغّلات مفعّلة — أي كاتب لم يلتقطه الفحص الساكن يُفشل اختباراً.

| المسار | العملية | أعمدة معنية | الأثر |
|---|---|---|---|
| `InvoiceService::create` | INSERT (مسودة) | `invoice_date` | لا أثر: المُشغّلات `BEFORE UPDATE` فقط |
| `InvoiceService::update` | UPDATE، **مسودة فقط** (يرفض `! isDraft()` داخل معاملة بقفل) | `invoice_date` | مسموح (`OLD.status = 'draft'` وبلا `issued_at`) — مثبَّت باختبار |
| `InvoiceService::post` | UPDATE مسودة ← مرحَّلة | `issued_at`، `party_snapshot` (كتابة أولى) | مسموح (`OLD.status = 'draft'`) — مثبَّت؛ `invoice_date` لا يُكتب |
| `RecurringInvoiceService`، `DeliveryNoteSalesInvoiceDraftBuilder`، `CommerceOrderPostingService`، `PublicInvoiceController`، `FuelSaleService`، نقاط البيع | كلها تمرّ بـ`InvoiceService::create/post` | — | لا مسار موازٍ يكتب الأعمدة |
| `ZatcaSubmissionDispatcher` | UPDATE | `zatca_cleared_xml` | عمود آخر — لا أثر |
| `ZatcaCreditNoteIssuer`، `ZatcaChainAllocator` | كتابة | `issued_at`/`party_snapshot` **على `credit_notes` و`zatca_chain_entries`** | جدولان آخران — خارج النطاق (لهما حراسهما) |
| `FuelSupplyReceivingService` | كتابة | `invoice_date` على **`fuel_supplier_invoices`** | جدول آخر — لا أثر |
| هجرات `000053` و`000129` | UPDATE تاريخية | `zatca_icv`/`zatca_document_type` | أعمدة أخرى، وتسبق وجود المُشغّلات |
| أوامر الكونسول | لا كتابة على الأعمدة الثلاثة | — | لا أثر |

**الخلاصة:** الكاتب الوحيد لأي من الأعمدة الثلاثة بعد الإنشاء هو `InvoiceService` (تعديل مسودة وترحيل)، وكلاهما متوافق. لا مسار تطبيقي يعدّل تاريخ فاتورة مرحَّلة.

### الاختبارات (ليست كود تطبيق) التي كانت تحاكي حالات «ما قبل الميزة»
ثمانية مواضع في خمسة ملفات تغيّر الأعمدة الثلاثة على صف مرحَّل عمداً (لمحاكاة صفوف تاريخية بلا `issued_at`/لقطة، أو لتقديم تاريخ فاتورة في اختبار ترتيب): `InvoiceIssuedAtTest`، `InvoicePartySnapshotTest`، `CreditNoteLegacyBlockTest`، `PosRecentInvoicesTest`، `ZatcaCreditNoteIssuanceTest`. ولا يمكن لأي كود تطبيق إنتاج هذه الحالات، فتُسقط المُشغّلات داخل المعاملة المحيطة وتُعاد فوراً عبر `SimulatesLegacyInvoiceRows` (نمط اختبارات سلسلة ZATCA). **لا مسار تجاوز في الإنتاج.** اختباران من الثمانية يسقطان عمود `issued_at`/`party_snapshot` نفسه (اختبارا هجرتَيْهما) فيجب إسقاط المُشغّلات المعتمدة على العمود قبل ذلك.

## 3) إثبات عدم تغيير السلوك

- `InvoiceFrozenDatesFenceTest` (9 اختبارات، SQLite وPostgreSQL): الرفض في القاعدة عبر `DB::table` وBuilder وSQL خام (يتجاوز حارس النموذج)، تحرير المسودة وترحيلها كما كانا، تحديث الأعمدة الأخرى لفاتورة مرحَّلة، إعادة كتابة القيمة نفسها، المبالغ والقيد وICV بلا تغيير، ورجوع الهجرة يُسقط المُشغّلات فقط، والهجرة لا تحتوي أي `ALTER`/`UPDATE`/`INSERT`.
- المجموعة الكاملة على SQLite وPostgreSQL (النتائج في وصف الـPR) + CI.
- طبقة حماية ثانية قائمة: `Invoice::booted` و`InvoicePartySnapshotTest::no_application_code_writes_the_write_once_columns_outside_the_posting_path` لم يتغيّرا.

## 4) المخاطر المتبقية والنشر والتراجع

| بند | التفصيل |
|---|---|
| تصحيح بيانات يدوي من DBA | أي تعديل مباشر لهذه الأعمدة سيُرفض؛ يتطلب إسقاط المُشغّلات بالتراجع ثم إعادتها — **مقصود** (ثبات تاريخ الإصدار) |
| صفوف تاريخية | تبقى NULL ولا تُختم رجعياً (R2/R4)؛ كل تحديث آخر عليها يعمل |
| حالة `cancelled` | لا مسار تطبيقي يضعها؛ القواعد تعاملها كغير مسودة (محافظ) |
| PostgreSQL | `CREATE TRIGGER` يأخذ `SHARE ROW EXCLUSIVE` على `invoices` لحظياً (يمنع الكتابة لا القراءة)؛ يُنصح بتنفيذه في نافذة هادئة مع `lock_timeout` |
| SQLite | مقارنة اللقطة نصية (JSON مخزَّن نصاً)؛ الكتابة المتسلسلة تجعل الفحص ذرّياً |
| التراجع | `down()` يُسقط المُشغّلات والدالة فقط ولا يعتمد على صفوف |
| كلمات المرور/الأسرار/الأثر المالي | لا شيء من ذلك في هذه الهجرة |

## 5) ما لا يفعله
لا محرك ترحيل، لا أعمدة تواريخ التسوية (2a)، لا تغيير لأي خدمة، لا فتح للبوابة، لا نشر، لا مساس بـdominah.
