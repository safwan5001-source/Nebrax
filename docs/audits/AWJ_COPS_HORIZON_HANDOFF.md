# COPS Horizon — Handoff (التسليم الحيّ)

**البرنامج:** AWJ Commerce Operations Horizon (COPS) — امتداد لـ `AWJ_STORE_COMMERCE_MASTER_HORIZON_V1` (المتتبّع §9).
**آخر تحديث:** 2026-11-01 — قرار المالك D-H1-1-P = **P-A**؛ بوابة الحمل الواقعي ناجحة (9/9 جولات، p95 إضافي 7–22ms)؛ H1-1 في PR #1910 بانتظار CI/الدمج.
**القاعدة:** يُحدَّث هذا الملف في نهاية كل شريحة (Slice) قبل التوقف. هو نقطة الاستئناف الوحيدة؛ لا يُعاد الاستكشاف.

---

## 1. التفويض الحالي

| البند | الحالة |
|---|---|
| النطاق المفوَّض | **COPS-H1 فقط (H1-0 … H1-5)** — تنفيذ ومراجعة ودمج ذاتي عند اجتياز كل البوابات |
| خارج التفويض | H2 وما بعده؛ أي نشر (Deploy)؛ أي تفعيل بوابة أو ميزة |
| القرارات المعتمدة | D-OPS-1، D-OPS-4، D-OPS-5، D-OPS-6، D-OPS-9، R-1، R-2، R-3، R-5، R-6، R-6b — مسجّلة في `ADR-29` §0 |
| القبول اليدوي | خلف `COMMERCE_ORDER_ACCEPTANCE_ENABLED` (مغلقة افتراضياً) — لا يُفعَّل |

### 1.1 جدول نقاط التوقف لتبديل النموذج (إلزامي)

| المجموعة | النموذج (يبدّله المالك يدوياً) | بعدها |
|---|---|---|
| H1-0 | Claude Opus | **STOP** ✅ (هذه النقطة) |
| H1-1 | Claude Opus | STOP |
| H1-2 ثم H1-3 | Claude Sonnet | STOP |
| H1-4 | Claude Opus | STOP |
| H1-5 + تقرير إغلاق H1 (`AWJ_COPS_H1_HORIZON_CLOSURE_REPORT.md`) | Claude Sonnet | STOP |

لا تبدأ المجموعة التالية إلا بأمر استمرار صريح جديد من المالك. نقطة التوقف لا تلغي تفويض H1.

---

## 2. الحالة

| Slice | الحالة | PR | Merge SHA | ملاحظات |
|---|---|---|---|---|
| H1-0 | **Merged** (squash، 2026-11-01) — CI أخضر على رأس الـPR؛ لم يُنشر ولم يُفعَّل شيء | #1896 | `d729fc9be46e404ed58289f75802e7eadca5d560` | توثيق فقط. رأس الفرع `59e197726b4ecf11b81a71c562388ba126410355`؛ فُرع من `6d78858d2` ثم تقدّم `main` (أب الدمج `511a19e3f`) دون تعارض. تفاصيل الفحوص في تقرير التنفيذ §3 |
| H1-1 | **Implemented · P-A approved** — بوابات الصحة + بوابة الحمل الواقعي ناجحة؛ الاندفاع تشخيص مُسجَّل | #1910 | (يُسجَّل بعد الدمج) | التقرير: `AWJ-COPS-H1-1-IMPLEMENTATION-REPORT.md` §4.1–§4.3 |
| H1-2 … H1-5 | Planned | — | — | — |

> **Implemented ≠ Merged ≠ Deployed ≠ Activated ≠ Env-Verified.** لا شيء من COPS منشور أو مُفعَّل.

---

## 3.0 (تاريخي) نقطة التوقف عند قرار D-H1-1-P — **حُسم P-A**

H1-1 على الفرع `claude/cops-h1-1-order-events-feed` (PR مفتوح غير مدموج). التنفيذ مكتمل؛ الصحة مثبتة (اكتمال/تراجع/لا جمود مع ضابط سلبي/الرأس آخر قفل مع تحقق طفري/عزل/RBAC/لا أثر مالي). **المانع الوحيد:** بوابة الأداء R-2 بتعريفها الحرفي (اندفاع مشبَع). الخيارات P-A (موصى به: تعريف حمل واقعي ≤ ~130 حدثاً/ث/مستأجر، p95 ≈ 24ms) · P-B · P-C · P-D في التقرير §5.

**بعد القرار:** على الفرع نفسه — عدّل اختبار البوابة وفق القرار المعتمد حرفياً (لا تخفيف آخر)، أعد CI (sqlite + pgsql + CI Gate)، راجع، ادمج، سجّل Merge SHA هنا وفي المتتبّع، ثم **توقف** عند نقطة تبديل النموذج قبل H1-2.

**تعديل تصميمي داخل R-2 (موثَّق في ADR-29 §2.4.1):** الرأس صف قفل ثابت لا يُحدَّث، والتسلسل `max(feed_seq)+1` بعبارة إدراج واحدة؛ الكاتب لا يلمس `tenants` (FK الحدث إلى الرأس؛ الرأس يولد مع المستأجر بمُشغّل).

## 3. (مرجع تاريخي) نقطة استئناف H1-1 كما خُطِّطت (Claude Opus)

**الهدف:** `commerce_order_events` + `commerce_order_feed_heads` + حراس قاعدة البيانات + كتابة الأحداث الأولية + بوابات التحقق على PostgreSQL. **لا** مسارات API جديدة (H1-2)، **لا** واجهة، **لا** قبول.

**المرجع الحاكم:** `docs/plans/store/ADR-29-COMMERCE-ORDER-OPERATIONS.md` §2.1 و§2.4 (العقد كاملاً)، Revision 1 §2.

**ابدأ بقراءة فقط:**
1. ADR-29 §2.4.
2. ADR-28 §1.3 (ترتيب الأقفال القائم) و§4.
3. نمط حراس السلسلة: `docs/audits/horizon/REM-18b-1-IMPLEMENTATION-REPORT.md` + هجرته (مُشغِّلات PG/SQLite: «الرأس يتقدّم +1 بمدخل مقابل»).
4. نمط حراس الإلغاء: `database/migrations/2026_12_13_010000_add_cancellation_facts_to_commerce_orders.php`.
5. نمط اختبارات التزامن: `tests/Feature/CommerceOrderCancellationPostgresTest.php`، `CommerceOnlinePaymentPostgresConcurrencyTest.php`.

**نقاط الكتابة الأولية (الأنواع الأربعة):**

| النوع | المعاملة المالكة (حيث يُفرَغ المسجِّل آخراً) | ملاحظة |
|---|---|---|
| `order.placed` | `CommerceCheckoutService::complete` (المعاملة الخارجية؛ **ليس** `createFromCheckout` لأن النية والحجز وتحديث الـcheckout تليه) | المسار القديم `CommerceOrderService::create/confirm` بلا مستهلك HTTP — يُقرَّر صراحةً (حدث أو لا) ويُوثَّق |
| `order.cancelled` | `CommerceOrderLifecycleService::cancel` (`DB::transaction` L53) — آخر عبارة قبل الالتزام، قبل تسجيل `afterCommit` للتنظيف | `data.reason` فقط (لا ملاحظة، لا فاعل خارج `actor_*`) |
| `payment.paid` | `CommerceOnlinePaymentService::completeCaptured` (`DB::transaction` L208) | **تحقق إلزامي:** له 5 مستدعين (المستمع `CompleteCommerceOnlinePayment`، المكنسة، 3 داخلية). إن كان أيٌّ منها **داخل معاملة خارجية** فقفل الرأس سيُؤخذ قبل أقفال لاحقة للمعاملة الخارجية ⇒ يكسر «الرأس آخراً». الحل المسموح: تأجيل الإفراغ إلى المالك الخارجي (المسجِّل واعٍ بمستوى المعاملة). إن تعذّر بلا تغيير سلوك ⇒ **توقف وصعّد** (شرط «افتراض تصميمي أساسي يفشل») |
| `payment.collected` | `CommercePaymentIntentService::markCollected` (`DB::transaction` L112) | تحقق مماثل من التعشيش |

**معايير القبول (من ADR-29 §2.4):** الحدث داخل معاملته (فشله يُرجعها)؛ الرأس آخر قفل في كل مسار؛ حراس PG+SQLite (إدراج متتالٍ فقط، لا UPDATE/DELETE/TRUNCATE، لا حدث لمستأجر آخر)؛ `down()` يرفض متى وُجد حدث؛ تصنيف `CompanyWide` للنموذجين في `BranchIsolationGuardTest`؛ لا PII في `data`؛ اختبارات PG الستة (تأخر الالتزام، التراجع، لا 40P01، الاكتمال، الحراس، **قياس الأداء** مع حد التصعيد p95 > 50ms إضافية تحت 20 كاتباً)؛ `php artisan test` كاملاً + أجنحة PG ذات الصلة؛ **لا** تعديل لاختبارات قائمة، لا قيد، لا حركة مخزون، استجابات الجمهور حرفياً كما هي.

**الفرع المقترح:** `claude/cops-h1-1-order-events-feed` من أحدث `origin/main`.

---

## 4. ثوابت لا تُكسر (كل الشرائح)

- ترتيب الأقفال: المحور القائم `Attempt → Intent → Order → (Fulfillment) → Reservations`؛ أقفال المسارات الأخرى بترتيبها الحالي؛ **`commerce_order_feed_heads` آخراً دائماً**.
- لا شبكة ولا مزوّد دفع تحت أي قفل؛ التنظيف والمستمعون بعد الالتزام ولا يرمون.
- لا كتابة في الأستاذ/المخزون من Commerce؛ H1 بلا أي قيد أو حركة مخزون (يُذكر في كل PR).
- لا enum جديد في `commerce_orders.status`؛ لا عمود حالة دفع/تنفيذ/تشغيل مخزَّن.
- عقود الجمهور: كتل إضافية فقط؛ اختبارات العقود القائمة بلا تعديل.
- كل سلوك جديد: افتراض يطابق اليوم أو بوابة مغلقة. لا تفعيل.
- `commerce.orders.*` لـowner/admin عبر `*` فقط؛ لا `MATRIX` ولا زرع.
- لا وعد موثوقية تنبيه خارج «الوضع المدعوم» (Revision 1 §3).

## 5. القرارات المتبقية (لا تُفترض)

قبل H2/H3/H4: R-4، R-7، R-8، R-10، R-11، R-12، D-OPS-3 (`auto_reject`)، D-OPS-4b، D-OPS-4c، D-OPS-7، D-OPS-8، D-9-A1، تفعيل الإلغاء على Beta.
محجوبة لـFPC: D-7، D-8 (+رأي ضريبي)، D-10، D-11 (+PAY-V2-6A)، D-12 + ADR-COMMS D1–D9، D-OPS-10، D-OPS-11، R-9، بدء H3-P.

## 6. خريطة القراءة

| الوثيقة | الدور |
|---|---|
| `docs/plans/store/ADR-29-COMMERCE-ORDER-OPERATIONS.md` | العقد الملزم |
| `docs/plans/store/ADR-28-COMMERCE-ORDER-LIFECYCLE.md` | الإلغاء وترتيب الأقفال (Accepted) |
| `docs/audits/AWJ_COMMERCE_OPERATIONS_H0_REVISION.md` | الخطة والاعتماديات والقرارات (يحلّ محلّ §E/§G/§H من H0) |
| `docs/audits/AWJ_COMMERCE_OPERATIONS_AUDIT.md` | الواقع المثبت (§A–§D، §F) |
| `docs/plans/store/AWJ_STORE_COMMERCE_HORIZON_TRACKER.md` §9 | حالة الشرائح |
| `docs/audits/AWJ-COPS-H1-*-IMPLEMENTATION-REPORT.md` | تقارير الشرائح |
