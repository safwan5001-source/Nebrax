# Threat Model — Intelligent Document Center

- **الحالة:** PR-13، جاهزية Stage 0 فقط
- **الملكية:** Intelligent Document Center مع حدود المنصة والتطبيقات التجارية
- **قرار التشغيل:** لا تفعيل في هذه الوثيقة أو هذا PR. تبقى شبكة المزود مقفلة والتخزين الدائم والـworker والـscanner والـscheduler غير مفعلة.

> مركز المستندات يعالج دليلاً غير موثوق قد يتحول لاحقاً إلى مسودة تشغيلية فقط. لا يملك أي مسار فيه سلطة ترحيل، دفعة، حركة مخزون، اعتماد آلي، أو إنشاء بيانات رئيسية.

## الأصول والفاعلون

| الفئة | الأصول أو الفاعلون | خاصية الحماية |
|---|---|---|
| أصول الدليل | file bytes، metadata، SHA-256، scan state، evidence المستخرج، review overlays/actions، transaction links | السرية، عدم التبديل، عدم حذف السجل عند purge، والحجب display-only. |
| أصول النطاق | tenant identity، branch context، user/platform identities، application/entitlement state، RBAC | لا يصدر أي منها من body غير موثوق؛ tenant وbranch من السياق والـidentity. |
| أصول تشغيلية | processing runs، attempts، usage، receipts، governance/workflow/source audit، retention policy/runs/holds | append-only قدر العقد، outcomes آمنة قابلة للتدقيق، ومحددات query/export. |
| أسرار وبنية | provider credentials، storage credentials، signed URLs، Redis/scanner endpoints، object key | لا تظهر في resources/errors/diagnostics/exports؛ لا تفعيل أو egress في Stage 0. |
| فاعلون موثوقون جزئياً | مستخدم tenant عادي، tenant admin، مستخدم محصور بفرع، platform administrator، support/operator | كل منهم يملك أصغر صلاحية، ولا يوجد support impersonation أو bypass. |
| فاعلون غير موثوقين | رافع خبيث، محتوى document خبيث، source connector، provider response مخترق، صاحب URL متسرب، worker مستقبلي | كل input غير موثوق؛ لا يغدو دليلاً سلطة مالية أو نطاقية. |

## حدود الثقة

| الحد | المهاجم المحتمل | الضوابط الحالية | تحقق PR-13 |
|---|---|---|---|
| Browser → API tenant | token مزور/معرف أجنبي/body spoofing | Sanctum → `SetTenant` → `SetBranch` → subscription → RBAC → commercial access. | مصفوفة IDOR tenant/branch وmass-assignment وapp/entitlement denial. |
| Browser → API platform | tenant token أو platform token بقدرة ناقصة | `EnsurePlatformAdministrator` ونطاق `platform:read`/`platform:manage` مستقل. | negative token-boundary tests. |
| API → DB | race أو direct scoped query | TenantScope، BranchScope، locks/versions/unique constraints، services المالكة. | query/bypass inventory، stale/idempotency/recovery tests. |
| API → private storage | object key/path/URL leaked أو object missing | `DocumentStorageService` وحده، profile محكوم، signed application route يعيد auth، وlocal fallback مع persistent gate false. | download/header/unavailable/purge recovery tests. |
| Queue → worker | worker متسرب context أو duplicate job | trusted IDs فقط، context set/clear في `finally`، run idempotency وحالة مقيدة. | fail-closed/runtime-zero-egress/retry tests؛ العامل غير مشغّل في Stage 0. |
| Worker → scanner/provider | egress أو محتوى خبيث أو SSRF | scan clean، configured registry/fixed endpoint، provider network gate. | fake HTTP assert صفر request عند gate=false؛ activation prerequisite منفصل. |
| Connector → intake | source يختار tenant/branch/replays | resolved identity فقط، metadata allowlist، receipt uniqueness، `web` internal و`api` مرفوض. | replay/conflict/identity masking/isolation tests. |
| Platform admin → settings | تسريب secret أو تفعيل خفي | encrypted settings، masked output، audit paths فقط، gate code مستقل. | secret/output/no-activation assertions؛ لا تغيير إعدادات production. |

## مصفوفة التهديدات

| التهديد | مسار الهجوم | الضابط القائم | تحصين/اختبار PR-13 | الخطر المتبقي وشرط Activation |
|---|---|---|---|---|
| cross-tenant access | token A يطلب batch/file/run/hold B | TenantScope و`SetTenant` ومسارات resource binding المقيدة | matrix لكل read/write/download/retry/review/export/diagnostics؛ لا leak ولا event B | يخفض إلى bug تطبيق؛ راقب بعد أي route جديد. |
| cross-branch access | header/ID من A1 ضد A2 | `SetBranch` يتحقق tenant+membership؛ BranchScope | malformed header وA1→A2 وheader fallback tests | مشاركة الفروع سياسة قائمة يجب اختبارها عند تعديلها. |
| IDOR | UUID صالح خارج scope | bindings بعد middleware scoped queries | negative IDs عبر جميع surfaces الحساسة | كل endpoint جديد يحتاج classification قبل merge. |
| mass assignment | body يرسل tenant/branch/status/provider/key/actor/amount | Form Requests وservices تتجاهل مصدر النطاق وتعيد حساب الحقائق | spoofing negative tests لمسارات intake/review/build/governance | مراجعة كل `fillable` أو request جديد. |
| authorization drift | UI تخفي زر وAPI يسمح | RBAC وcommercial access في route | permission/entitlement/app disabled/suspended matrix | تغييرات catalog/RBAC تحتاج regression. |
| platform-token reuse | token tenant يصل `/platform` أو العكس | principal type + token ability | token boundary tests | protect future platform routes بنفس middleware. |
| signed URL abuse | URL متسرب أو يعاد استخدامه لمورد آخر | TTL 1–15 دقيقة، signed route + auth/scope/RBAC/entitlement، file ID واحد | TTL/foreign/clean/purged/header tests | revoke-at-rest ليس بديلاً عن تغيير بيانات اعتماد مسربة. |
| object key/secret leak | diagnostics/export/error/log يعيد key/credential/raw payload | allowlist resources وsafe messages، encryption for settings | safe-output/log/static scan وCSV regression | production log sink/config review قبل activation. |
| poisoned upload/MIME spoof | .pdf زائف أو image مضخم أو filename path | inspector magic bytes، size/page/pixel limits، server object key | upload mismatch/zero/size/page/image/filename tests | antivirus is activation prerequisite، وليس مفعلاً هنا. |
| zip/decompression/PDF exhaustion | archive/PDF pathological | no archive acceptance؛ bounded PDF/image inspector | malformed/limit tests | sandboxing scanner/parser prerequisite عند أحمال production. |
| prompt injection | text داخل document يوجّه extraction | input evidence فقط، normalization، no financial authority | assert gate locked/no provider request؛ untrusted rendering tests | provider prompt/data policy منفصلة عند activation. |
| provider response poisoning | response يصنع master data/posting/raw data | normalized evidence، review required، no posting boundary | malformed result and no-financial-effect regression | provider contract/legal approval قبل enable. |
| provider egress | retry/test/worker calls network when locked | `DocumentProviderNetworkGate` false | Fake HTTP صفر external request لكل path | تغيير gate يحتاج PR وموافقة منفصلين. |
| SSRF | custom provider/storage endpoint | provider registry رسمي بلا custom URL؛ storage profile محكوم | configuration/host static assertions | endpoint review عند أي provider/storage activation. |
| XSS/UI injection | extracted field/filename يحتوي HTML أو bidi control | React text rendering وsafe resources | source scan + UI/E2E strings؛ لا `dangerouslySetInnerHTML` في surfaces | أي rich rendering يحتاج sanitizer مخصصاً. |
| CSV injection | قيمة تبدأ =/+/-/@ | `SpreadsheetWriter` BOM وescaping | all-prefix/newline/comma/quote/Arabic tests | مستخدم spreadsheet يبقى مسؤولاً عن macros محلية. |
| audit tampering | تعديل/حذف workflow/governance/review/source/link | append-only models/FKs والخدمات المالكة | mutation/FK rehearsal tests | retention للـaudit قانوني policy لاحق. |
| redaction bypass | current/original/history/export/diagnostics يعيد قيمة | overlay allowlist display-only، history masking | response/export/diagnostics/list tests مع evidence truth unchanged | domain builder يرى truth عمداً؛ وصوله محصور بالـservice. |
| premature retention purge | link/hold/not-due/active file يحذف | planner policy deadline، holds/links/clean/workflow gates، pending state | full planner/recovery/cursor/repeated apply tests | legal retention policy/approval خارج Stage 0. |
| purge/storage inconsistency | object حذف وDB rollback أو storage fails | durable `purge_pending` ثم reconciliation/failure outcome | pending exists/missing/failure/retry tests | تشغيل storage دائم ومراقبة activation prerequisite. |
| retry storm/queue duplicate | double click/active run/worker retry | unique run state، lock، max attempts، runtime checks | double retry/active/failure rollback tests | queue topology/backoff/DLQ activation prerequisite. |
| stale review/race | مراجعان يحرران أو يكملان | row locks + expected version + append-only action | stale and concurrent command tests | load/worker contention becomes pilot concern. |
| duplicate drafts | build مرتين أو source reused | idempotency/link uniqueness/services | purchase/expense/delivery-note replay tests وzero-financial checks | correction/unlink policy يحتاج ADR منفصل. |
| worker context leakage | job B يرث context A | set trusted contexts then clear `finally` | job/failure context cleanup test | worker absent في Stage 0؛ verify again before worker enable. |
| unsafe filename/header | control chars أو MIME browser-sniff | stream download with trusted detected MIME + nosniff/cache controls | filename sanitization and header tests | inspect framework content-disposition upgrades on dependency changes. |
| app/entitlement bypass | direct API while nav hidden | server middleware commercial decision | nav truth + API denied tests | catalog/state changes require coverage. |
| public inbound API | caller injects external source | no route; `api` connector rejects | route/config static assertion and channel contract tests | needs separate credential/rate-limit/rotation architecture. |

## Stage 0 acceptance

Stage 0 means the code, docs, migrations and local test contracts are ready to be reviewed, not that a provider, object store, queue worker, scanner, scheduler, webhook or production tenant is live. The following remain explicit activation prerequisites: legal DPA/data residency; approved provider; credentials and rotation; persistent private storage and recovery; Redis `noeviction`; worker lifecycle; scanner endpoint; production observability/backups; controlled pilot entitlement/application enablement; and a separately reviewed network-gate change.

## Audit ownership and reassessment

Any new Document Center route, model, exporter, connector, worker, provider, or builder must update the Authorization Matrix and this document. `withoutGlobalScopes`, `withoutGlobalScope`, and direct `DB::table` uses are prohibited unless they are documented with a narrow trusted-boundary rationale, explicit re-scoping before projection/write, and tests. The PR-13 final report records the current list and the residual risks without claiming activation.
