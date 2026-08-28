# POS Loss Prevention v1.0 — Production Hardening Audit

> أُنجز هذا التدقيق على أحدث `main` (`cc1bbe7f`، بعد دمج PR #546 Phase 4 وPR #547 Touch UX)
> **قبل** أي إصلاح. المرجع: مهمة Production Hardening. المستودع هو مصدر الحقيقة.
>
> **مؤشرات الرقابة والاستثناءات تساعد في ترتيب المراجعة والتحقيق ولا تثبت وحدها وجود مخالفة.**

## منهج التصنيف

| Severity | المعنى |
|---|---|
| P0 Critical | ثغرة سلامة دليل/اعتماد قابلة للاستغلال الآن |
| P1 High | عزل/تكرار/عقد إنتاجي مكسور يؤثر الثقة التشغيلية |
| P2 Medium | جاهزية إنتاج مباشرة (فهرس، N+1، UX حرج) |
| P3 Low | دفاع إضافي / تنظيف داخل ملف متأثر |
| Deferred | شرط معماري ناقص أو خارج نطاق Phase 1–4 |

## مصفوفة التدقيق

| Area | Current implementation | Risk | Existing coverage | Gap | Action | Severity |
|---|---|---|---|---|---|---|
| Append-only (PosSessionEvent / reviews / case activities / notes) | Model `updating`/`deleting` throw `LogicException` | Bypass عبر query-builder bulk لا يمرّ بأحداث Eloquent | Instance-path tested (Phase 1/3) | لا حماية DB-level؛ لا مسار HTTP حذف حالياً | توثيق + اختبار مسار instance؛ DB triggers مؤجّل | P3 / Deferred (DB) |
| Provenance | `payload.provenance` + actor/session/cart/tenant/branch على الأحداث | ملء حدسي ممنوع؛ إشارات صامتة عند غياب linkage | Phase 4 silence tests | لا فجوة منتج | لا إصلاح | — |
| Idempotency (`client_event_id`) | Unique `(tenant_id, client_event_id)` + select-then-insert | سباق متزامن → `QueryException` → 500 بدل إعادة السجل الأصلي | Sequential replay/conflict tested | لا catch على unique violation | Fix: catch + re-select | **P1** |
| Retries / replay (approvals consume) | `consumeApprovalIfNeeded` يستخدم `lockForUpdate` لكن بدون `DB::transaction` داخلي | `CashDrawerService::openManually` يستدعيه بلا معاملة خارجية → القفل يُحرَّر فوراً → استهلاك مزدوج ممكن | `denied` فقط لـ manual_drawer؛ لا اختبار consume مزدوج | Transaction boundary غير متسق | Fix: لفّ الاستهلاك في `DB::transaction` داخل الخدمة | **P0** |
| Approvals lifecycle | pending→approved→consumed؛ SoD performer≠approver؛ variance SoD اختياري | Replay بعد consume يجب أن يفشل | Approve/deny/SoD tested | فجوة drawer أعلاه | مشمول بـ P0 | — |
| Refund linkage / cross-cashier | `ReturnService` يكتب دليل عابر للكاشير؛ إشارة صامتة إن غاب actor | False positive ممنوع | Phase 4 silence + fire tests | Concurrent over-refund في `ReturnService::post` (محاسبي سابق لـ LP) | Deferred خارج LP — لا rewrite محاسبي | Deferred |
| Drawer / cash movements | Gates على `manual_drawer_open`/`cash_out` عبر `enforceOperationPolicy` | انظر P0 | Denied policy tested | approval_required end-to-end لـ drawer ناقص | Fix + regression | **P0** |
| Holds / discards | `repeated_hold_discard` من أحداث خادمية | — | Phase 4 rule tests | لا فجوة | — | — |
| Checkout linkage | checkout events server-authoritative | — | Phase 1 tests | لا فجوة | — | — |
| Exceptions / scoring / baselines | `dedup_key` includes rule version؛ baselines milli-rate | بعد رفع `version` تبقى استثناءات الإصدار القديم مفتوحة في Needs Attention | Sequential rerun idempotent | طابور الانتباه يعرض نسختين لنفس الإشارة | Fix: صفِّ الطابور على الإصدار الحالي للقاعدة | **P1** |
| Review workflow | Append-only `PosExceptionReview` | — | Phase 2 tests | لا فجوة | — | — |
| Cases / evidence links | Tenant check فقط عند الربط؛ `withoutGlobalScope(BranchScope)` | مستخدم مقيّد بفرع يربط دليل فرع آخر ويقرأه عبر timeline | Cross-tenant link rejected | لا فحص `canAccessBranch` على الدليل المربوط | Fix: رفض ربط دليل خارج فروع الممثل | **P1** |
| Notes / activities | Append-only Eloquent | cascadeOnDelete على `case_id` يمحو السجل عند حذف خام للقضية | لا HTTP delete | Landmine صيانة | Fix: `restrictOnDelete` في migration إضافية | **P2** |
| Digest | Half-open + tenant TZ؛ idempotent per tenant/date | — | Boundary + isolation tested | لا فجوة حرجة | — | — |
| Needs Attention | تجميع بالإشارة من 5 مصادر؛ ترتيب urgency ثم sort_at | تكرار إصدارات قديمة (أعلاه)؛ واجهة: hint «للقراءة فقط» مع زر اعتماد | Isolation + pagination tested | تلميح متناقض + mobile cards ناقصة | Fix تلميح + mobile | **P1** (hint) / **P2** (mobile) |
| Settings / SoD | Backend `PosSettings::lossPreventionGroup` + policies | UI-only ممنوع | SoD on/off tested | لا فجوة backend | — | — |
| Exports | Authenticated + permission | — | Export permission tested | CSV injection غير مختبر صراحة | Test-only إن لزم | P3 |
| RBAC | Permissions دقيقة view/review/export/settings/investigations.* | — | Extensive Phase 3/4 | assign owner_id cross-tenant بلا اختبار مخصّص | Test-only | P3 |
| Tenant isolation | `BaseModel` + TenantScope دائماً | — | Strong coverage | لا فجوة | — | — |
| Branch isolation (reads) | `scopeToActiveBranch` + digest redact | — | Strong coverage | Write-side link gap = P1 أعلاه | — | — |
| User ownership validation | `assertUserInTenant` على create/assign | — | create tested | assign/promote owner test ناقص | Test-only | P3 |
| Transaction boundaries | معظم المسارات داخل `DB::transaction` | Drawer consume خارج معاملة | — | P0 أعلاه | Fix | **P0** |
| Concurrency | Unique constraints موجودة | Check-then-insert races → 500 | Sequential only | Catch unique + approval txn | Fix | **P1** |
| Timezones | Tenant TZ للـ digest وoutside hours | — | Midnight/overnight tested | لا فجوة | — | — |
| Pagination / filtering | per_page capped؛ Needs Attention in-memory page | — | Basic | لا فهرس `performed_by` للكشف | Migration index | **P2** |
| Query / index health | Indexes على tenant+branch+created_at / type / cart / client_event_id | Detection `aggregate()` يفلتر بـ performed_by دون فهرس مغطّي | لا اختبار أداء | فهرس ناقص | Add index | **P2** |
| UI states | Attention/Exceptions/Cases/Relationships جيدة؛ Risk/Rules toast-only؛ detail dialogs فارغة عند الخطأ | مشغّل يظن القائمة فارغة | Phase 4 e2e بصري محدود | error+retry ناقص في Risk/Rules/details | Fix محدود | **P2** |
| Mobile | DataTable→cards؛ Needs Attention لا يملأ status/amount | فقدان معلومات رقابية على الجوال | لقطة Phase 4 تؤكد | ملء MobileRecord | Fix | **P2** |
| RTL/LTR / AR/EN / light/dark | مفاتيح LP مكتملة؛ صياغة محايدة عامة | hint attention يناقض زر الاعتماد؛ digest badge tone=negative | Phase 4 visual | عدّل hint/tone | Fix | **P1**/P3 |
| Accessibility | أزرار جوال خام بلا type/focus-visible | تركيز ضعيف | لا axe | type=button + focus ring | Fix صغير | **P2** |
| Float money in UI | `case-detail` يضرب `Number * 100` | كسر قاعدة الهللات في العرض/الإدخال | — | أصلح إلى مسار هللة صريح | Fix | **P2** |

## Findings مصنّفة للتنفيذ

### P0 — يُصلح فوراً

1. **`consumeApprovalIfNeeded` بدون معاملة داخلية** → استهلاك اعتماد `manual_drawer_open` قابل للتكرار تحت تزامن/إعادة محاولة. الإصلاح داخل `PosAuditService` حتى لا يعتمد على المستدعي.

### P1 — يُصلح

2. **ربط دليل قضية عبر الفروع** لمستخدم مقيّد بفرع (link-exception / link-event / promote).  
3. **سباق idempotency** → 500 بدل إعادة الصف الفائز.  
4. **Needs Attention يعرض استثناءات إصدار قاعدة قديم** بعد `updateRule` bump.  
5. **تلميح Needs Attention «للقراءة فقط»** بينما صف الاعتماد ينفّذ موافقة — تصحيح صياغة.

### P2 — جاهزية إنتاج

6. فهرس `(tenant_id, performed_by, type, created_at)` على `pos_session_events`.  
7. `restrictOnDelete` بدل `cascadeOnDelete` لسجلات قضية التحقيق الحساسة.  
8. واجهة: error/retry في Risk/Rules؛ حوارات التفاصيل عند الفشل؛ mobile cards لـ Needs Attention؛ `type="button"`؛ إصلاح ضرب float في case-detail.

### P3 / Deferred (لا توسّع PR)

- DB triggers لـ append-only → Deferred (PostgreSQL role/trigger خارج نطاق v1 hardening البسيط).  
- Concurrent over-refund في `ReturnService::post` → Deferred (محاسبي سابق؛ ليس defect من تغييرات LP).  
- Offline sync / server cart engine / branch working_hours / CCTV video / AI → Deferred معماري صريح من Phase 4.  
- `tenant_id` في `$fillable` لـ `PosSessionEvent` → P3 تنظيف اختياري إن لُمِس الملف.  
- اختبار assign owner cross-tenant → يُضاف ضمن مصفوفة hardening tests.

## قرار النطاق لهذه الجولة

| يُنفَّذ | لا يُنفَّذ |
|---|---|
| P0 + P1 أعلاه | Phase 5 alerts/automation |
| P2 indexes / FK restrict / UI defects المحدودة | Rewrite محاسبي / ReturnService concurrency |
| اختبارات انحدار hardening | Offline / server cart / CCTV video |
| Visual QA + وثائق الإغلاق | AI / scoring احتمالي جديد |

## Accounting impact (متوقع)

لا قيد محاسبي من hardening. أي تغيّر في `journal_*` يُعدّ انتهاك نطاق.
