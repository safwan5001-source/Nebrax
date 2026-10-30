# AWJ — تقرير فشل بناء Web على Railway (30 أكتوبر 2026)

**الحالة: السبب الجذري على Railway غير مُثبَت. لا تغيير كود. لا PR.**
أُثبت أن الفشل **ليس** ناتجاً عن تغييرات الـcommit، وأن الكود يبني بنجاح في بيئة غير مقيَّدة، وأن البناء **يفشل عند سقف ذاكرة أقل من ~4.6 GB**. هذا يجعل «قيد موارد في بيئة البناء» الفرضية الأرجح، لكنها تحتاج تأكيداً من سجل Railway الكامل (انظر §6).

## 1. المعطيات

| البند | القيمة |
|---|---|
| Failed commit (Head SHA) | `7cb5843fff7f9d906e18fbf92de135babd637ccc` (#1807، H6 Batch E) |
| Previous successful | `ae71a060daf4f5f733eac957f477f770951558ea` (#1808، docs فقط) |
| الفرع | `claude/railway-web-build-failure-gg0dsg` (= `main` عند `7cb5843`، بلا commits إضافية) |
| Base SHA | `7cb5843fff7f9d906e18fbf92de135babd637ccc` |
| PR | لا يوجد (لا حاجة لتعديل كود) |
| Next.js | 15.5.19 (مطابق للقفل `package-lock.json`) |

## 2. الفرق بين الإصدارين

`git diff ae71a06 7cb5843`: 21 ملفاً، كلها backend (Laravel): controllers/middleware/models/services/migration/routes/tests/docs.
**لا ملف واحد تحت `web/` أو `storefront/` أو `contracts/`.**

دليل التطابق (tree hash لمجلد `web/`):

| Commit | `web/` tree | `storefront/` tree |
|---|---|---|
| `24d911f` (آخر تغيير فعلي لـweb، Web CI أخضر) | `05daa2dfbda2f65ad4117342ad9895fe6baee81a` | `87d08cd6…` |
| `ae71a06` (ناجح على Railway) | `05daa2dfbda2f65ad4117342ad9895fe6baee81a` | `87d08cd6…` |
| `7cb5843` (فاشل) | `05daa2dfbda2f65ad4117342ad9895fe6baee81a` | `87d08cd6…` |

الشجرة والـlockfile **متطابقان تماماً** بين الناجح والفاشل ⇒ أي فرق في النتيجة سببه البيئة/الموارد/الشبكة/الأدوات، لا الكود ولا الاعتماديات.
كما أن `web-ci.yml` مقيَّد بـ`paths: web/**`، فلم يُشغَّل Web CI على `7cb5843` أصلاً (لا دليل CI للويب على هذا الـcommit؛ CI الخلفي `CI #10769` أخضر).
لا شيء في مصدر الإنتاج يقرأ ملفات خارج `web/` (تحقق بـgrep)، ومجلد الجذر على Railway هو `/web`.

## 3. إعادة الإنتاج

بيئة: نسخة نظيفة من `git archive 7cb5843 web` فقط (محاكاة root=`/web`)، Node v22.22.0، npm 10.9.4، `npm ci`، `NODE_ENV=production`، `NEXT_TELEMETRY_DISABLED=1`، ثم `npm run build`.

| # | الشرط | النتيجة |
|---|---|---|
| 1 | بلا سقف ذاكرة (16 GB) | **نجح، exit 0** (~2m30s) |
| 2 | كما (1) + `NEXT_PUBLIC_AWJ_UI_DEFAULT=3` و`NEXT_PUBLIC_API_URL` | **نجح، exit 0**؛ قياس الذروة: **~4.6 GB RSS** (مجموع عمليات Next) |
| 3 | cgroup ذاكرة **2 GB** | **فشل**: `FATAL ERROR: Reached heap limit… JavaScript heap out of memory` (exit 134) أثناء `Creating an optimized production build` |
| 4 | cgroup **3 GB** | **فشل**: V8 heap OOM (exit 134) |
| 5 | cgroup **4 GB** | **فشل**: `Compiled successfully in 90s` ثم `Linting and checking validity of types ...` ثم `Killed` (SIGKILL من الـkernel، exit 137، `failcnt=4580`) |

الاستنتاج المثبَّت: الكود سليم؛ البناء يحتاج عملياً ما يقارب 4.6 GB ذاكرة، ويفشل تحتها. مرحلة فحص الأنواع (`Linting and checking validity of types`) هي أثقل مرحلة حيث وقع الـkill عند 4 GB.

## 4. ما **لم** يُثبَت (بصراحة)

- لم أرَ سجل Railway، فلا أعرف سقف ذاكرة البناء الفعلي لخدمتك، ولا إن كان الفشل OOM أصلاً.
- أشكال الفشل التي أعدتُها خرجت بـ134/137 وفي سجل محلي كامل رسالة صريحة (heap OOM / `Killed`)؛ وصف «exit code 1 بلا رسالة» قد يتطابق مع OOM أو مع سبب آخر (انقطاع شبكة npm، فشل cache، تغيّر إصدار Node/المُنشئ، مهلة، تعارض نشر متزامن). **لا أفترض OOM بدون دليل من Railway.**
- لا تثبيت لإصدار Node في المستودع (`engines` و`.nvmrc` غائبان)، فإصدار Node/المُنشئ على Railway يتبع الافتراضي لديهم وقد يتغير بين نشرتين. غير مُتحقَّق من أنه تغيّر.
- تذبذب بيئي (flaky): بما أن الشجرة متطابقة وسبق أن نجحت، وجود هامش ذاكرة ضيق يفسّر نجاحاً/فشلاً متناوباً، لكنه استنتاج، لا قياس على Railway.

## 5. التغييرات

**لا شيء.** لم يُعدَّل كود ولم يُفتح PR. لم تُمسّ متغيرات Railway ولا قواعد البيانات ولا بوابة Treasury، ولم يحدث Merge/Deploy/Restart.
(التقرير الحالي ملف docs غير ملتزَم به في Git؛ لم أدفع شيئاً.)

## 6. خطة تشخيص محددة (تحتاج صلاحيات Railway — بموافقتك)

1. **سجل البناء الكامل** للنشر الفاشل (Build Logs وليس Deploy Logs): ابحث عن `Killed`، `JavaScript heap out of memory`، `SIGKILL`، `Linting and checking validity of types`، `npm ERR!`، `ETIMEDOUT`/`ECONNRESET`. أي منها يحسم السبب.
2. **مقارنة النشرتين** (`ae71a06` الناجح مقابل `7cb5843`): إصدار Node وإصدار Nixpacks/Railpack المسجَّل في أول سطور السجل، وحالة الـbuild cache (هل `npm ci` أُعيد أم استُعيد من cache).
3. **مقاييس الذاكرة** للنشر الفاشل في Railway (Metrics) وحدّ الخطة المعتمدة لبيئة البناء.
4. **إعادة نشر نفس الـcommit** (Redeploy) لاختبار التذبذب: نجاحه = سبب بيئي عابر؛ فشله المتكرر = قيد ثابت (ذاكرة/أداة).
5. حسب النتيجة (قرارات منفصلة، لم تُنفَّذ):
   - OOM: رفع ذاكرة البناء في الخطة، أو تقليل كلفة البناء (مثل فصل فحص الأنواع إلى CI فقط والاعتماد على Web CI) — تغيير سلوك بناء يحتاج قرارك.
   - اختلاف Node/المُنشئ: تثبيت `engines.node` أو `NIXPACKS_NODE_VERSION`/ما يوافقه (تغيير متغير Railway يتطلب موافقتك).
   - شبكة/registry: إعادة محاولة تكفي.

## 7. المخاطر

- ترك المشكلة دون تشخيص: أي commit لاحق (حتى docs/backend) قد يفشل نشره على Railway بنفس الطريقة طالما الهامش ضيق.
- هامش الذاكرة يتقلص مع نمو `web/` (الذروة اليوم ~4.6 GB)؛ أي إضافة تقرّبه أكثر من السقف.
- لا خطر على الإنتاج الحالي: النشر الفاشل لا يستبدل النشر الناجح السابق.

## 8. CI

- `CI` (backend) على `7cb5843`: **success** (run #10769).
- `Web CI` لم يُشغَّل على `7cb5843` (مرشّح المسارات)؛ آخر Web CI أخضر على `24d911f` بنفس شجرة `web/`.
- اختبارات الويب (Vitest) لم تُشغَّل محلياً هنا لأنه لا تغيير كود يُختبَر؛ بناء `npm run build` كاملاً نجح في (1) و(2).
