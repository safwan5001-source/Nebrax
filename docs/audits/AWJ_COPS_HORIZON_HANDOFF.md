# COPS Horizon — Handoff (التسليم الحيّ)

**البرنامج:** AWJ Commerce Operations Horizon (COPS) — امتداد لـ `AWJ_STORE_COMMERCE_MASTER_HORIZON_V1` (المتتبّع §9).
**آخر تحديث:** 2026-11-02 — **H1-2 مدموج:** #1924 ⇒ `790eff709e8c6ba673d30c0739a5eba3cc5e2dfe` (أحداث نطاق بعد الالتزام + `feed` + `attention`). H1-1 مغلق (#1910/#1920/#1917). **H1-3 قيد التنفيذ** (تفويض المالك الذاتي لـH1-2/H1-3 فقط؛ يتوقف بعد H1-3 — لا H1-4 ولا H1-5).
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
| H1-0 | Claude Opus | STOP ✅ |
| H1-1 | Claude Opus | **STOP** ✅ (هذه النقطة — مغلق بالكامل) |
| H1-2 ثم H1-3 | Claude Sonnet | STOP (مفوَّضتان ذاتياً 2026-11-02؛ H1-2 ✅ مدموج، H1-3 قيد التنفيذ) |
| H1-4 | Claude Opus | STOP |
| H1-5 + تقرير إغلاق H1 (`AWJ_COPS_H1_HORIZON_CLOSURE_REPORT.md`) | Claude Sonnet | STOP |

لا تبدأ المجموعة التالية إلا بأمر استمرار صريح جديد من المالك. نقطة التوقف لا تلغي تفويض H1.

---

## 2. الحالة

| Slice | الحالة | PR | Merge SHA | ملاحظات |
|---|---|---|---|---|
| H1-0 | **Merged** (squash، 2026-11-01) — CI أخضر على رأس الـPR؛ لم يُنشر ولم يُفعَّل شيء | #1896 | `d729fc9be46e404ed58289f75802e7eadca5d560` | توثيق فقط. رأس الفرع `59e197726b4ecf11b81a71c562388ba126410355`؛ فُرع من `6d78858d2` ثم تقدّم `main` (أب الدمج `511a19e3f`) دون تعارض. تفاصيل الفحوص في تقرير التنفيذ §3 |
| H1-1 | **Merged** (squash، 2026-11-01) — نجح CI على رأس الـPR `4da6f14`، **لكن بوابة الأداء فشلت لاحقاً على `main` (استقرار القياس لا الصحة)** وعولجت في #1920؛ لم يُنشر ولم يُفعَّل شيء | #1910 | `46774c5c2c2aadc8d173017990b206ef6d877d17` | قرار P-A؛ مقاييس CI وأدلة الوقود في التقرير §8 |
| H1-1 CI recovery | **Merged** (squash، 2026-11-02) — وظيفة `pg-perf` مخصصة + قياس نافذة النشاط؛ 5 تشغيلات مستقلة ناجحة | #1920 | `125abcab70293f4e1b1677a9185ff6ab53575c61` | قرار المالك: Option B + تصحيحات القياس (D-H1-1-PERF-B)؛ `AWJ-COPS-H1-1-CI-PERF-ISOLATION-RECOVERY-REPORT.md` |
| H1-1 closing records | **Merged** — راجع `AWJ-COPS-H1-1-CLOSURE-REPORT.md` | #1917 | `134244ba5fef7253fd043aa21d85b666bd3fedcb` | وثائق فقط |
| H1-2 | **Merged** (squash، 2026-11-02) — SQLite وPostgreSQL والوظيفة المخصصة للأداء وCI Gate خضراء على الرأس `66a2952`؛ لم يُنشر ولم يُفعَّل شيء | #1924 | `790eff709e8c6ba673d30c0739a5eba3cc5e2dfe` | `AWJ-COPS-H1-2-IMPLEMENTATION-REPORT.md`؛ فشلت وظيفة الأداء مرة واحدة على الرأس الأول `b75bb99` (جولة واحدة 88.6ms من 3، توقف تخزين منعزل لا صلة له بالتغيير) ثم نجحت على الرأس التالي بلا تغيير في الحد أو الحمل؛ أُضيف تسجيل تشخيصي فقط |
| H1-3 | **قيد التنفيذ** (تفويض المالك 2026-11-02) | — | (يُسجَّل بعد الدمج) | `commerce_channel_operation_settings` (القبول والتذكير والتصعيد فقط) |
| H1-4 … H1-5 | Planned — **غير مفوَّضتين في هذه الجولة** | — | — | — |

> **Implemented ≠ Merged ≠ Deployed ≠ Activated ≠ Env-Verified.** لا شيء من COPS منشور أو مُفعَّل.

---

## 3.A نقطة الاستئناف الحالية — H1-3 (قيد التنفيذ ضمن تفويض 2026-11-02)

**الحالة:** H1-2 مدموج (`790eff709`). H1-3 يُنفَّذ في الجلسة نفسها على `claude/cops-h1-3-operations-settings`؛ بعد دمجه وتسجيل سجلات إغلاقه **يتوقف التنفيذ** (المالك يبدّل النموذج إلى Opus لـH1-4).

**ما أنتجه H1-2 للشرائح القادمة:**
- أحداث النطاق `CommerceOrderPlaced`/`Cancelled`/`PaymentPaid`/`PaymentCollected` (معرّفات فقط) تُطلق من `CommerceOrderEventRecorder::append()` بعد الالتزام؛ **نوع سجل جديد (مثل `order.accepted` في H1-4) يتطلب حدث نطاق مقابلاً** وإلا فشل `CommerceOrderFeedTest`. المستمعون (H3) **لا يرمون**.
- `GET commerce/orders/feed` (مؤشّر `after_seq`) و`GET commerce/orders/attention` (الأسباب في `CommerceOrderAttentionQuery::reasonsFor()`؛ H1-4 يضيف `awaiting_acceptance`، H2 `fulfillment_not_started`، H3-4 الإقرار). السبب الأساسي `new_order` ونافذة 48 ساعة تفسير موثَّق في ADR-29 §2.4.2 **ينتظر تأكيد المالك**.
- أي مسار Commerce جديد يلزمه سطر في `CommerceModuleBoundaryTest::ALLOWED_COMMERCE_API_ROUTES`.

**ثوابت لا تُكسر:** الرأس صف قفل ثابت لا يُحدَّث؛ `max+1` بعبارة واحدة؛ الكاتب لا يلمس `tenants`؛ الرأس آخر قفل؛ القراءة بلا أقفال؛ بوابة الأداء المخصصة (§3.B).

**الفرع:** `claude/cops-h1-3-operations-settings` من أحدث `origin/main`.

## 3.B قاعدة بوابة الأداء في CI (تسري على كل شريحة COPS قادمة)

- **اختبارات الأداء/الكمون لا تعمل في الجناح المتوازي.** وسِمها `#[Group('cops-h1-1-perf')]` (أو مجموعة أداء موثَّقة جديدة) وابدأ الاختبار بـ`isolateFromParallelWorkers()`؛ تتخطّى نفسها داخل عمّال ParaTest وتعمل في وظيفة CI **`PostgreSQL feed-lock performance (COPS-H1-1)`** (`pg-perf`، مشغّل خاص، فحص مطلوب `always` في CI Gate).
- **سجِّل قبل أن تؤكّد** (`recordMetrics` ثم التأكيدات)، وافصل **إنتاجية نافذة النشاط** عن **إنتاجية الجولة الكلية** (تشمل تفرّع العمليات ≈1s على مشغّل بأربع vCPU)، وأعلن أي إحماء كجولة مسجَّلة ومستبعدة. لا ترفع الحد 50ms ولا تخفّف الحمل ولا تحوّل البوابة إلى advisory بلا موافقة صريحة من المالك.
- **لا تدفع commit إلى PR بينما تشغيل تحتاجه جارٍ** (concurrency يلغي runs الـPR عند push)؛ للحصول على تشغيلات مستقلة إضافية استعمل `workflow_dispatch` على الفرع.
- **أي PR يضيف فحصاً مطلوباً** يلزمه سطر في `.github/ci-gate/required-checks.json` وتحديث تثبيتات `scripts/ci-gate/test_ci_gate.py`؛ وخطوات تجميع `pg-perf` يحرس تطابقها مع `test` الاختبار `scripts/ci-gate/test_perf_job_parity.py`. شغّل محلياً `scripts/ci-gate` و`scripts/ci-watchdog` و`scripts/ci-perf` قبل دفع أي تعديل على `ci.yml` (فاتني `ci-watchdog` مرة).
- **خطر معلن:** توقفات عشوائية لـfsync/القرص (≈2.8% من الجولات محلياً: 124ms و170ms) قد تُفشل جولة؛ لم تظهر في 15/15 جولة CI. التكرار ⇒ توقّف وصعّد بالقياسات.

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
