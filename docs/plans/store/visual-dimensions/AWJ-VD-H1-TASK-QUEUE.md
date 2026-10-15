# AWJ-COMMERCE-VISUAL-DIMENSIONS-H1 — Task Queue

LAST_UPDATED: 2026-10-15
STATUS: **G0 CLOSED (owner, 2026-10-14): D-01..D-17 approved. VD-0 merged as `d5dfa16`. VD-1a merged as `8801af9` (POST_MERGE_REVIEW: PASS — CI, Web CI and Storefront CI green on main). VD-2 merged as `d568bf6` (PR #1482, squash, under the amended D-14; POST_MERGE_REVIEW: PASS). VD-4a merged as `c57f4be` (PR #1490) and VD-1b merged as `5a10930` (PR #1491), both by the owner (POST_MERGE_REVIEW: PASS — CI green on main for both; Web CI and Storefront CI green for `c57f4be`). VD-1c merged as `b1b7988` (PR #1499, by the owner, on owner decisions D1–D4; POST_MERGE_REVIEW: PASS — CI (sqlite + pgsql) and Storefront CI green on main). The owner authorized VD-3, VD-4b and VD-4c on 2026-10-15; each was reviewed independently and merged (all UI-only, no API/DB/permission change): VD-4c as `2b77747` (PR #1507), VD-4b as `f1e309e` (PR #1508) and VD-3 as `d628288` (PR #1509) (POST_MERGE_REVIEW: PASS — CI (sqlite + pgsql) green for all three; Web CI green for VD-4c and VD-3; Storefront CI green for VD-4b). VD-5 was executed on 2026-10-15 (report `AWJ-VD-5-QA-REPORT.md`; fixes #1521/#1527/#1528/#1529/#1530/#1533, specs #1525/#1526); VD-6 waits at the owner's approval gate. Known pre-existing flake, recorded outside the horizon: BL-001 (`VatAdjustmentRoutingTest` row order on pgsql). Merge policy amended by the owner (D-14): low-risk PRs auto-merge once green and reviewed; DB/API/permissions/security/tenant/accounting/inventory changes still need explicit approval before implementation and merge. DB/API slices (VD-1b, VD-1c) still need a separate explicit owner approval before they start. No merge or deploy without explicit approval.**

## قواعد الطابور

- كل شريحة = فرع + PR مستقل جاهز للمراجعة. **لا PRs مكدّسة** (stacked).
- الشريحة التابعة لا تبدأ قبل **دمج** اعتمادياتها فعلاً على `main`، مع تسجيل `POST_MERGE_REVIEW: PASS`.
- **سياسة الدمج (D-14 المعدَّل، المالك 2026-10-14، لهذا الأفق فقط):**
  - **الـPRs منخفضة المخاطر تُدمج تلقائياً** بـ Squash بعد اجتماع أربعة شروط: CI أخضر بالكامل، ومراجعات ناجحة، ولا تعارض، ولا ملاحظة جوهرية مفتوحة. الإيقاع:
    1. فتح PR.
    2. إيصاله للأخضر.
    3. تسجيل `PRE_MERGE_REVIEW: PASS`.
    4. Squash merge.
    5. تسجيل Merge SHA و`POST_MERGE_REVIEW`.
    6. الانتقال تلقائياً للشريحة المصرّح بها التالية.
  - **موافقة المالك الصريحة قبل التنفيذ وقبل الدمج** لأي تغيير يمسّ: قاعدة البيانات، API، الصلاحيات، الأمن، عزل المستأجر، المحاسبة، المخزون.
- لا Deploy ولا Production.
- قبل أي PR فيه backend: تشغيل `php artisan test` كاملاً (CLAUDE.md).
- قبل أي PR فيه `web/` أو `storefront/`: `npm run build` + `npm test` للحزمة المعنية.
- هذا الأفق **لا يولّد أي قيد محاسبي**. يُذكر ذلك صراحةً في كل PR بدل جدول القيود.

## الطابور

| ID | المرحلة | الشريحة | النطاق | يلمس DB/API؟ | يعتمد على | الحالة |
|---|---|---|---|---|---|---|
| **VD-0** | H1-0 | Evidence & Architecture | وثائق فقط (PR #1472) | لا | — | **DONE** — مدموج `d5dfa16ec65e7b0cbb7d3adf833c54b77047208d` · POST_MERGE_REVIEW: PASS |
| **VD-1a** | H1-1 | عقد الهوية المرئية | `CommerceFacetVisualNormalizer` + `CommerceFacetVisualResolver` (PHP نقيّة) + سجلّا الأشكال والأحجام + إضافة مفاتيح `IconRegistry` (ثلاثي) + توائم TS + fixtures `facet-visual.json` و`facet-visual-inheritance.json` (حالة لكل خاصية: تخصيص خاصية واحدة لا يلغي وراثة البقية — D-08) + اختبارات وحدة | لا (كود نقيّ) | VD-0 معتمد | **DONE** — مدموج `8801af9`، `POST_MERGE_REVIEW: PASS`، تقرير `AWJ-VD-1A-IMPLEMENTATION-REPORT.md` |
| **VD-1b** | H1-1 | التخزين وAPI الإدارة | migration `commerce_facet_visuals` + نموذج `CommerceFacetVisual` + `PUT …/visual` (مساران) + `visual` في `GET facets` + حاوية `facet_visual` في الماسح (لمسارات المرجعية والحذف فقط، ومستبعدة من `liveUsageKeys()`) + عمود `version` ورمز `expected_version` الإلزامي (D-17: 428 و409 والإنشاء المتزامن، والإفراغ بدل الحذف ضد ABA) + قفل `storefront_media` في `delete()` والحفظ (D-16) + اختبارات: العزل · RBAC (المحاسب 403 على الهوية و200 على الاسم، staff/self_service 403، ضيف 401 — D-04) · 409/422 · cascade · منع حذف الوسيط · سباق الحذف/الحفظ (حتمي + pgsql باتصالين) · fresh migrate على SQLite وpgsql | **نعم** | VD-1a مدموج | **DONE** — مدموج `5a10930` (PR #1491، بدمج المالك)، `POST_MERGE_REVIEW: PASS — CI (sqlite + pgsql) green on main`. تقرير `AWJ-VD-1B-IMPLEMENTATION-REPORT.md` |
| **VD-1c** | H1-1 | الإسقاط العام والتقديم | `visual` في `meta.facets` (storefront.v1 فقط) + مسار `store/v1/media/facet-visuals/{visualId}/{mediaId}/{file}` + بروكسي storefront + فرع `facet-visuals` في `toRenderableMediaUrl()` يسبق النمط العام ويعيد `null` لغير الصالح (D-03) + شرط الظهور على قناة المتجر + **الاختبارات السلبية N1–N19 كاملة** (§3.8-و: التعطيل، الحذف، الاستبدال، 304 بعد التعطيل، المستأجر الأجنبي، الحقن، غير المشار إليه، الأصل والمسار، البروكسي لا يخزّن الفشل، لا روابط أصلية في `meta`، `commerce/v1` بلا تغيير) | **نعم** | VD-1b مدموج | **DONE** — مدموج `b1b7988` (PR #1499، بدمج المالك؛ قرارات المالك D1–D4)، `POST_MERGE_REVIEW: PASS — CI (sqlite + pgsql) and Storefront CI green on main`. تقرير `AWJ-VD-1C-IMPLEMENTATION-REPORT.md` |
| **VD-2** | H1-2 | محرك الأشكال والبلاطة | سجل هندسة الأشكال (CSS/polygon/SVG objectBoundingBox) + `FacetVisualTile` (web + storefront) + سلسلة السقوط + `@supports` + `IconPicker` + اختبارات vitest | لا | VD-1a مدموج | **DONE** — مدموج `d568bf6` (PR #1482، Squash)، `POST_MERGE_REVIEW: PASS`، تقرير `AWJ-VD-2-IMPLEMENTATION-REPORT.md` (قناع SVG بـdata URI بدل objectBoundingBox، وبلا `@supports` — التعليل في التقرير) |
| **VD-3** | H1-3 | محرر الإدارة | وفق `AWJ-VD-H1-VD3-EDITOR-UX-REQUIREMENTS.md`: محرر بثلاثة تبويبات + معاينة حيّة + وراثة/استرجاع لكل خاصية + منع التعديل بلا `commerce.manage` مع السبب + معالجة C4/C6/C7/C9 + الجوال + تحقق بصري (فاتح/داكن، عربي/إنجليزي، 4 عروض) | يستهلك | VD-1b + VD-2 مدموجان | **DONE** — مدموج `d6282888e26636eec698cadda1ad3880ae0eb5bf` (PR #1509، بتفويض المالك 2026-10-15)، `POST_MERGE_REVIEW: PASS — CI (sqlite + pgsql) and Web CI green on main (run 38672377636, 38672377674)`. تقرير `AWJ-VD-3-IMPLEMENTATION-REPORT.md` |
| **VD-4a** | H1-4 | عقد العرض والقوالب | حقول `discovery` الاختيارية (§3.7) + سجل القوالب (ثلاثي) + توسيع `data-sections.json` + إثبات التطابق البايتي للوثائق القديمة + فحص تعارض #1089/#853 | وثيقة العرض فقط | VD-1a مدموج | **DONE** — مدموج `c57f4be` (PR #1490، بدمج المالك)، `POST_MERGE_REVIEW: PASS — CI, Web CI and Storefront CI green on main`. تقرير `AWJ-VD-4A-IMPLEMENTATION-REPORT.md` |
| **VD-4b** | H1-4 | عارض المتجر | 5 تخطيطات + القوالب + الأعمدة لكل جهاز + الروابط القائمة + الوصولية + الأداء (lazy، srcset، بلا CLS) + بحث بصري + تحقق بصري RTL/LTR | يستهلك | VD-1c + VD-2 + VD-4a مدموجة | **DONE** — مدموج `f1e309e26ad02bed242e17ea537536cb912183c4` (PR #1508، بتفويض المالك 2026-10-15)، `POST_MERGE_REVIEW: PASS — CI (sqlite + pgsql) and Storefront CI green on main (runs 38670309241, 38670309191)`. تقرير `AWJ-VD-4B-IMPLEMENTATION-REPORT.md` |
| **VD-4c** | H1-4 | واجهة الباني | محرر إعدادات `discovery` في `DataSectionFields.tsx` + معاينة اللوحة | لا | VD-4a + VD-2 مدموجان | **DONE** — مدموج `2b7774721beab742dbb31b5b8233da08b802ca45` (PR #1507، بتفويض المالك 2026-10-15)، `POST_MERGE_REVIEW: PASS — CI (sqlite + pgsql) and Web CI green on main (runs 38667361465, 38667361473)`. تقرير `AWJ-VD-4C-IMPLEMENTATION-REPORT.md` |
| **VD-5** | H1-5 | الجودة والتكامل | Playwright بمتصفح فعلي: 390/768/1280/1440، عربي/إنجليزي، بيانات قديمة، صورة مفقودة، فشل تحميل، قيمة معطلة، قيمة بلا منتجات، أسماء عربية طويلة، الإدارة فاتح/داكن + المجموعة الكاملة PHP (sqlite+pgsql في CI) + web + storefront | لا | كل ما سبق | **DONE (بانتظار بوابة VD-6)** — نُفِّذ 2026-10-15 بتفويض المالك؛ تقرير `AWJ-VD-5-QA-REPORT.md` (+ `awj-vd-5-qa-evidence/`). إصلاحات مدموجة: #1521 `6b1d3a2` · #1525 `cf59e46` · #1526 `a86a78b` · #1527 `3f445a9` · #1528 `de2a13b` · #1530 `2f6569b` · #1529 `74cc76f` · #1533 `ed7f873` (بلاغ المالك). بوابات قرار مفتوحة G1–G7 (انظر التقرير §7). |
| **VD-6** | H1-6 | الإغلاق | التقرير النهائي + تحديث الحالة + backlog | لا | VD-5 | **READY-AT-GATE** — ينتظر اعتماد المالك بعد تقرير VD-5 |

## رسم الاعتماديات

```text
VD-0 ──► VD-1a ──┬──► VD-1b ──► VD-1c ──────────┐
                 ├──► VD-2 ─────┬──► VD-3 ◄─(1b) │
                 │              └──► VD-4c ◄─(4a)│
                 └──► VD-4a ─────────────────────┴──► VD-4b ──► VD-5 ──► VD-6
```

بعد دمج VD-1a، يمكن تشغيل **VD-1b وVD-2 وVD-4a بالتوازي** (ثلاثة PRs مستقلة، لا تتقاطع ملفاتها).

## تعريف الإنجاز لكل شريحة

- معايير القبول الخاصة بها متحقّقة بأدلة مرصودة.
- الاختبارات المرتبطة خضراء محلياً و**في CI على الـHead نفسه**.
- مراجعة ثلاثية (Implementer / Reviewer / AWJ Guardian).
- تقرير تنفيذ بصيغة `IMPLEMENTATION-REPORT-CONVENTION.md` في هذا المجلد: `AWJ-VD-<ID>-IMPLEMENTATION-REPORT.md`.
- تحديث هذا الطابور.

## Backlog مكتشف (خارج النطاق)

- `EnsureApplicationActive` غير مطبّق على مسارات الأبعاد ومساحة عمل Commerce (R14).
- حفظ وثائق العرض في المُخصِّص لا يقفل الوسيط، فيبقى عرضة لسباق الحذف نفسه (D-16، خارج النطاق).
- `StorefrontMediaApiTest › the library lists newest first … searches` يفشل على PostgreSQL **المحلي فقط** بـ`SQLSTATE[HY093]`.
  - السبب: `pdo_pgsql` في PHP 8.3.6 يسيء تحليل `LIKE … ESCAPE '\'` القائم بجوار المعاملات `?`.
  - يفشل بالطريقة نفسها من دون VD-1b، وmain أخضر عليه في CI.
  - خارج نطاق هذا الأفق بقرار المالك.
- لا واجهة لإعادة ترتيب قيم البُعد (C12).
- `setup.sh` (بيئة الاختبار المحلية) لا يطابق `ci.yml`: لا يثبّت `league/flysystem-aws-s3-v3`/`predis`/ParaTest، ولا يفعّل `bcmath`، ولا ينسخ `app/Mail` و`resources/views`. ظهر ذلك في VD-1a كفشل محلي غير مرتبط بالتغيير. **محلول** في `cf58c96` (AWJ-BACKEND-CI-03).
- توحيد اختيار الأيقونة المكرّر (`<select>` في 3 مواضع) على `IconPicker`.
- صور التصنيفات تُقدَّم بايتاتٍ خاماً مع EXIF (§2.3). يستحق نقلها لنمط المكتبة في أفق مستقل.
- `product_media` بلا فحص finfo ولا حدود أبعاد (`AWJ-UPLOAD-RELIABILITY-1` F4).
- الهويات المرئية في `commerce/v1` وتطبيق الجوال (D-05).
- صور وأيقونات شرائح التصفية (D-12). قوالب يحفظها التاجر (D-07). وضع المتجر الداكن (D-13).
