# AWJ-COMMERCE-VISUAL-DIMENSIONS-H1 — Task Queue

LAST_UPDATED: 2026-10-14
STATUS: **G0 CLOSED (owner, 2026-10-14): D-01..D-17 approved. VD-0 merged as `d5dfa16`. VD-1a in review. DB/API slices (VD-1b, VD-1c) still need a separate explicit owner approval before they start. No merge or deploy without explicit approval.**

## قواعد الطابور

- كل شريحة = فرع + PR مستقل جاهز للمراجعة. **لا PRs مكدّسة** (stacked).
- الشريحة التابعة لا تبدأ قبل **دمج** اعتمادياتها فعلاً على `main`، مع تسجيل `POST_MERGE_REVIEW: PASS`.
- **الدمج يحتاج موافقة المالك لكل PR** (القرار D-14). الإيقاع:
  1. فتح PR.
  2. إيصاله للأخضر.
  3. تسجيل `PRE_MERGE_REVIEW: PASS`.
  4. طلب الموافقة.
  5. الانتقال لشريحة **مستقلة** جاهزة أثناء الانتظار.
- لا Deploy ولا Production.
- قبل أي PR فيه backend: تشغيل `php artisan test` كاملاً (CLAUDE.md).
- قبل أي PR فيه `web/` أو `storefront/`: `npm run build` + `npm test` للحزمة المعنية.
- هذا الأفق **لا يولّد أي قيد محاسبي**. يُذكر ذلك صراحةً في كل PR بدل جدول القيود.

## الطابور

| ID | المرحلة | الشريحة | النطاق | يلمس DB/API؟ | يعتمد على | الحالة |
|---|---|---|---|---|---|---|
| **VD-0** | H1-0 | Evidence & Architecture | وثائق فقط (PR #1472) | لا | — | **DONE** — مدموج `d5dfa16ec65e7b0cbb7d3adf833c54b77047208d` · POST_MERGE_REVIEW: PASS |
| **VD-1a** | H1-1 | عقد الهوية المرئية | `CommerceFacetVisualNormalizer` + `CommerceFacetVisualResolver` (PHP نقيّة) + سجلّا الأشكال والأحجام + إضافة مفاتيح `IconRegistry` (ثلاثي) + توائم TS + fixtures `facet-visual.json` و`facet-visual-inheritance.json` (حالة لكل خاصية: تخصيص خاصية واحدة لا يلغي وراثة البقية — D-08) + اختبارات وحدة | لا (كود نقيّ) | VD-0 معتمد | **IN REVIEW** — PR مستقل، تقرير `AWJ-VD-1A-IMPLEMENTATION-REPORT.md` |
| **VD-1b** | H1-1 | التخزين وAPI الإدارة | migration `commerce_facet_visuals` + نموذج `CommerceFacetVisual` + `PUT …/visual` (مساران) + `visual` في `GET facets` + حاوية `facet_visual` في الماسح (لمسارات المرجعية والحذف فقط، ومستبعدة من `liveUsageKeys()`) + عمود `version` ورمز `expected_version` الإلزامي (D-17: 428 و409 والإنشاء المتزامن، والإفراغ بدل الحذف ضد ABA) + قفل `storefront_media` في `delete()` والحفظ (D-16) + اختبارات: العزل · RBAC (المحاسب 403 على الهوية و200 على الاسم، staff/self_service 403، ضيف 401 — D-04) · 409/422 · cascade · منع حذف الوسيط · سباق الحذف/الحفظ (حتمي + pgsql باتصالين) · fresh migrate على SQLite وpgsql | **نعم** | VD-1a مدموج | BLOCKED — يحتاج موافقة منفصلة على DB/API |
| **VD-1c** | H1-1 | الإسقاط العام والتقديم | `visual` في `meta.facets` (storefront.v1 فقط) + مسار `store/v1/media/facet-visuals/{visualId}/{mediaId}/{file}` + بروكسي storefront + فرع `facet-visuals` في `toRenderableMediaUrl()` يسبق النمط العام ويعيد `null` لغير الصالح (D-03) + شرط الظهور على قناة المتجر + **الاختبارات السلبية N1–N19 كاملة** (§3.8-و: التعطيل، الحذف، الاستبدال، 304 بعد التعطيل، المستأجر الأجنبي، الحقن، غير المشار إليه، الأصل والمسار، البروكسي لا يخزّن الفشل، لا روابط أصلية في `meta`، `commerce/v1` بلا تغيير) | **نعم** | VD-1b مدموج | BLOCKED — يحتاج موافقة منفصلة على DB/API |
| **VD-2** | H1-2 | محرك الأشكال والبلاطة | سجل هندسة الأشكال (CSS/polygon/SVG objectBoundingBox) + `FacetVisualTile` (web + storefront) + سلسلة السقوط + `@supports` + `IconPicker` + اختبارات vitest | لا | VD-1a مدموج | BLOCKED |
| **VD-3** | H1-3 | محرر الإدارة | وفق `AWJ-VD-H1-VD3-EDITOR-UX-REQUIREMENTS.md`: محرر بثلاثة تبويبات + معاينة حيّة + وراثة/استرجاع لكل خاصية + منع التعديل بلا `commerce.manage` مع السبب + معالجة C4/C6/C7/C9 + الجوال + تحقق بصري (فاتح/داكن، عربي/إنجليزي، 4 عروض) | يستهلك | VD-1b + VD-2 مدموجان | BLOCKED |
| **VD-4a** | H1-4 | عقد العرض والقوالب | حقول `discovery` الاختيارية (§3.7) + سجل القوالب (ثلاثي) + توسيع `data-sections.json` + إثبات التطابق البايتي للوثائق القديمة + فحص تعارض #1089/#853 | وثيقة العرض فقط | VD-1a مدموج | BLOCKED — يضيف حقولاً لعقد `store/v1/storefront` العام، فيحتاج تأكيد المالك |
| **VD-4b** | H1-4 | عارض المتجر | 5 تخطيطات + القوالب + الأعمدة لكل جهاز + الروابط القائمة + الوصولية + الأداء (lazy، srcset، بلا CLS) + بحث بصري + تحقق بصري RTL/LTR | يستهلك | VD-1c + VD-2 + VD-4a مدموجة | BLOCKED |
| **VD-4c** | H1-4 | واجهة الباني | محرر إعدادات `discovery` في `DataSectionFields.tsx` + معاينة اللوحة | لا | VD-4a + VD-2 مدموجان | BLOCKED |
| **VD-5** | H1-5 | الجودة والتكامل | Playwright بمتصفح فعلي: 390/768/1280/1440، عربي/إنجليزي، بيانات قديمة، صورة مفقودة، فشل تحميل، قيمة معطلة، قيمة بلا منتجات، أسماء عربية طويلة، الإدارة فاتح/داكن + المجموعة الكاملة PHP (sqlite+pgsql في CI) + web + storefront | لا | كل ما سبق | BLOCKED |
| **VD-6** | H1-6 | الإغلاق | التقرير النهائي + تحديث الحالة + backlog | لا | VD-5 | BLOCKED |

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
- لا واجهة لإعادة ترتيب قيم البُعد (C12).
- `setup.sh` (بيئة الاختبار المحلية) لا يطابق `ci.yml`: لا يثبّت `league/flysystem-aws-s3-v3`/`predis`/ParaTest، ولا يفعّل `bcmath`، ولا ينسخ `app/Mail` و`resources/views`. ظهر ذلك في VD-1a كفشل محلي غير مرتبط بالتغيير.
- توحيد اختيار الأيقونة المكرّر (`<select>` في 3 مواضع) على `IconPicker`.
- صور التصنيفات تُقدَّم بايتاتٍ خاماً مع EXIF (§2.3). يستحق نقلها لنمط المكتبة في أفق مستقل.
- `product_media` بلا فحص finfo ولا حدود أبعاد (`AWJ-UPLOAD-RELIABILITY-1` F4).
- الهويات المرئية في `commerce/v1` وتطبيق الجوال (D-05).
- صور وأيقونات شرائح التصفية (D-12). قوالب يحفظها التاجر (D-07). وضع المتجر الداكن (D-13).
