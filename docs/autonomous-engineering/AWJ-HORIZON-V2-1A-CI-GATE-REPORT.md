# AWJ-HORIZON-V2-1A — GitHub Safety Foundation: CI Gate

**التاريخ:** 2026-10-11 · **الحالة:** للمراجعة — **لا يفعّل أي حماية ولا يمنح صلاحية**.
`main` ما زال بلا Ruleset/Branch Protection؛ هذا التسليم يجهّز البنية فقط.

| الحقل | القيمة |
|---|---|
| Branch | `claude/github-main-protection-design-bhicb1` |
| PR | يُدرج في وصف الـPR |
| Base SHA | `981663adf7bbb8d3a5a44a092839b35e28ad107c` (main, #1326) |
| Head SHA | آخر commit على الفرع (يُدرج في وصف الـPR) |

---

## 1. الخلاصة

- أُضيفت **بوابة واحدة ثابتة الاسم `CI Gate`** تُبلِّغ على **كل** PR، وتنتظر نجاح الفحوص الواجب وجودها فعلاً لذلك الـPR.
- **لم يُعدَّل أي workflow قائم** (`ci.yml`, `web-ci.yml`, `storefront-ci.yml`, `mobile-ci.yml`, `runtime-smoke.yml`, `store-brand-qa.yml`) ولا أي كود تطبيق/migration/API. أسماء الفحوص الحالية لم تتغير.
- البوابة **معلوماتية الآن**: لا تمنع شيئاً حتى يجعلها المالك Required (§7).
- **Merge Queue غير مناسب ولا متوفر على الأرجح** (§3.3) فلم يُضف `merge_group`.

## 2. ما ثبت في الفحص (أدلة من الكود)

| # | الواقع | الأثر |
|---|---|---|
| 1 | `ci.yml` يعمل على **كل** PR بلا `paths`، ومصفوفته تنتج `php artisan test (L11, sqlite)` و`(L11, pgsql)` | صالح كفحص مطلوب دائم (يغطي المالي/الأمني/عزل المستأجر/الـAPI) |
| 2 | `web-ci` و`storefront-ci` و`mobile-ci` (3 مهام) و`runtime-smoke` و`store-brand-qa` مقيّدة بـ`paths` | لو أُلزمت مباشرة: PR توثيقي يبقى «Waiting for status to be reported» للأبد (موثّق، §4) |
| 3 | PR توثيقي فقط ⇒ يعمل الفحصان الخلفيان وحدهما | يكفي، لا حاجة لتعديل CI لتخفيف التوثيق |
| 4 | لا `merge_group` في أي workflow | Merge Queue لن يعمل دون تعديل كل الـworkflows |
| 5 | `store-brand-qa` مقيّد بمسارات ضيقة وله فرع `push` خاص (Playwright بصري) | صُنّف استشاري (قرار مالك في §9) |
| 6 | خطوة الاختبار تستعمل `php artisan test … \| tee` مع `set -o pipefail` | حذف `pipefail` كان سيُخفي فشل الاختبارات ← تحرسه البوابة |

## 3. التصميم المختار

### 3.1 الفكرة
`ci-gate.yml` (يعمل على `pull_request`: opened/synchronize/reopened/ready_for_review) ينفّذ `scripts/ci-gate/ci_gate.py`:

1. **اختبارات ذاتية + `validate`** (دون شبكة): يطابق `.github/ci-gate/required-checks.json` مع ملفات الـworkflows الفعلية.
2. **يحسب الفحوص المتوقعة**: `always` دائماً؛ `paths` فقط إن طابقت ملفاتُ الـPR (من `pulls/{n}/files`، شاملةً `previous_filename`) مرشّحَ `pull_request.paths` **المقروء من ملف الـworkflow نفسه** — فلا ازدواج مسارات يتقادم. إن كانت قائمة الملفات مبتورة (≥3000) أو مجهولة ⇒ **يُطلب كل شيء** (فشل آمن).
3. **يستطلع** `commits/{head_sha}/check-runs?filter=all` و`actions/runs?head_sha=` كل 30ث حتى 70 دقيقة.

### 3.2 كيف تحقق المتطلبات

| المتطلب | الآلية | اختبار |
|---|---|---|
| لا تعليق بسبب فحص شرطي لم يعمل | فحص `paths` غير المطابق **لا يُنتظر** | `test_docs_only_passes…`, `test_missing_conditional…` |
| لا نجاح عند فشل فعلي | أي `conclusion ≠ success` ⇒ فشل فوري | `test_failure_fails` |
| الملغى/غير المكتمل ليس نجاحاً | cancelled/skipped/neutral/timed_out/action_required/stale/null ⇒ فشل؛ in_progress ⇒ انتظار؛ تجاوز المهلة ⇒ فشل | `test_cancelled_skipped…`, `test_not_yet_reported…` |
| لا تجاوز لاختبارات مالية/أمنية/عزل | الفحصان `always` لكل PR؛ `guard` يمنع `--filter/--group/--exclude-group/--testsuite/--stop-on/\|\| true` ويشترط `set -o pipefail`؛ يمنع `if:` على مستوى المهمة و`continue-on-error` (مهمة متخطاة أو `continue-on-error` **تُبلَّغ نجاحاً** لحماية الفروع — موثّق §4) | `test_test_filter_rejected`, `test_lost_pipefail…`, `test_job_level_if…`, `test_continue_on_error…` |
| لا اعتماد على أسماء غير موثّقة | `validate` يفشل عند أي انجراف اسم/مهمة/نوع trigger، وعند إضافة `paths` لفحص `always`؛ ويحذّر من أي فحص PR غير مصنَّف | `test_job_rename_is_drift`, `test_path_filter_on_always…`, `test_new_unclassified…` |
| لا إخفاء لفشل سابق بإعادة التشغيل | الحكم على **آخر محاولة** (مثل GitHub نفسه)، وإعادة قيد التشغيل بعد فشل تُنتظر؛ والنجاح بعد فشل سابق يظهر **تحذيراً** في الملخص والـannotations | `test_rerun_uses_latest_attempt_and_warns`, `test_rerun_in_progress…` |
| فحوص من تطبيق آخر | تُهمل غير `github-actions` (لا انتحال اسم) | `test_spoofed_check…` |
| **ربط الفحوص بمحاولة الـPR الحالية** (إصلاح جولة المراجعة 1) | `push` و`pull_request` يُنتجان check runs **بنفس الأسماء على نفس الـSHA** (مُشاهَد على هذا الـPR: run `38171911599` push وrun `38171914689` pull_request). لا يُقبل check run إلا إن كان `check_suite.id` له يطابق `check_suite_id` لـworkflow run حدثه `pull_request` و`head_sha` = رأس الـPR. إعادة تشغيل run الـpush (ids أعلى، أخضر) لا تُخفي فشل run الـPR | `Binding.*` (5), `EndToEnd.test_pr_failure_not_hidden_by_green_push_twin` |
| SHA قديم | قبل الانتظار وبعد كل دورة وقبل الحكم: `GET pulls/{n}` يجب أن يكون `open` وhead = الـSHA المقيَّم، وإلا `stale gate` فشل. وأي check run لـSHA آخر يُهمل | `EndToEnd.test_stale_head_fails_closed`, `Binding.test_runs_of_other_sha…` |
| تعديل البوابة/المانيفست داخل الـPR | (1) منطق البوابة الحاكم يُنفَّذ من **نسخة القاعدة الموثوقة** (`.base/`) لا من الـPR؛ (2) `compare_baseline` يرفض أي إضعاف مقابل `main`: حذف فحص مطلوب، خفض tier، تغيير workflow/job، تقليص `guard`، أو **حذف نمط من `pull_request.paths`** (كان يسمح بتجاوز `web build` بتضييق المسارات)؛ (3) أي PR يمسّ ملفات البوابة يحمل تحذيراً/لافتة `GATE SELF-CHANGE`. الإضافة والتشديد مسموحان | `Baseline.*` (8) |
| عمل صحيح عند تحديث PR / تغيّر main | الحالة مرتبطة بـSHA؛ push جديد يلغي بوابة القديم (`concurrency`)؛ تغيّر main يُعالَج بخيار «up to date» في §7 | — |
| فحص قدّم لكن لم يُشغَّل قط | بلا أي run للـworkflow بعد 10 دقائق ⇒ فشل صريح؛ `action_required` ⇒ فشل؛ workflow انتهى دون الإبلاغ عن المهمة ⇒ فشل | `test_workflow_never_triggered…`, `test_action_required…` |

Fail-closed: خطأ API بعد 5 محاولات، بنية workflow غير مدعومة (`paths-ignore`, `!`, `branches` غير `**`, matrix `include/exclude`) ⇒ فشل بسبب واضح.

### 3.3 البدائل المرفوضة

| البديل | سبب الرفض |
|---|---|
| تعديل كل workflow ليعمل دائماً مع `changes` job ومهام no-op | يمسّ `web-ci/storefront-ci/mobile-ci` التي تعدّلها آفاق Customizer/Storefront/Mobile الجارية (تعارض دمج) ويغيّر أسماء فحوص قائمة |
| دمج كل شيء في workflow واحد + `needs`/`always()` | نفس الضرر + إعادة كتابة كبيرة؛ حل المنصة الموثّق لكنه غير لازم |
| `workflow_run` + كتابة commit status | يعمل من سياق الفرع الافتراضي، يحتاج `statuses:write`، سباقات وتعقيد، ولا حاجة له |
| Merge Queue | التوثيق الرسمي يشترط `merge_group` في كل workflow؛ وتوفره للحسابات الشخصية **غير مثبت**: مستودعنا `owner.type: User` (V2-0B)، والتوثيق الحالي يحصره في مستودعات المنظمات العامة أو Enterprise Cloud الخاصة (نتيجة بحث؛ يُتحقق من واجهة الإعدادات) |
| `pull_request_target` لإحكام البوابة من تعديل الـPR لها | يمنح token كتابة وسياقاً مرتفع المخاطر؛ والحماية من تعديل البوابة تحتاج مراجع مستقلاً أصلاً (غير متوفر: هوية واحدة) — انظر المخاطر |
| الحكم بأي فشل سابق على الـSHA (صارم) | يمنع إعادة تشغيل مشروعة لفشل بنية تحتية؛ استُبدل بالتحذير الظاهر |
| خدمة/Action خارجي | لا ضرورة؛ stdlib + PyYAML مثبّت `6.0.2` |

## 4. أدلة GitHub الرسمية

- Troubleshooting required status checks (docs.github.com): فحص يُتخطّى بسبب path/branch filtering يبقى «Pending» ويمنع الدمج («Waiting for status to be reported»)؛ مهمة تُتخطّى بشرط `if` **تُبلَّغ نجاحاً**؛ المهمة التابعة لمهمة فاشلة تُتخطّى وقد لا تمنع الدمج ويُوصى بـ`always()` مع `needs`.
- Available rules for rulesets: Require PR، Required status checks (strict = «up to date»)، Block force pushes، Restrict deletions؛ ويمكن تحديد التطبيق مصدراً متوقعاً لحالة الفحص.
- Managing a merge queue: «يجب استعمال حدث `merge_group`»؛ وهو منفصل عن `pull_request`.
- REST check runs: `conclusion` ∈ success/failure/neutral/cancelled/skipped/timed_out/action_required؛ `filter=latest|all`.
- أدلة سابقة: `AWJ-HORIZON-AUTONOMY-V2-0B-GOVERNANCE-AUDIT.md` (PR #1331) §2–3.
- **غير مُتحقَّق منه:** صلاحية Rulesets الخاصة بهذا المستودع/الخطة، وتوفر Merge Queue، وإعدادات Actions — غير مقروءة من الجلسة.

## 5. الملفات

| الملف | الغرض |
|---|---|
| `.github/workflows/ci-gate.yml` | البوابة (جديد، لا يمس workflows أخرى) |
| `.github/ci-gate/required-checks.json` | المصدر الوحيد لتصنيف الفحوص (always / paths / advisory) |
| `scripts/ci-gate/ci_gate.py` | `validate` + `gate` |
| `scripts/ci-gate/test_ci_gate.py` | 46 اختباراً بلا شبكة (يشمل Regression للجولة 1) |
| `.gitignore` | منع `__pycache__/` و`*.pyc` (بعد أن دخل `.pyc` الـcommit الأول خطأً؛ أُزيل) + اختبار `Hygiene` يفشل إن تُتبّع bytecode |
| هذا التقرير | |

لا تغيير في `app/`, `database/`, `routes/`, `web/`, `storefront/`, `mobile/`. المجلد `scripts/` ليس ضمن قوائم النسخ في `ci.yml`/`deploy/assemble.sh` فلا يصل لبناء Laravel (حارس قائمة النسخ يفحص `app/` فقط).

## 6. الاختبارات

- محلياً: `python3 -m unittest discover -s scripts/ci-gate` ⇒ 46/46 ✅؛ `ci_gate.py validate` ⇒ OK بلا تحذيرات.
- اختبارات طفرة (mutation) تثبت أن البوابة ترفض: `paths` على `ci.yml`، إعادة تسمية مهمة، `if:`، `continue-on-error`، `--filter`، فقد `pipefail`، `paths-ignore`، workflow جديد غير مصنَّف (تحذير).
- `php artisan test`: لم يُشغَّل محلياً — لم يُمس أي كود PHP؛ يعمل في CI. لا عمليات مالية جديدة ⇒ **لا قيود محاسبية ناتجة** (لا حاجة لجدول قيود).
- مسار `gate` الشبكي يُثبت لأول مرة على CI هذا الـPR نفسه (انظر §10).

## 7. الفحوص المقترح جعلها Required

**Required Check واحد فقط: `CI Gate`** (يُحبَّذ ربطه بمصدر GitHub Actions). لا تُلزَم الفحوص الأخرى مباشرة (تعليق path-filter). التي تتحقق خلفه:

| فحص | الفئة | متى |
|---|---|---|
| `php artisan test (L11, sqlite)` | always | كل PR |
| `php artisan test (L11, pgsql)` | always | كل PR |
| `web build (Next.js)` | paths | web/**, contracts/app-builder/**, contracts/flowers-admin-journey/**, workflow |
| `storefront (lint + typecheck + test)` | paths | storefront/**, contracts/flowers-journey/** |
| `mobile (analyze + test)` / `(Android release build proof)` / `(iOS release build proof)` | paths | mobile/**, contracts/app-builder/** |
| `Docker runtime smoke` | paths | Dockerfile, deploy/** |
| `merchant preview visual QA`, `published footer visual QA` | advisory | لا تمنع (قرار §9) |

## 8. خطة حماية main (للمالك — لم تُطبَّق)

**المتطلب المسبق:** دمج هذا PR، ومراقبة `CI Gate` على 3–5 PRs فعلية (مستند، web، backend) دون إيجابيات كاذبة.

1. **Ruleset على `main`** (Settings → Rules → Rulesets) بحالة **Evaluate** (إن توفر) أولاً ثم Active:
   - Require a pull request (عدد الموافقات 0 الآن — هوية واحدة؛ يرتفع إلى 1 مع P3 بهوية Bot مستقلة؛ مع «Dismiss stale approvals»).
   - Require status checks: `CI Gate` فقط. **Require branches to be up to date: قرار مالك** — يحل مشكلة «main تغيّر بعد اختبار الـPR» (لا Merge Queue) لكنه يفرض تحديث كل PR قبل دمجه ويضاعف تشغيل CI عبر الآفاق المتوازية؛ التوصية: يُفعَّل لـPRs الباك-إند المالية (Zone C) بالانضباط اليدوي أولاً، ثم يُعمَّم إن لزم.
   - Block force pushes + Restrict deletions.
   - Require code owner review: **لا** حتى وجود هوية ثانية (`CODEOWNERS: * @safwan5001-source` يجعل المالك مراجع نفسه).
2. **Bypass:** قائمة فارغة قدر الإمكان؛ المالك فقط (Repository admin) لحالات الطوارئ، مع تسجيل السبب في PR. لا يُمنح أي وكيل/App bypass. (توفر قوائم bypass لحساب شخصي غير مثبت.)
3. **الأثر:** المالك: لن يدفع مباشرة إلى main ويحتاج PR + `CI Gate` أخضر. الوكلاء: لا يتغير تدفقهم (فرع + PR)، لكن `merge_pull_request` سيرفض PR أحمر/معلّق؛ لا auto-merge. الآفاق الجارية: PR مفتوح قبل التفعيل يحتاج push/إعادة تشغيل ليحصل على `CI Gate` (لا يُبلَّغ بأثر رجعي).
4. **Rollback:** (أ) عطّل الـRuleset أو اجعله Disabled (لا يحذف شيئاً)؛ (ب) إن علقت PRs بسبب البوابة فقط: أزل `CI Gate` من Required (الفحوص الأخرى تبقى تعمل)؛ (ج) تراجع الشيفرة: revert لـ`ci-gate.yml` وحده — لا شيء آخر يعتمد عليه. جرّب الـRollback على PR تجريبي قبل الاعتماد.
5. **لا يُشغَّل Auto-merge** ولا يُمنح أي Agent صلاحية دمج نتيجةً لهذه الخطة.

## 9. قرارات تحتاج المالك (Decision Packet)

| # | القرار | التوصية |
|---|---|---|
| D1 | هل يُلزَم `Docker runtime smoke` ضمن البوابة؟ | نعم (يحرس صورة الإنتاج، يعمل فقط عند مسّ Dockerfile/deploy) — مُفعَّل افتراضياً في المانيفست |
| D2 | هل يُرفَّع `store-brand-qa` من استشاري إلى مطلوب؟ | لا الآن؛ غير مقروء استقراره، أضيقه مسارات. غيّر `tier` لاحقاً بتعديل سطر |
| D3 | «Require branches to be up to date» | §8.1 |
| D4 | هل تُسمح البوابة بالمهلة 70 دقيقة وبقاء مهمة تنتظر على ubuntu؟ | نعم؛ تكلفة دقائق runner إضافية بحجم أبطأ فحص لكل PR (قيِّم بعد أسبوع) |
| D5 | حماية ملفات البوابة (`.github/**`, `scripts/ci-gate/**`) من تعديل غير مراجَع | تحتاج مراجعاً مستقلاً (P3)؛ إلى حينها هي حماية انضباطية |

## 10. أثر على الآفاق المتوازية

- **TAX-ZATCA / Media Storage / Platform UX / Customizer / Delivery:** لا ملف مشترك، لا تغيير في أي workflow أو أسماء فحوص أو كود. لا تُعدَّل فروعها. ستظهر على كل PR فحص جديد `CI Gate` (معلوماتي) — لا حظر.
- **تنبيه تشغيلي:** من يضيف workflow جديداً يعمل على PR سيرى تحذير `unclassified PR check` (لا فشل) حتى يضيفه إلى المانيفست؛ يُرفَّع إلى خطأ عند التفعيل إن رغب المالك.
- مالياً/عزلاً/APIs/قواعد بيانات: لا تأثير (لا مسّ لكود تطبيق).

## 11. مراجعة الجودة

**Implementer:** نُفّذ بأصغر تصميم مستقل؛ لا اعتماد خارجي غير PyYAML المثبّت.
**Reviewer (ذاتي):** وُجد وأُصلح تكرار شرط `action_required` في `evaluate`؛ فُحصت مسارات: PR توثيقي، web فقط، تغيير عقد مشترك، إعادة تشغيل بعد فشل، تجاوز مهلة، انتحال check من تطبيق آخر.
**AWJ Guardian:** لا تغيير مالي/محاسبي/عزل/API/قاعدة بيانات؛ لا صلاحيات جديدة (`GITHUB_TOKEN` للقراءة فقط: contents, checks, actions, pull-requests)؛ لا أسرار؛ لا auto-merge/merge/deploy؛ لا Ruleset.

## 12. المخاطر المتبقية

1. **البوابة قابلة للتعديل من الـPR نفسه** (تعمل من merge ref) — لا حماية ما دامت هوية واحدة؛ يُعالج بـD5/P3.
2. بعد **إعادة تشغيل مهمة فاشلة** يجب إعادة تشغيل `CI Gate` يدوياً (نقرة واحدة)؛ لا مشغّل تلقائي آمن من `check_run`.
3. `grace`/`deadline` تقديران؛ يُضبطان بعد أسبوع من الملاحظة. iOS على macOS قد يكون أبطأ فحص.
4. توفر Rulesets/Merge Queue/Bypass على الحساب الشخصي **غير مُتحقَّق منه**.
5. مسار `gate` الشبكي لم يُجرَّب محلياً (لا token) — يُتحقق في CI هذا الـPR.

## 13. الخطوة التالية

مراجعة المالك لهذا التقرير ← قرارات D1–D5 ← مراقبة `CI Gate` على PRs فعلية ← تنفيذ §8 يدوياً من المالك. **V2-1B لا تبدأ قبل ذلك.**
