# AWJ Horizon Autonomy V2-0B — GitHub Governance & Parallel Horizons Audit

**التاريخ:** 2026-10-11 (≈20:00 UTC) · **النوع:** بحث وتدقيق وتوثيق فقط (read-only) · **الحالة:** تقرير للمراجعة — لا يمنح أي صلاحية دمج ولا يفعّل V2.

| الحقل | القيمة |
|---|---|
| Base (main) SHA | `981663adf7bbb8d3a5a44a092839b35e28ad107c` (#1326) |
| هذا الفرع | `docs/awj-horizon-v2-0b-governance-audit` |
| PR | يُدرج في وصف الـPR (يُنشأ بعد الدفع) |
| PR #1327 (المرجع) | head `25482b4d64b74bc51099e79b3b5b00437a07ee1f`، base `e0e5160` (متأخر بـ commit واحد عن main) — **لم يُعدَّل** |
| Head SHA لهذا العمل | commit هذا التقرير على الفرع أعلاه |

> **لماذا فرع مستقل لا فرع #1327؟** آخر commit على `docs/awj-horizon-autonomy-v2-proposal` كان `19:55:17Z`، وقت الفحص `20:00:16Z` (5 دقائق)، وكل الـcommits والـPRs تحت حساب GitHub واحد (`safwan5001-source`) فلا يمكن إثبات خلوّ الفرع من جلسة عاملة. وفق قاعدة المهمة لا يُعدَّل. تصحيحات V2-0 مذكورة في §9 لتُدمج في #1327 من مالك الفرع.

---

## 1. الخلاصة التنفيذية

1. **`main` غير محمي إطلاقاً (مُثبَت):** لا Branch Protection ولا Rulesets. لا Required checks، لا Required reviews، لا منع للدفع المباشر أو force-push. الحماية اليوم = نص البروتوكول فقط.
2. **الدمج الذاتي غير آمن تقنياً الآن:** أداة الدمج متاحة للوكلاء وrepo يسمح بالمراجعة الذاتية بحكم أن الجميع حساب واحد. أي "إذن" لا يُنفَّذ بآلية GitHub بل بانضباط الوكيل.
3. **هوية واحدة:** كل الـ16 PR المفتوحة (والـ4 commits في #1327) باسم `safwan5001-source`. لا فصل بين المالك والوكلاء، ولا يمكن لـGitHub فرض "مراجع مستقل".
4. **الـCI لا يصلح كـRequired check كما هو:** `web-ci`/`storefront-ci`/`mobile-ci` مقيّدة بـ`paths` (لا تُبلَّغ حين لا تنطبق → تعلّق الدمج للأبد إن أُلزمت)، ولا يوجد `merge_group` في أي workflow.
5. **تعارض سلطة الدمج مؤكد:** `00-START-HERE.md:66` و`AUTONOMOUS-ENGINEERING-PROTOCOL.md:186` = تفويض دائم بعد البوابات؛ `CURRENT-STATE.md` وطابور TAX وAWJ-PLATFORM-UX-H1 = موافقة لكل PR.
6. **عبارة "TAX هو الأفق النشط الوحيد" تتعارض مع نشاط main الفعلي في اليوم نفسه** (Media Storage، CUST-HV، Platform UX H1 دُمجت/فُتحت بعد #1324). تُقرأ على الأرجح كنطاق Delivery↔TAX فقط — **قرار مالك مطلوب** (§8).
7. **التوصية:** مسار تدريجي بلا بنية تحتية جديدة: (أ) سجلّ آفاق مُدار بالمستودع كـ"تقرير" فقط → (ب) ملكية بـfencing عبر `expected head SHA` + حماية main → (ج) هوية Bot مستقلة + Ruleset → (د) فقط بعدها منح دمج محصور لـZone A. لا Lease/Lock أمام منصة تدعم CAS فقط عبر Git/PR (§6).

---

## 2. منهج الأدلة وحدودها

أدوات القراءة: GitHub MCP (PRs، فروع، ملفات) + `gh api` عبر وكيل الجلسة (REST للقراءة فقط) + قراءة المستودع محلياً عند `981663a` + توثيق GitHub/Claude Code الرسمي + Kleppmann للـfencing. **لم تُنفَّذ أي كتابة على إعدادات GitHub، ولا دمج، ولا auto-merge، ولا نشر.**

| مصدر | النتيجة |
|---|---|
| `GET /repos/…/rulesets?includes_parents=true` | `[]` (قراءة ناجحة) |
| `GET /repos/…/rules/branches/main` | `[]` (قراءة ناجحة) |
| `GET /repos/…/branches/main` | `protected:false`، `protection.enabled:false`، `required_status_checks.checks=[]`، `enforcement_level:"off"` |
| `GET /repos/…/branches/main/protection` | **403** `Resource not accessible by integration` → التفاصيل غير مقروءة |
| `GET /repos/…` | `owner.type:"User"`، public، `allow_auto_merge:false`، merge/squash/rebase كلها مسموحة، `delete_branch_on_merge:false`، `allow_update_branch:false` |
| `GET /repos/…/actions/permissions`، `…/collaborators` | **403 من وكيل الجلسة** (مسار غير مسموح) → غير مقروء |
| Merge Queue / App installations / Environments / Secrets / Fork-PR approval settings | **غير مقروءة** من هذه الجلسة |

**درجات الثقة:** "لا Rulesets" = عالية (قراءتان ناجحتان فارغتان). "لا Classic protection" = متوسطة-عالية (علم `protected:false` + `enforcement_level:off`؛ التفاصيل 403، وغياب القراءة ليس إثباتاً بالسلب بذاته لكن العلمين متسقان). علم `permissions.admin:true` في استجابة الـrepo يخص هوية المالك لا الجلسة، ولا يُبنى عليه شيء.

---

## 3. تدقيق حوكمة GitHub

| # | البند | الحالة | الدليل | الخطر |
|---|---|---|---|---|
| G1 | Branch protection / Rulesets على `main` | **غير موجودة** | §2 | حرج |
| G2 | Required status checks | **لا شيء** | `checks=[]` | حرج |
| G3 | Required reviews / code-owner review | **لا شيء** (CODEOWNERS: `* @safwan5001-source` موجود لكنه بلا أثر دون "Require review from Code Owners") | `CODEOWNERS` | عالٍ |
| G4 | منع تجاوز CI والمراجعة | غير ممكن — لا قاعدة تُتجاوز أصلاً. التوثيق: المدراء يتجاوزون Branch Protection افتراضياً إلا بتفعيل "Do not allow bypassing"، وقوائم Bypass تُضبط للمنظمات فقط | docs.github.com about-protected-branches | عالٍ |
| G5 | Merge Queue | **غير مقروء**. صفحة التوثيق المجلوبة لا تحدد توفره لحسابات المستخدمين؛ والـrepo `User`-owned. **غير مُتحقَّق منه** — يُتحقق من واجهة الإعدادات قبل أي تصميم يعتمد عليه. لا `merge_group` في أي workflow (grep = 0) فلن يعمل أصلاً دون تعديل CI | docs + grep | متوسط |
| G6 | Auto-merge | معطّل على الـrepo (`allow_auto_merge:false`) لكن أداة `enable_pr_auto_merge` ظاهرة للجلسات. التوثيق: يتطلب تفعيل الإعداد **وقاعدة حماية** كي يعني شيئاً | `gh api`, docs | منخفض الآن |
| G7 | صلاحيات الجلسة | مقيّدة بالـrepo عبر وكيل (يرفض Actions/collaborators) — جيد كحد أدنى، لكن أدوات الدمج والكتابة على الفروع متاحة. التوثيق: الاعتمادات تبقى خارج الـVM والوكيل يلصقها | docs code.claude.com | متوسط |
| G8 | هوية الوكلاء | حساب واحد لكل شيء | قائمة PRs | عالٍ |
| G9 | CI قابل للإلزام؟ | جزئياً: `ci.yml` يعمل على كل push/PR لكل الفروع (اسما المهمتين `php artisan test (L11, sqlite|pgsql)` صالحان). الباقي path-filtered فلا يُلزَم دون إعادة تصميم (workflow مجمّع دائماً يبلّغ) | `.github/workflows/*` | عالٍ |
| G10 | حالة CI على main نفسه | عند الفحص: المهمتان `queued` على `981663a` — **غير مُتحقَّق من أنها خضراء** | `check-runs` | معلومة |
| G11 | `main` وحوكمة الفروع | 100+ فرع، كلها `protected:false`، كثير منها قديم؛ لا تسمية/تنظيف | `list_branches` | منخفض |

**هل يمكن تطبيق دمج ذاتي آمن دون صلاحيات واسعة؟** ليس اليوم. الشروط الدنيا (لم تُطبَّق، توصية فقط): Ruleset على `main` يلزم ① PR ② فحصَي `php artisan test` ③ حظر force-push/الحذف ④ "Do not allow bypassing"؛ هوية Bot مستقلة بصلاحية PR/contents على فروعها فقط (GitHub App بحد أدنى من الصلاحيات)؛ وأن يكون الدمج بـ`sha` = head المُراجَع (يعيد 409 عند عدم التطابق، موثّق). تفاصيل §6–7.

---

## 4. جرد الآفاق المتوازية

> **قاعدة:** PR مفتوح ≠ Agent يعمل. "نشط موثّق" = وثيقة حالة تنص عليه، ولا يعني جلسة حية. لا يوجد في أي مكان دليل على جلسة حية بذاتها (§2).

| الأفق | التصنيف | الدليل | PR/فرع ذو صلة | ملاحظات |
|---|---|---|---|---|
| **TAX-ZATCA** | **نشط موثّق** (لا جلسة مُثبتة) | `CURRENT-STATE.md`: الأفق النشط الوحيد بعد #1324؛ المهمة الأولى TAX-HZ-00 قراءة فقط ومحكومة بقرار مالك؛ دمج كل PR بموافقة صريحة. آخر دمج TAX: #1320 | لا PR TAX مفتوح. فروع: `audit/awj-tax-zatca-audit-1`، `claude/awj-tax-rem-02-*`، `codex/zatca-*` (تاريخية)، `#586` (PR قديم 08-30: signed invoice QR) | #586 قديم جداً ويتقاطع دلالياً مع ZATCA م2 → يُراجع/يُغلق بقرار مالك |
| **Delivery Platforms & Settlement** | **متوقف (موثّق صراحةً)** | `CURRENT-STATE.md`: PAUSED بقرار 2026-10-11؛ آخر لقطة 2026-10-04؛ حالة DLV-FINANCIAL-ROLE-CONFIG-1 يجب إعادة التحقق منها عند الاستئناف | لا PR مفتوح. آخر دمج: #1305/#1308 (قبل التوقف) | يحفظ بلا مساس؛ لا يُختار منه مهمة |
| **Media Storage** | **نشط موثّق** + PR توثيقي قيد المراجعة | Tracker: G-0 و S1 مدموجان (#1325 `e0e5160`، #1326 `981663a`)؛ تفعيل `AWJ_ATTACHMENTS_R2_ENABLED` والتحقق الإنتاجي بوابات مالك؛ لا وصول لـRailway/Cloudflare في تلك الجلسة | #1330 `horizon/media-storage-tracker-s1` head `93f4626`، CI queued، `mergeable_state: unstable` | S1 غيّر 13 ملفاً بينها Controllers الفواتير/المدفوعات/المشتريات/المصروفات (انظر §5) |
| **Platform UX (H1)** | **نشط موثّق / قيد المراجعة** | `AWJ-PLATFORM-UX-H1.md`: المنفّذ المصرّح Grok؛ دمج كل PR بموافقة صريحة؛ H1-PAGINATION دُمج #1318؛ H1-2 لم يبدأ | #1328 `claude/awj-h1-contrast-recovery-fx8unn` head `c4310e1`، web build ✅، اختبارات PHP `in_progress` | الفرع باسم `claude/` لكن المنفّذ المصرّح Grok ← **لا تنسب الملكية من اسم الفرع** |
| **Store Customizer (CUST-H1)** | **مكتمل** | `CUST-H1-HORIZON-CLOSURE-REPORT.md` Status: CLOSED (PRs #1082,#1085,#1103,#1112,#1114) | — | |
| **Store Customizer (CUST-HV)** | **نشط بالإيقاع (غير مثبت بوثيقة حالة في هذا الجرد)** | دُمجت V8a…V9c-2 (#1303…#1322) في يوم واحد | #1329 `cust-hv/v9d1-card-tokens` head `e1579aa`، base `e0e5160`، عدة فحوص `in_progress` | لم أقرأ أي tracker لـCUST-HV → "غير مؤكد" لسلطة الدمج |
| **CUST-H1-3 (#1089)** | **غير مؤكد — على الأرجح متجاوَز** | base `019f2ad` متأخر ≈1100 commit؛ آخر تحديث 09-28؛ تقرير الإغلاق لا يذكره ضمن PRs التسليم | #1089 `feat/theme-version-publish` | يُغلق/يُعاد تقييمه بقرار مالك؛ لا يُدمج كما هو |
| **Growth Foundation** | **متوقف (توثيق فقط، بلا تنفيذ)** | #1128 docs-only منذ 09-30؛ "No implementation, OAuth, provider calls" | #1128 `docs/awj-growth-foundation-horizon-v1` head `d718eb3` | لم يُفعَّل؛ ينتظر مراجعة |
| **Cloudflare Platform** | **متوقف / قيد المراجعة (توثيق فقط)** | #1093 docs-only منذ 09-28 | #1093 `docs/awj-cloudflare-platform-horizon-v1` head `bba69ca` | يتقاطع مع Media Storage (R2) دلالياً — §5 |
| **Autonomy V2 (هذا)** | **قيد المراجعة (مسودة)** | #1327 draft | `docs/awj-horizon-autonomy-v2-proposal` | يحمل تصحيحات §9 |
| **آفاق/PRs قديمة أخرى** | **غير مؤكد (قديمة)** | #1105 motion، #784 recovery (draft، مستأجر Taiba)، #778 PAY-V2-6A، #704، #703، #578 (draft)، #202، #853 | — | #784 و#578 حساسان (استرداد بيانات مستأجر / طابور الإنتاج): لا يُلمسان دون قرار؛ وليست "أفقاً نشطاً" بلا دليل |
| **Legacy orchestration** | **تاريخي** | فروع `agent/orch-v2-*`, `agent/chatgpt-claude-orchestrator-v1` (2026-09-05) | — | **تضارب تسمية:** "ORCH-V2" القديم ≠ "Horizon Autonomy V2". يجب استعمال معرّف مختلف (§6) |

---

## 5. مصفوفة التعارضات

الاحتمالات هنا **فرضيات تداخل من مسارات الملفات الفعلية والدلالات**، وليست إثبات تعارض. التحقق من عدم تطابق أسماء الملفات بين #1326/#1328/#1329/#1327/#1089 (V2-0) أُعيد وأُكّد: لا ملف مشترك بين #1328 و#1329 و#1089 و#1330.

| الأفق | فرع / PR | نطاق الملفات المختصر | عقود مشتركة | تعارض محتمل | اعتماديات | المخاطر | متوازٍ آمن؟ |
|---|---|---|---|---|---|---|---|
| Media Storage S1 (مدموج) → #1330 | `horizon/media-storage-tracker-s1` #1330 | #1330: ملف tracker وحيد. S1 (مدموج): `AttachmentStorage`، Controllers (Employee/Expense/Invoice/Payment/Purchase)، migration `employees.photo_disk`، `config/attachments.php` | رفع المرفقات، قرص التخزين، ذرّية الطلب، عزل المستأجر | **مالي/أمني:** TAX/Delivery يلمسان `InvoiceController`/`PaymentController` نفسهما؛ كل تعديل مستقبلي عليهما يجب أن يعاد قراءته فوق S1 | R2 flag مغلق؛ بوابات مالك قبل التفعيل | **عالٍ** (مالي + هجرة + تخزين) | #1330 (توثيق): **نعم**. أي كود مالي في TAX/Delivery فوق نفس Controllers: **بتسلسل فقط** |
| TAX-ZATCA | لا PR حالياً | `Invoice*`، قيود VAT، طباعة ائتمان، ZATCA | `InvoiceService`، `LedgerService`، تسلسل ICV | مالي/ضريبي: مع Delivery (فواتير/VAT/دفع) ومع Media S1 (Controllers). #586 القديم تقني على نفس مجال QR | قرار مالك TAX-HZ-00؛ REM-05→06 إلخ | **عالٍ جداً** (Zone C) | عمل **قراءة/توثيق** متوازٍ: نعم. **كود** على Invoice/Payment: لا بدون قفل ملكية وأفضلية تسلسلية |
| Delivery (متوقف) | — | تقارير قنوات، حسابات التوصيل | الفواتير/الدفع/التسوية | يتقاطع مع TAX (VAT/الفوترة) عند الاستئناف | قرار DG-3 غير مغلق | عالٍ | **لا شيء ينفَّذ** حتى الاستئناف |
| Platform UX H1 | #1328 | `web/src/app/globals.css` + مكوّن زر + docs | **tokens/CSS عام** — `CODEOWNERS` يضع `globals.css` تحت مراجعة صاحب نظام التصميم | يؤثر بصرياً على ERP كله لا المنصة وحدها | تعارض مستقبلي مع أي تعديل tokens | متوسط | **نعم** مع PRs التي لا تلمس CSS عام؛ يحتاج دليل بصري + مراجعة CODEOWNER |
| Customizer CUST-HV | #1329 | `StorefrontGlobalTokensNormalizer.php` + توائم TS (web/storefront) + CSS المتجر | عقد global-tokens ثلاثي (PHP/web/storefront) "byte-identical" | تعارض بنيوي مع #1089 (presentation/publish)؛ أي PR آخر يغيّر العقد يكسر التوأمة | #1089 غير مؤكد | متوسط-عالٍ (عقد عابر للطبقات) | **نعم** مع الآفاق الأخرى؛ **لا** مع أي PR يعدّل `presentation/*` |
| #1089 (CUST-H1-3) | `feat/theme-version-publish` | Commerce presentation controller/service/routes | واجهة النشر + routes/api.php | متأخر ≈1100 commit؛ دمجه الآن = تعارض شبه مؤكد وتراجع إصدار | — | عالٍ إن دُمج دون إعادة تأسيس | **لا — يُجمَّد** حتى قرار مالك |
| Growth Foundation | #1128 | docs فقط | حدود tenant/RBAC/secrets | لا (docs) | — | منخفض | نعم |
| Cloudflare | #1093 | docs فقط | R2 كطبقة تخزين مركزية، WAF، Turnstile، **حدود Auth** | **دلالي:** يقترح R2 مركزياً بينما S1 قرّر وبنى مسار R2 للمرفقات؛ Turnstile على مسارات Auth يتقاطع مع TAX/الأمن | يجب أن يتوافق مع قرارات Media (G0-8…) | متوسط (قرار معماري) | docs: نعم. **تنفيذ: لا** قبل قرار توحيد R2 |
| Autonomy V2 | #1327 + هذا الفرع | docs فقط | **بروتوكول الدمج نفسه** | يمس سلطة كل الآفاق عند التفعيل | قرار سلطة موحّد | عالٍ عند التفعيل، منخفض كتوثيق | docs: نعم. **تفعيل: لا** |
| ملفات حوكمة مشتركة | `docs/autonomous-engineering/CURRENT-STATE.md` / `TASK-QUEUE.md` | 1034 / 1316 سطراً | أي أفق يكتب حالته هنا | **نقطة تعارض نصي عالية** — ملفان كبيران يلمسهما أكثر من أفق (مع أن TAX نقل طابوره إلى `docs/audits/horizon/`) | — | متوسط | V2 **ممنوع** أن يكتب فيهما قبل التفعيل |

**الأزواج الأخطر:** (1) TAX كوداً ↔ Delivery كوداً على Invoice/Payment؛ (2) Media S1 ↔ أي تعديل مالي على Controllers الخمسة؛ (3) #1329 ↔ أي تغيير على عقد الـtokens؛ (4) Cloudflare R2 ↔ Media R2؛ (5) أي دمج بلا حماية main يغيّر ما تأسّس عليه PR مفتوح (مثل #1327 المتأخر عن main بـcommit).

---

## 6. تصميم إدارة التزامن

### 6.1 قيود المنصة (دليل)
- **GitHub Actions `concurrency`:** مجموعة تشغّل مهمة واحدة وتنتظر واحدة (`queue: single`) تستبدل المنتظرة الأحدث الأقدم؛ `cancel-in-progress` قد يلغي **حامل** القفل؛ التوثيق لا يقدمها كقفل. ⇒ *جدولة*، لا Lock.
- **Git refs:** `PATCH git/refs` بلا معامل expected-old-sha؛ `force:false` يضمن fast-forward فقط. إنشاء ref لا يوثّق التوثيق ذرّيته كقفل (يجب اختباره). ⇒ لا CAS مضمون موثّق على الـrefs.
- **PR merge API:** `sha` = head المطلوب؛ عدم التطابق ⇒ **409**؛ **405** إن تعذّر الدمج. التوثيق نفسه يقول إن النقطة لا تدعم merge queue/stacked PRs. ⇒ هذا هو **CAS الموثّق الوحيد** المتاح للدمج.
- **Merge queue:** يختبر كل PR فوق آخر القاعدة + ما قبله FIFO؛ يتطلب `merge_group` في CI؛ توفره لحساب User غير مثبت في هذا الجرد.
- **Fencing (Kleppmann):** الـlease وحده غير آمن (توقف/تأخير شبكة)؛ الأمان يتطلب **رمزاً متزايداً يتحقق منه المورد المحمي**. GitHub لا يتحقق من رموزنا ⇒ أي fencing لدينا يجب أن يكون **على شروط GitHub نفسها** (head SHA، حماية الفرع)، لا قفل خارجي.
- **جلسات Claude Code السحابية:** تتوقف بعد خمول وتُستعاد المحادثة لا العمل الخلفي ولا wakeups الـ`/loop`؛ كل `--cloud` جلسة مستقلة متوازية؛ الحالة المحلية ليست دليلاً (وثائق code.claude.com).

### 6.2 البدائل

| # | البديل | يقدّم | يعجز عن | التكلفة/المخاطر | الحكم |
|---|---|---|---|---|---|
| A | **سجلّ مستند في المستودع** (`registry/*.json`) + قواعد طقوس | شفافية، تدقيق، صفر بنية | ليس قفلاً؛ مرئي بعد دمج فقط؛ قابل للتقادم والتحرير الخاطئ؛ تعارض مع الملفات الكبيرة المشتركة | منخفضة | **مرحلة 1 فقط، كتقرير** |
| B | **ملكية عبر فرع/PR + Labels/Assignees** | مرئية لكل المنفّذين؛ ربط بـPR | هوية واحدة؛ تُحرَّر بحرية؛ لا انتهاء | منخفضة | مكمّل لـA |
| C | **Lease ref (فرع `lease/<horizon>`) + fencing = generation في commit** | قفل ظاهر ومُنتهٍ | لا CAS موثّق على refs؛ سباق عند الإنشاء؛ لا إنفاذ من GitHub | متوسطة؛ خطر ثقة زائفة | **مرفوض كقفل ملزم**؛ قد يُستعمل كتلميح |
| D | **Actions `concurrency` كقفل** | تسلسل مهام CI/تحقق | ليس قفلاً (تستبدل المنتظر/تلغي الحامل) | منخفضة | للجدولة فقط، لا للملكية |
| E | **حماية main (Ruleset) + دمج بـ`sha` + required checks** | إنفاذ حقيقي من GitHub؛ CAS على الرأس؛ يمنع تجاوز CI | لا يمنع تعارضاً دلالياً بين PRs مختلفة؛ يحتاج إعداد المالك | متوسطة؛ يلزم إعادة تصميم CI المجمّع (G9) | **الأساس الإلزامي** |
| F | **Merge Queue** | يمنع دمجاً غير آمن بين PRs متزامنة | غير مثبت التوفر؛ يحتاج `merge_group` | متوسطة | مرشّح لاحق إن ثبت توفره |
| G | **Orchestrator خارجي** (DB/Redis lease + Fencing token) | قفل حقيقي بـtoken | يحتاج خدمة وبيانات اعتماد ومراجعة أمنية ونشراً — محظور هنا | عالية | **خارج النطاق الآن**؛ يُعاد فقط إن أثبتت المراحل السابقة حاجة |

### 6.3 التوصية والمراحل (ترقية تدريجية V1→V2)

| المرحلة | المحتوى | بوابة | الأثر على الآفاق الجارية |
|---|---|---|---|
| **P0** (جاهز) | هذا التقرير + تصحيحات #1327 | مراجعة المالك | لا أثر |
| **P1** | **Registry تقريري** `docs/autonomous-engineering/registry/` (ملف لكل أفق، لا ملف مشترك كبير) بحقول: `horizon_id`, `protocol_version`, `status_observed` (من GitHub) مقابل `status_reported`, `branches/PRs`, `surfaces`, `risk_zone`, `last_verified_main_sha`, `verified_at`. **لا يُستشهد بقيدٍ قديم دون إعادة تحقق** (TTL قصير). معرّف مميز `AWJ-HZ-V2` (لا `ORCH-V2`). | قرار مالك + تسجيل طوعي لكل أفق | إدخال طوعي، الآفاق غير المسجَّلة تبقى V1 |
| **P2** | **حماية main** (قرار وتنفيذ المالك — لا الوكيل): Ruleset: require PR، الفحصان `php artisan test (L11, sqlite|pgsql)`، حظر force-push/deletion، عدم تجاوز المدراء. **ويسبقه** workflow تجميع دائم يبلّغ حالة واحدة مستقرة للـpath-filtered، وإضافة `merge_group` إن ثبت توفر الـqueue | قرار مالك | يوقف الدمج على PRs حمراء أو الدفع المباشر |
| **P3** | **هوية Bot مستقلة** (GitHub App أدنى صلاحيات: contents/PR على فروع `bot/*` فقط، دون admin) + مراجعة مستقلة حقيقية (approval من هوية ≠ الدافع، "require approval of most recent push") | قرار مالك + مراجعة أمنية | يفرض فصلاً حقيقياً بين المنفّذ والمراجع |
| **P4** | **Checkpoint & Resume** عبر ملف handoff لكل مهمة (تعريف في المقترح §8) + مفتاح idempotency = `(horizon, task, head_sha, action)`؛ الاستئناف **يتحقق من GitHub أولاً** (هل الـPR مدموج؟ هل head تغيّر؟) ثم يتابع | اختبار قطع الجلسة | يمنع تكرار دمج/دفع بعد الانقطاع |
| **P5** | **Dry-run دمج بلا تنفيذ** على PR توثيقي منخفض الخطر، يسجل قرار الأهلية + `PRE_MERGE_REVIEW` على SHA | لا يتجاوز | لا أثر |
| **P6** | **Grant محصور** Zone A فقط لأفق مسجَّل، بتاريخ انتهاء، دمج بـ`sha`، ومنع تلقائي إذا تغيّر الرأس. Zone C/P يبقيان بموافقة لكل PR | قرار مالك صريح منفصل | لا يمس TAX/Delivery/Media/Platform |

**منع الدمج المتزامن غير الآمن (قواعد):** (1) كل دمج `PUT …/merge` يمرّر `sha`؛ (2) قبل الدمج: base الحالي = base المختبر وإلا يُحدَّث الفرع بـmerge (لا rebase على فرع غيرك) وتُعاد الفحوص؛ (3) تسلسل دمج PRs التي تتقاطع في `surfaces` (من registry) — أول من يملك الملكية، والثاني ينتظر دمجه الفعلي المُتحقَّق منه؛ (4) أي PR يلمس `globals.css`/`CODEOWNERS` paths يتطلب المراجعة المحددة؛ (5) فشل التحقق = إيقاف مغلق.

**الملكية (Ownership):** ملكية الفرع = أول `Claim` مسجّل في PR (وسم `horizon:<id>` + حقل `Owner-Session`/Agent في وصف PR) + توقيت آخر نشاط؛ **قاعدة عدم اللمس:** فرع به commit خلال آخر N دقيقة (مقترح 30) أو بلا Claim واضح = ممنوع التعديل، يُنشأ فرع جديد (طُبقت هنا فعلياً على #1327).

**الحالة الملزِمة مقابل المرجعية:** السجلّ مرجعي/تدقيقي؛ الإنفاذ الوحيد الملزم من GitHub (E/F). لا تُبنى سلامة مالية على سجلّ قابل للتحرير.

---

## 7. نتائج وفجوات ومخاطر

| # | النتيجة/الفجوة | الأثر | الإجراء |
|---|---|---|---|
| F1 | main بلا حماية | أي دمج/دفع ممكن تقنياً | قرار مالك P2؛ **لا دمج ذاتي قبله** |
| F2 | هوية واحدة | مراجعة "مستقلة" غير قابلة للإنفاذ | P3 |
| F3 | CI path-filtered | فحص مطلوب قد يعلّق للأبد | workflow تجميع (P2) |
| F4 | لا `merge_group` | الـqueue لو توفر لن يعمل | تعديل CI ضمن P2 |
| F5 | تعارض سلطة الدمج | وكيل قد يدمج بتفويض "قديم" | مصدر سلطة واحد (V2-1) |
| F6 | "TAX الوحيد النشط" ≠ الواقع | سجلّ آفاق خاطئ | توضيح مالك |
| F7 | حالة التحقق الحي للجلسات مجهولة | لا يمكن إثبات خلو فرع من عميل | قاعدة النشاط الحديث + Claim |
| F8 | إعدادات Actions/collaborators/Queue/Apps غير مقروءة | قرارات الحوكمة ناقصة الأدلة | قراءة بهوية مصرّح بها أو لقطات شاشة من المالك |
| F9 | #1089 و#586 و#784 و#578 قديمة/حساسة | خطر دمج/إحياء بالخطأ | جرد قرار مالك (إغلاق/تجميد) |
| F10 | تضارب تسمية `ORCH-V2` | التباس مع مسودة legacy | `AWJ-HZ-V2` |
| F11 | CI على main لم يتأكد خضرته | قاعدة الأساس مجهولة | تحقق قبل أي pilot |

---

## 8. قرارات المالك المطلوبة (Decision Packet مختصر)

| ID | القرار | التوصية |
|---|---|---|
| D1 | هل "TAX الأفق النشط الوحيد" يخص Delivery↔TAX فقط أم يوقف بقية الآفاق؟ | تحديد النطاق وتسجيله في registry |
| D2 | مصدر سلطة دمج واحد: تفويض دائم أم لكل PR؟ | لكل PR حتى P6؛ لا تفويض عام |
| D3 | تفعيل Ruleset على `main` (P2) وإعادة تصميم CI المجمّع | نعم — شرط أول لأي أتمتة دمج |
| D4 | هوية Bot مستقلة (P3) | نعم قبل أي منح دمج |
| D5 | قراءة إعدادات الحوكمة المنقوصة (Actions/Merge Queue/Collaborators) | لقطات شاشة أو token قراءة محدود |
| D6 | مصير #1089/#586/#784/#578/#1105 | جرد وإغلاق/تجميد صريح |
| D7 | قرار توحيد R2 بين Cloudflare #1093 وMedia Storage | ADR قبل أي تنفيذ |

---

## 9. تصحيحات مقترحة لـV2-0 (#1327) — لمالك الفرع

1. §2 و§6 في تقرير V2-0: **#1326 ليس مفتوحاً** — دُمج في `981663a` (19:56Z)، وظهر #1330 جديد. Base لـ#1327 صار متأخراً بـcommit.
2. "الموصل لا يعرض Branch Protection/Rulesets": صحيح لأداة MCP، لكن REST عبر `gh` يعيد Rulesets=`[]` و`protected:false` (التفاصيل 403) — الفجوة **مغلقة جزئياً** (§2 هنا).
3. تحديد أن #1089 متجاوَز على الأرجح وفق CUST-H1 closure.

---

## 10. نتائج الفحوص

| الفحص | النتيجة |
|---|---|
| تغيير الشيفرة/الإعدادات/الصلاحيات | لا شيء (وثيقة واحدة فقط) |
| `php artisan test` | **غير مُشغَّل** — توثيق فقط، لا يمسّ الشيفرة؛ سيشغّل CI الفحوص الآلية على الـPR |
| قراءة GitHub | موثقة في §2 |
| روابط المستندات الداخلية | `AWJ-HORIZON-AUTONOMY-V2-PROPOSAL.md` و`…V2-0-AUDIT.md` موجودتان **على فرع #1327 فقط** (غير مدموجتين) → ذُكرتا بالاسم لا برابط نسبي |
| اختبارات الواجهة/قيود محاسبية | لا قيود محاسبية جديدة؛ لا عمليات مالية |

---

## 11. الخطوة التالية

1. مراجعة المالك لهذا التقرير وقرارات D1–D7.
2. مالك فرع #1327 يدمج تصحيحات §9 ويحدّث base.
3. **V2-1 لا يبدأ** قبل هذه المراجعة. وقبله تبقى كل الآفاق الجارية تحت بروتوكولها الحالي وسلطة دمجها الحالية.

## المصادر

- GitHub Docs: Managing a merge queue; Available rules for rulesets; About protected branches; Automatically merging a pull request; REST — Merge a pull request, Git references, Repository rules; Actions — Using concurrency (جُلبت 2026-10-11).
- Claude Code Docs: Use Claude Code in the cloud (code.claude.com/docs/en/claude-code-on-the-web).
- M. Kleppmann, *How to do distributed locking* (2016) — fencing tokens.
- أدلة المستودع: `CLAUDE.md`، `docs/autonomous-engineering/{CURRENT-STATE,00-START-HERE,AUTONOMOUS-ENGINEERING-PROTOCOL,LEGACY-ORCHESTRATION-COMPATIBILITY}.md`، `docs/audits/horizon/AWJ-TAX-ZATCA-HORIZON-*.md`، `AWJ-HORIZON-MEDIA-STORAGE-TRACKER.md`، `docs/plans/platform/AWJ-PLATFORM-UX-H1.md`، `docs/reports/CUST-H1-HORIZON-CLOSURE-REPORT.md`، `CODEOWNERS`، `.github/workflows/*`، وPRs #1089/#1093/#1128/#1326/#1327/#1328/#1329/#1330.
