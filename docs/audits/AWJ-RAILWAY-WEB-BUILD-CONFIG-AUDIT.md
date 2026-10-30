# AWJ — مراجعة إعدادات بناء Web على Railway (30 أكتوبر 2026)

**نطاق:** فحص وتحليل فقط. لم يُغيَّر كود ولا إعدادات Railway/GitHub ولا متغيرات، ولم يحدث Merge/Deploy/Restart، ولا مساس بـTreasury أو قاعدة البيانات.
**المرجع:** `main` عند `7cb5843` (شجرة `web/` = `05daa2d…` مطابقة لـ`ae71a06`). تقرير الفشل السابق: `AWJ-RAILWAY-WEB-BUILD-FAILURE-7cb5843-REPORT.md`.
**تنبيه صدق:** لم أرَ سجل بناء Railway ولا لوحة الإعدادات؛ ما يخص Railway مأخوذ من وثائقها الرسمية ومن إعداداتك كما ذكرتها. **لا يوجد دليل أن Node أو الذاكرة هي سبب الفشل.**

---

## 1) النتائج

### 1.1 توافق Node 24 (اختُبر فعلياً بـ Node 24.22.0 المطابق لإعداد Railway)

| فحص | النتيجة |
|---|---|
| `engines.node` لـ198 حزمة في القفل | لا سقف أعلى يستثني 24 (`next` ‏`^18.18 \|\| ^19.8 \|\| >=20`، `jsdom` ‏`^20.19 \|\| ^22.13 \|\| >=24`، `vitest` ‏`^18 \|\| >=20`) |
| `npm ci` + `npm run build` (نسخة `web/` فقط، الإنتاج) | **نجح** exit 0، بلا تحذيرات؛ ذروة ذاكرة ≈ 3.8 GB |
| `next start` ثم `/login` و`/` | **200 / 200** |
| Vitest كامل (مستودع كامل) | **8921 نجح / 2 فشل** (انظر 1.5؛ الفشلان يتكرران على Node 22 فليسا من Node 24) |
| مقارنة | Node 22.22: بناء ناجح (ذروة ≈ 4.6 GB*)؛ Node 26.13: بناء ناجح (≈ 3.3 GB*) — Vitest لم يُشغَّل على 26 |

\* قياسات الذروة بعينات مختلفة الحمل؛ تفيد كمرتبة (3–5 GB) لا كمقارنة دقيقة بين الإصدارات.

**الوضع الحالي لتثبيت الإصدار:** لا شيء في المستودع (`engines`/`.nvmrc`/`.node-version`/`mise.toml` غائبة في `web/` والجذر). ترتيب Railpack: `RAILPACK_NODE_VERSION` ← `devEngines.runtime` ← `engines.node` ← `.nvmrc` ← `.node-version` ← `mise`/`.tool-versions` ← **الافتراضي `lts`** ([وثيقة Railpack](https://railpack.com/languages/node.md)). أي أن 24.22.0 اليوم **عائم**.

**جدول الدعم (nodejs/Release):** v22: صيانة منذ 2025‑10‑21، EOL ‏2027‑04‑30 · v24: LTS نشط حتى 2026‑10‑20 ثم صيانة، EOL ‏2028‑04‑30 · **v26: صار LTS في 2026‑10‑28 (قبل يومين)**. ⇒ خطر انجراف: متى حدّث Railpack تعريف `lts` إلى 26، سيبني أي إعادة بناء بإصدار لم يُختبر في CI.

**عدم تطابق CI/الإنتاج:** `web-ci.yml` يستعمل Node **22**، وRailway يبني بـ **24**. ما يمرّ في CI ليس ما يُبنى في الإنتاج.

**الإصدار الأنسب بالأدلة: Node 24 (الأغلبية الرئيسية، لا الرقم الدقيق).** مُختبَر هنا بنجاح، هو ما يشغّله Railway الآن، ودعمه حتى 2028‑04. 22 ينتهي دعمه خلال ~6 أشهر؛ 26 جديد ولم تُختبر اختباراته.

### 1.2 لماذا يُبنى Web عند تغييرات Backend فقط

- **GitHub Actions ليس السبب:** لا يوجد في `.github/workflows/*` أي ذكر لـRailway ولا خطوة نشر، ولا `railway.json/toml` في المستودع.
- **السبب: Auto Deploy من تكامل GitHub في Railway مع Watch Paths فارغة** ⇒ كل push إلى `main` ينشئ بناءً للخدمة. Root Directory `/web` يحدد الملفات المسحوبة فقط ولا يرشّح المحفِّزات ([وثيقة Monorepo](https://docs.railway.com/deployments/monorepo)).
- **الحجم:** في آخر 30 يوماً: 50 commit على `main`، منها 12 فقط تمسّ `web/` (24%). اليوم: 9 commits، 2 منها فقط تمسّ `web/`؛ والباقي (7) لم يغيّر `web/` أصلاً — مثلاً `ae71a06` و`7cb5843` بنيا شجرة مطابقة تماماً لسابقتها (نفس الـhash).

### 1.3 ما الذي يدخل فعلاً في بناء Railway

لأن Root=`/web` فالملفات خارجه **غير موجودة وقت البناء**. تحققت أن لا مصدر إنتاج يقرأ خارج `web/` (المراجع الخارجية: اختبارات فقط + سكربتان يدويان `openapi:generate`/`tokens:generate` ومخرجاتهما ملتزَم بها، ولا يُشغَّلان في `build`). **مدخلات البناء = `web/**` وحده.** تنبيه: `tsconfig.json` يضمّ `**/*.ts(x)` ⇒ **ملفات الاختبار وe2e تدخل فحص الأنواع**، فلا تُستثنى من الـwatch.

### 1.4 مسارات مشتركة تؤثر على **Web CI** (لا على بناء Railway)

اختبارات Vitest تقرأ ملفات خارج `web/`، ومسارات `web-ci.yml` لا تغطيها:
`app/Support/{Rbac,ApplicationCatalog,DocumentNumberingCatalog,PaymentMethodVisual}.php` · `tests/Fixtures/presentation/**` · `storefront/src/app/globals.css` · `storefront/src/lib/presentation/**` · `mobile/lib/app/runtime_schema.dart` · `docs/openapi/public-api-v1.yaml` · `design-system/tokens/awj.tokens.json` · `scripts/openapi-transform.mjs`.
(`contracts/app-builder/**` و`contracts/flowers-admin-journey/**` مغطاة أصلاً.) هذه الإضافات تُشغّل Web CI على 7 commits إضافية من 50 (≈ +14%).

### 1.5 اكتشاف جانبي مهم: انحراف كامن أحدثه `7cb5843`

`web/src/modules/roles/catalog.test.ts` يقرأ `app/Support/Rbac.php`. أضاف `7cb5843` الصلاحية `commerce.wholesale.manage` فظهر المجال `wholesale` **بلا تسمية** في `hr.perm_areas` (en/ar) ⇒ اختباران يفشلان (على Node 22 و24 معاً). لم يكتشفه أحد لأن Web CI لم يعمل (المسار غير مشمول). **الأثر:** أول PR يمسّ `web/` سيفشل في Web CI/CI Gate؛ وبحسب وصف الاختبار تظهر الصلاحية بمفتاح خام في شاشة الأدوار. **لا يؤثر على `next build` في Railway** (لا يشغّل اختبارات). لم أصلحه (خارج النطاق).

### 1.6 Wait for CI

حسب [الوثائق](https://docs.railway.com/deployments/github-autodeploys): يبقى النشر `WAITING` حتى تنتهي **كل** check suites لـGitHub Actions على الـcommit؛ فشل أي workflow **يتخطى النشر فوراً**؛ بعد ساعتين يُتخطى؛ المتخطّى/المحايد لا يحجب.
في هذا المستودع على push إلى `main`: `ci.yml` يعمل دائماً (بلا فلتر مسارات) ويستغرق **19–26 دقيقة** (9 تشغيلات: 18m42s–25m55s)، بينما Web CI **7–9 دقائق** (10 تشغيلات، كلها ناجحة). النتيجة:
- زمن نشر Web ≈ **+16 دقيقة** (يحدده Backend CI لا Web CI).
- **اقتران:** فشل/تذبذب اختبارات PHP (sqlite+pgsql) يوقف نشر Web غير المتأثر.
- **فائدة هامشية:** PRs محمية أصلاً بـCI Gate وWeb CI؛ و`main` أخضر في كل العيّنة.
- **لا يضمن نجاح بناء Railway:** Web CI يبني بـNode 22 على 16 GB، لا بيئة Railway.

### 1.7 Skipped Builds مقابل Watch Paths

الوثائق **لا تذكر إعداداً باسم «Skipped Builds»**؛ تذكر فقط *النشرات المتخطاة* (تُعرض بـ«Show Skipped») كنتيجة لـWatch Paths أو لفشل/مهلة Wait for CI. لذلك:
- **Watch Paths** = *محفِّز*: أي ملفات تغيّرت تُنشئ نشراً أصلاً (gitignore‑style).
- **Wait for CI** = *بوابة*: تؤخر أو تلغي نشراً قائماً حسب نتيجة Actions.
- **Skipped** = *حالة ناتجة* من أحدهما، لا آلية ثالثة موثّقة.
- معنى مفتاح «Skipped Builds» في لوحتك **غير متحقَّق منه**: اقرأ تلميحه في اللوحة قبل لمسه.
- **غير مؤكد:** هل تُطابَق الأنماط من جذر المستودع أم من Root Directory؟ الوثائق صامتة؛ منشور مجتمعي يقول من جذر المستودع، وآخر يبلّغ عن تجاهل Watch Paths في بعض البنّائين ([نقاش](https://station.railway.com/questions/watchpath-is-ignored-c152ced3)). **يجب اختباره بعد التطبيق**، لا افتراضه.

---

## 2) الإعدادات المقترحة (غير مطبَّقة)

| # | التغيير | القيمة |
|---|---|---|
| S1 | Watch Paths لخدمة Nebrax | `/web/**` (نسبةً لجذر المستودع كما في مثال Railway `/packages/backend/**`؛ إن أثبت الاختبار أنها نسبية لـRoot Directory فالمكافئ `/**`) |
| S2 | تثبيت Node | `RAILPACK_NODE_VERSION=24` (متغير خدمة Railway) **أو** ملف `web/.node-version` = `24` عبر PR (أبطأ لكن مُراجَع ومُوثَّق) |
| S3 | محاذاة CI | `web-ci.yml`: `node-version: '24'` (PR منفصل، بعد إصلاح 1.5) |
| S4 | مسارات Web CI | إضافة قائمة 1.4 إلى `paths` في `web-ci.yml` (push وpull_request) |
| S5 | Wait for CI | يبقى **معطّلاً** |
| S6 | «Skipped Builds» | لا تغيير قبل فهم معناه |
| S7 | إصلاح تسميات `wholesale` (en/ar) | PR صغير في `web/` — يُدفع **قبل** S3 كي يصير Web CI أخضر |

لا أقترح استثناءات (`!`) في Watch Paths: دعم النفي في Railway غير موثّق، والاختبارات/e2e تدخل فحص الأنواع.

## 3) المخاطر

| الخطر | التخفيف |
|---|---|
| S1 يترك الإنتاج على commit أقدم من `HEAD` (متوقع) | قبول صريح؛ `main` ≠ المنشور للـbackend‑only |
| S1 خاطئ المرجعية فيتوقف النشر عن الحدوث أصلاً | اختبار فوري: commit يمسّ `web/` **وآخر لا يمسّه**، والتحقق في «Show Skipped» |
| S2 بالمتغير غير مُراجَع في Git | سجّله في `web/DEPLOY.md` عند التطبيق |
| S2 دقيق (`24.22.0`) يحجب تحديثات الأمان | تثبيت الأغلبية `24` فقط |
| بقاء الوضع الحالي | قد تقفز `lts`→26 تلقائياً عند أي إعادة بناء؛ كل push (حتى docs) يستهلك بناءً ويُعرّض النشر لفشل غير مرتبط |
| تفعيل Wait for CI | +16 دقيقة وتبعية لاختبارات PHP؛ يوقف النشر عند فشل غير مرتبط |
| S4 | +14% تشغيلات Web CI |
| 1.5 | أول PR على `web/` سيفشل CI حتى تُضاف التسميات |

## 4) القرار GO / NO-GO

| التغيير | القرار | الشرط |
|---|---|---|
| S1 Watch Paths `/web/**` | **GO** | بعد إعادة البناء الوحيدة (القسم 5)، مع اختبار الـcommitين |
| S2 تثبيت Node `24` (أغلبية) | **GO** | بعد S1 وبخطوة مستقلة؛ المتغير أسرع، الملف أنظف |
| S2 تثبيت `24.22.0` الدقيق | **NO-GO** | يحجب تصحيحات الأمان |
| الانتقال إلى Node 26 الآن | **NO-GO** | LTS حديث جداً؛ Vitest غير مُختبَر عليه |
| S3 CI على Node 24 | **GO** | بعد S7 |
| S4 مسارات Web CI | **GO** | PR مستقل CI‑فقط |
| S5 تفعيل Wait for CI | **NO-GO** | أعد التقييم بعد S1+S3؛ بديل أخف: الاعتماد على CI Gate في PRs |
| S6 لمس «Skipped Builds» | **NO-GO** | معناه غير موثّق/متحقَّق |
| S7 إصلاح تسميات wholesale | **GO** | مستقل وصغير |
| استثناءات `!` / استثناء الاختبارات من الـwatch | **NO-GO** | غير موثّقة، والاختبارات داخل فحص الأنواع |

## 5) خطة إعادة بناء Web مرة واحدة بأمان (للتنفيذ لاحقاً بموافقتك)

**مبدأ:** متغيّر واحد في كل خطوة؛ إعادة البناء أولاً **بالإعدادات الحالية** لتمييز عارض عابر من سبب ثابت.

0. **تجميد:** لا Merge إلى `main` أثناء العملية (كل push يبني الآن لأن Watch Paths فارغة)، بما فيها PR التقرير المفتوح.
1. **لقطة حالة:** سجّل معرّف النشر الفعّال حالياً (آخر ناجح، ‎`ae71a06`) وإعدادات الخدمة ومتغيرات `NEXT_PUBLIC_*` (تُدمج وقت البناء: `NEXT_PUBLIC_API_URL`، `NEXT_PUBLIC_TENANT_BASE_DOMAIN`، `NEXT_PUBLIC_AWJ_UI_DEFAULT`). النشر الفاشل لا يستبدل الفعّال.
2. **ما سيُبنى:** `web/` بنفس الـhash `05daa2d…` ⇒ لا تغيير كود متوقع في الناتج.
3. **التنفيذ:** نافذة هادئة؛ **Redeploy واحد** للنشر `7cb5843` ([Redeploy يستعمل مصدر النشر المختار](https://docs.railway.com/deployments/reference)). لا إعادة محاولات تلقائية.
4. **مراقبة Build Logs مباشرة:** أول سطور السجل (إصدار Node/Railpack)، `npm ci`، `Compiled successfully`، `Linting and checking validity of types`، وأي `Killed`/`heap`/`ETIMEDOUT`. احفظ السجل كاملاً إن فشل.
5. **التحقق بعد النجاح:** `/login` و`/` يردّان 200، تحميل أصول `/_next/static`، دخول تجريبي واتصال بالـAPI، والتأكد أن قيم `NEXT_PUBLIC_*` المدمجة هي المتوقعة.
6. **الفشل:** لا محاولة ثانية قبل قراءة السجل؛ الإنتاج باقٍ على النشر الفعّال. التراجع الاحتياطي: **Rollback** إلى `ae71a06` ([نفس الآلية](https://docs.railway.com/deployments/reference)).
7. **بعد النجاح فقط، كلٌّ على حدة وبموافقة:** S1 ← اختبار (commit يمسّ `web/` وآخر لا) ← S2 ← إعادة بناء مراقَبة واحدة.

**معيار النجاح:** نشر Active من `7cb5843` ببناء كامل، وسجل يثبت إصدار Node، وفحص الدخان أخضر. **معيار الإيقاف:** أي فشل ⇒ تجميع السجل وتحليله قبل أي تغيير.

---
**المصادر:** [Railway Monorepo](https://docs.railway.com/deployments/monorepo) · [Railway GitHub Autodeploys](https://docs.railway.com/deployments/github-autodeploys) · [Railway Deployments reference](https://docs.railway.com/deployments/reference) · [Railpack Node](https://railpack.com/languages/node.md) · [Node release schedule](https://raw.githubusercontent.com/nodejs/Release/main/schedule.json). ما ورد من الوثائق مُلخَّص عبر أداة جلب؛ راجع الصفحات الأصلية قبل التنفيذ.
