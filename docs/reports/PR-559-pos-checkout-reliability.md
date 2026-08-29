# تقرير التنفيذ — PR-8: POS Checkout Reliability

**التاريخ:** 2026-08-29  
**المشروع:** Nebrax ERP — نقطة البيع (POS)  
**المرجع:** PR-8 فوق أحدث `main` بعد دمج #557 (`fdef3ac0`)

---

## 1. PR number

[#559](https://github.com/safwan5001-source/Nebrax/pull/559)

## 2. branch

`cursor/pos-checkout-reliability-d6c1`

> سياسة Cloud Agent فرضت البادئة `cursor/` واللاحقة `-d6c1` (يعادل `feat/pos-checkout-reliability` في ملف المهمة).

## 3. base SHA

`fdef3ac074af296defefd7f44837ee39535ec840` — `origin/main` بعد دمج #557 (PR-7 Interaction Modes).

## 4. final HEAD SHA

`a6afbacb7f632d79dc5f5dbde1b3c443a74a230e`

## 5. changed files

### جديد

```
database/migrations/2026_08_31_030000_create_pos_checkout_attempts_table.php
app/Models/PosCheckoutAttempt.php
tests/Feature/PosCheckoutIdempotencyTest.php
web/src/lib/pos-checkout-attempt.ts
web/src/lib/__tests__/pos-checkout-attempt.test.ts
web/e2e/pos-checkout-reliability.spec.ts
docs/reports/PR-559-pos-checkout-reliability.md
docs/visual-qa/pr-559/*.png
```

### محدّث (أبرزها)

```
app/Services/Accounting/PosService.php
app/Http/Controllers/Api/PosController.php
app/Http/Controllers/Api/ApiController.php
app/Http/Requests/StorePosSaleRequest.php
app/Services/Accounting/PosExchangeService.php
app/Services/Pos/PosAuditService.php
web/src/app/(pos)/pos/page.tsx
web/src/components/pos/pos-payment.tsx
web/src/lib/mock-data.ts
web/src/messages/ar.json / en.json
tests/Feature/PosCheckoutTest.php (+ باقي اختبارات POS التي ترسل checkout)
```

لم يُمس: ترقيم المستندات، ZATCA ICV، قيود VAT/journal، Interaction Modes (PR-7)، قشرة PR-6، الاختصارات، الماسح، offline queue.

## 6. audit findings (Gap Matrix)

| # | البند | الموجود قبل | الفجوة التي أُغلقت |
|---|--------|-------------|---------------------|
| 1 | حماية UI | `paymentRequestRef` + `paying` | attempt UUID + phases |
| 2 | منع UI submit مكرر | نعم داخل التبويب | بقي كما هو |
| 3 | منع HTTP مكرر | لا | `idempotency_key` required UUID |
| 4 | منع إنشاء مالي مكرر | معاملة ذرّية فقط | `UNIQUE(tenant, branch, key)` |
| 5 | timeout بعد نجاح السيرفر | فاتورة ثانية | replay بنفس المفتاح |
| 6 | recovery | تدقيق يدوي فقط | POST idempotent |
| 7 | SoT مالي للمفتاح | لا | جدول `pos_checkout_attempts` |
| 8 | أصغر تعديل | — | مرساة + حقل + قفل UX + اختبارات |

لا STOP conditions: لا idempotency مكتمل مسبقاً؛ #556/#558 لا يمسّان `/pos/checkout`.

## 7. existing UI lock reused

أُبقي `paymentRequestRef` و`paying` وCTA المعطّل في `pos-payment.tsx`. لم يُبنَ قفل موازٍ. F9 يبقى فتح شاشة الدفع فقط؛ التأكيد يمر من نفس القفل.

## 8. idempotency source of truth

جدول `pos_checkout_attempts` (BranchScoped، كتابة محصورة بالخدمة):

- `tenant_id`, `branch_id`, `idempotency_key` (128), `request_checksum` (64)
- `invoice_id` FK، `cart_id` nullable، `pos_session_id`، `created_by`، `created_at`
- `UNIQUE(tenant_id, branch_id, idempotency_key)`

ليست localStorage حقيقة مالية. مفتاح الواجهة UUID مؤقت للمحاولة فقط.

## 9. request checksum

Checksum دلالي مستقر من: partner، session، cart، warehouse، tax_inclusive، items، tenders، notes — بلا مبالغ مشتقة يدوياً. نفس المفتاح + checksum مختلف → 409.

## 10. replay behavior

نفس tenant+branch+key ونفس checksum → إعادة الفاتورة القائمة، HTTP **200** + `idempotent_replay: true`، وحدث تدقيق `checkout_idempotent_replay` عند وجود `cart_id`.

## 11. conflict behavior

Checksum مختلف لنفس المفتاح → `PosIdempotencyConflictException` → **409**. يُعاد رميه من `ApiController::domain` قبل تحويل `RuntimeException` إلى 422.

## 12. concurrent / retry-before-commit

اختبارات: طلبان منطقيان بنفس المفتاح → بيع واحد؛ فشل قبل commit ثم retry بنفس المفتاح → نجاح واحد بلا تكرار مالي.

## 13. frontend attempt key lifecycle

`PosCheckoutAttemptController` في `pos-checkout-attempt.ts`:

- `ensure()` يثبت UUID
- يتجدد فقط عبر `resetAfterSuccess()` أو `reset()` صريح
- يُرسل كـ`idempotency_key` في جسم `POST /pos/checkout`

## 14. checkout phases / UX

| phase | CTA | رسالة |
|-------|-----|--------|
| `submitting` | معطّل + spinner | جارٍ إتمام البيع… |
| `recovering` | معطّل | نتحقق من إتمام البيع… |
| `retryable_error` | مفعّل | تعذر إتمام الطلب. يمكنك إعادة المحاولة بأمان. |
| `success` | مغادرة شاشة الدفع | تمّ البيع / تم تأكيد البيع (عند replay) |

## 15. recovery path

بعد خطأ شبكة على الاستجابة الأولى: إعادة POST بنفس المفتاح. إن كان الخادم قد أنشأ البيع تُعاد الفاتورة (replay). محاكي الديمو: `__POS_CHECKOUT_FAIL_ONCE` يخزّن النتيجة ثم يرفض الشبكة مرة واحدة.

## 16. numbering / ZATCA ICV

لم يتغيّر. لا مسار جديد لـ`GeneratesDocumentNumbers` ولا لـ`ZatcaIcvScope`.

## 17. journal / VAT / stock

orchestration الحالي في `PosService::checkout` بلا تغيير للقيد/المخزون/الضريبة. Replay لا يكرّر journal ولا stock ولا حقول ZATCA.

## 18. exchange path

`PosExchangeService` يولّد UUID خادمي لكل استبدال (عملية منطقية جديدة) حتى لا يفشل التحقق `required|uuid`.

## 19. demo mock support

`POST /pos/carts` يعيد `cart_id`؛ أحداث السلة ناجحة؛ checkout يدعم delay / fail-once / force-network / attempt store. بدون `cart_id` كانت `ensureAuditCart` تفشل قبل الإرسال.

## 20. backend tests (exact)

`PosCheckoutIdempotencyTest`: **7 passed** (88 assertions):

1. نفس المفتاح → بيع واحد  
2. حمولة مختلفة → 409  
3. مفتاح مختلف → بيع جديد  
4. عزل tenant  
5. فشل ثم retry بنفس المفتاح  
6. replay بلا تكرار stock/journal/ZATCA  
7. المفتاح مطلوب  

اختبارات POS المعدَّلة لإرسال `idempotency_key` خضراء محلياً.

## 21. frontend Vitest (exact)

| الملف | العدد |
|-------|------|
| `pos-checkout-attempt.test.ts` | 3 |
| `pos-checkout.test.ts` | 2 |
| `pos-payment.test.tsx` | 4 |
| **المجموع** | **9 passed** |

## 22. build

`npm run build` (Next.js 15) ناجح في جولة التنفيذ السابقة على الفرع.

## 23. Playwright

`npx playwright test e2e/pos-checkout-reliability.spec.ts --project=desktop` → **1 passed (~35s)**.

يغطي: double submit، قفل CTA أثناء التأخير، fail-once recovery، retryable مستمر، recovered success، لقطات 390/768/1440 + dark + EN. نمط console من PR #552/#557 (`KNOWN_CONSOLE_NOISE` + رفض 401/403/500).

## 24. visual QA screenshots

المسار: `docs/visual-qa/pr-559/`

| اللقطة | ماذا تُظهر |
|--------|-------------|
| `desktop-1440-ar-rtl-light-payment.png` | شاشة الدفع قبل التأكيد |
| `desktop-1440-ar-rtl-light-submitting.png` | CTA «جارٍ إتمام البيع…» مقفول |
| `desktop-1440-ar-rtl-dark-submitting.png` | نفس الحالة داكن |
| `desktop-1440-en-ltr-light-submitting.png` | EN LTR |
| `mobile-390-ar-rtl-light-submitting.png` | جوال 390 |
| `tablet-768-ar-rtl-light-submitting.png` | تابلت 768 |
| `desktop-1440-ar-rtl-light-retryable.png` | رسالة إعادة آمنة |
| `desktop-1440-ar-rtl-light-recovered-success.png` | إيصال + «تم تأكيد البيع بنجاح» |

## 25. migrations / API contract

- Migration واحدة: `pos_checkout_attempts`
- `POST /pos/checkout` يطلب `idempotency_key` (uuid)
- إنشاء جديد: **201**؛ replay: **200** + `idempotent_replay: true`؛ تعارض: **409**

## 26. accounting entries (للمراجعة)

لا قيد محاسبي جديد في مسار النجاح الأول — يبقى قيد البيع القائم من `PosService` (مدين العملاء/الصندوق حسب الوسائل، دائن الإيراد والضريبة، وتكلفة المخزون إن وُجدت كما قبل).

| الحالة | الأثر المحاسبي |
|--------|----------------|
| إنشاء جديد بنفس orchestration | قيد واحد متوازن عبر `LedgerService::post` كما كان |
| Idempotent replay | **صفر** قيود إضافية؛ تُعاد الفاتورة القائمة |
| 409 conflict | **صفر** كتابة مالية |

## 27. known limitations

- لا offline queue ولا مزامنة متعددة الأجهزة لنفس المفتاح.
- الاسترداد الواجهي يعتمد إعادة POST لا `GET` منفصل.
- `__POS_CHECKOUT_*` خاص بالمعاينة/E2E فقط.
- سلة التدقيق في الديمو ليست SoT إنتاج.
- Playwright ليس في Web CI (Vitest + `next build` فقط).

## 28. scope exclusions confirmed

لا تغيير لشكل POS (PR-6)، Interaction Modes (PR-7)، shortcuts، barcode thresholds، طرق الدفع، RBAC، أو جدول مبيعات موازٍ.

## 29. no merge / no deploy

لم يُدمج الفرع في `main`. لم يُنفَّذ أي نشر إنتاجي. PR مفتوح للمراجعة فقط.

---

## روابط

- **PR:** https://github.com/safwan5001-source/Nebrax/pull/559
- **Base:** `fdef3ac0` (#557)
- **نمط المرجع:** DeliveryNote `idempotency_key` + checksum

---

*تم إنشاء هذا التقرير آلياً بعد اكتمال تنفيذ PR-8 — Nebrax Cloud Agent.*
