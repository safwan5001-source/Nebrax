# B8 — أساس سياسات المتجر (D-4): النتائج والمقترح

**التاريخ:** 2026-10-26 · **Base:** `origin/main@585691b97a0bd65b848ee0cf12d1e2430b28a8c7` · **الحالة:** تحليل وتوثيق فقط — **التنفيذ متوقف بانتظار اعتماد المالك** (القاعدة 7 في المهمة).
**النتيجة في سطر:** لا يوجد مصدر محتوى AWJ أصلي يحمل **نص** السياسات؛ الموجود سجلّ صفحات بلا محتوى. تقديم `GET store/v1/policies/{slug}` يتطلب تخزيناً/واجهة إدارة جديدة وقرارات منتج لم تُحسم ⇒ لم يُنفَّذ B8 ولم يُعلَّم X4 مكتملاً.

## 1. ما فُحص وما وُجد

| العنصر | الموجود | يكفي لـB8؟ |
|---|---|---|
| سجل صفحات المحتوى في وثيقة العرض | `StorefrontPresentationNormalizer::CONTENT_PAGE_SLUGS` = `about, contact, faq, shipping-policy, privacy-policy, returns-policy, terms-of-service`؛ `pages[]` = `{id, slug, title ≤ 80, enabled}` فقط (`normalizePages`، السطر ~1266) | **جزئي**: slug + عنوان + مفتاح نشر. **لا body** |
| تخزين الوثيقة | `storefront_presentations` (`draft_config` / `published_config` JSON) + `storefront_presentation_versions` + `…_version_revisions` | مناسب كوعاء، لكن لا حقل نص |
| نشر/تراجع/إصدارات | مسارات workspace: `PUT/POST commerce/workspace/storefronts/{id}/presentation[/publish|/versions…]` | موجود (لا يخدم النص لعدم وجوده) |
| القراءة العامة | `GET store/v1/storefront` يعيد اللقطة المنشورة (`presentation`) عبر `StorefrontPresentationService::publishedSnapshotForStorefront`، بمستأجر/متجر من `Host` (`ResolveStorefrontDomain`) | عزل مضيف ممتاز؛ لا سياسات |
| الواجهة | روابط التنقل تحلّ `content{slug}` إلى `/policies/{slug}` لأربع slugs + `contact` (`SERVED_CONTENT_SLUGS`)؛ صفحة `/policies/[slug]` ما زالت تقرأ Spree (`data/policies.ts`) | تحتاج مصدراً (X4 لاحقاً) |
| نموذج صفحات/CMS | لا `Page`/`Policy`/`Cms*` model؛ `CommerceProductContentBlock` للمنتج فقط | لا |
| منقّي HTML | لا مكتبة (HTMLPurifier/CommonMark/DOMPurify) في الخلفية ولا في تبعيات `storefront`/`web`؛ `strip_tags` في ZATCA فقط | **مفقود** — اعتماد جديد |
| endpoint سياسات | لا شيء في `routes/api_storefront.php` | مفقود |

**الخلاصة المقارنة مع D-4:** المتطلب (`GET store/v1/policies/{slug}` ⇒ HTML منقّى، 404 لغير المنشور) يملك ركائز العزل والنشر (Host، snapshot منشور، `enabled`)، لكن **ينقصه جوهره: نص السياسة نفسه، وطريقة كتابته، ومنقّي HTML**. إنشاؤه = تغيير مخطط أو عقد وثيقة + واجهة إدارة + اعتماد مكتبة ⇒ ضمن بنود التوقف.

## 2. المقترح الدقيق للاعتماد (خياران)

### الخيار A — توسيع `pages[]` في وثيقة العرض بحقل نص (**بلا جدول جديد**) — الموصى به
* **المخطط:** `pages[i]` يزداد بـ`body: {ar: string, en: string}` (Markdown مقيَّد، ≤ 20,000 حرف لكل لغة) و`title` يصبح `{ar,en}` أو يبقى نصاً واحداً (D-4b). كل شيء داخل JSON الموجود ⇒ **لا هجرة**.
* **الإدارة:** تعيد استعمال `PUT …/presentation` + publish + versions + RBAC القائم؛ يُعدَّل `normalizePages` (PHP) وتوأماه TS (`storefront/.../tokens.ts`، `web/.../tokens.ts`) — تغيير عقد وثيقة مُصنَّف «تغيير واجهة إدارة» فيحتاج موافقتك.
* **القراءة:** `GET store/v1/policies/{slug}` فقط؛ و**تُجرَّد `body` من استجابة `GET store/v1/storefront`** حتى لا تتضخم ولا تُسرَّب مسودات (يُفرض باختبار).
* **المزايا:** عزل مستأجر/متجر ونشر وتراجع وتدقيق موروثة؛ لا CMS موازٍ.
* **العيوب:** نص قانوني يتبع دورة نشر الوثيقة كلها (تغيير سياسة = نشر لقطة)؛ تضخم JSON (محدود بالسقف).

### الخيار B — جدول مستقل `storefront_policy_pages` + واجهة إدارة
* **المخطط:** `tenant_id, storefront_id, slug, locale, title, body_markdown, status(draft|published), published_at, version, updated_by` + فريد `(tenant_id, storefront_id, slug, locale)`؛ `CompanyWide`؛ `BaseModel`.
* **الإدارة:** `GET/PUT commerce/workspace/storefronts/{id}/policies/{slug}` + publish/unpublish؛ RBAC.
* **المزايا:** دورة نشر قانونية مستقلة وتدقيق أنظف. **العيوب:** هجرة + واجهة إدارة جديدة + نقطة تقاطع مع Customizer = أقرب إلى «CMS مكرر» (ما طلبتَ تجنّبه).

**التوصية: A**، بالقيود: Markdown فقط (لا HTML خام)، عربي+إنجليزي، تعطيل افتراضي (لا نص قانوني مُخترَع)، سقف 20k حرف.

## 3. تصميم endpoint (مشترك بين A وB)

* **المسار:** `GET /store/v1/policies/{slug}` ضمن مجموعة `ResolveStorefrontDomain` + `EnforcePublicApiRateLimit:unauth` (قراءة فقط، كبقية GET).
* **slug:** قائمة سماح `shipping-policy | privacy-policy | returns-policy | terms-of-service` فقط (`about/faq/contact` خارج النطاق حتى تُخدَّم).
* **الاستجابة 200:** `{ data: { slug, title, body_html, locale, updated_at }, meta: { request_id } }` عبر `PublicApiResponse`؛ `Cache-Control: no-store` مبدئياً (عزل المضيف أولاً).
* **404 موحّد** (نفس الجسم) لكل من: slug غير معروف، غير مفعَّل/غير منشور/نص فارغ، لا لقطة منشورة، لا متجر. لا تمييز بين الحالات ولا تسريب لأسباب داخلية؛ الأخطاء غير المتوقعة تمرّ عبر `PublicApiExceptionRenderer` (مغلف عام).
* **اللغة:** `ResolveCommerceLocale` (Accept-Language) مع رجوع للّغة الافتراضية؛ لا ترجمة آلية.
* **التنقية (دفاع على طبقتين):** Markdown→HTML بمحوّل يعطّل HTML الخام (`html_input=strip`، `allow_unsafe_links=false`) ثم مرشّح DOM بقائمة سماح (`h2–h4, p, ul, ol, li, strong, em, a[href https|mailto|tel + rel="noopener nofollow ugc"], br, blockquote`)؛ يُحجب `script/style/iframe/svg/form`، `on*`، `javascript:`/`data:`، `srcdoc`، الترميزات المتداخلة. **يتطلب اعتماد مكتبة** (`league/commonmark` مقترحة) أو محوّلاً مكتوباً ضيفاً.
* **الواجهة (X4 لاحقاً، خارج هذا الـPR):** تستهلك `body_html` المنقّى خادمياً فقط، وتخفي روابط السياسة عند 404.

## 4. الثوابت المطلوبة (تُختبر عند التنفيذ)

| الثابت | كيف يُفرض |
|---|---|
| عزل المستأجر/القناة | المستأجر والمتجر من `Host` فقط؛ لا معامل tenant/storefront؛ لقطة المتجر المحلول وحدها |
| منشور فقط | `enabled=true` + لقطة منشورة + نص غير فارغ؛ المسودات لا تُقرأ عبر `store/v1` أبداً |
| HTML آمن | تنقية الخادم عند كل قراءة (لا ثقة بالمخزَّن) + اختبار corpus هجمات XSS |
| لا تسريب أخطاء | 404 موحّد؛ الاستثناءات عبر المغلف العام |
| الإدارة (A) | صلاحية workspace القائمة للتعديل/النشر؛ عدم الصلاحية ⇒ 403؛ مستأجر آخر ⇒ 404 |

**الاختبارات المخطَّطة (PostgreSQL حيث يلزم):** عقد API (200/404، الحقول، الترويسات)؛ عزل: مستأجران بنفس الـslug، متجران لنفس المستأجر، انتحال `X-Forwarded-Host` بلا سر بوابة؛ منشور/مسودة/معطَّل/فارغ ⇒ 404 متطابق؛ XSS corpus؛ عدم وجود `body` في `GET store/v1/storefront`؛ RBAC الإدارة (دور بصلاحية/بدونها/مستأجر آخر)؛ تزامن نشر على PG؛ حدّ الحجم؛ توافق رجعي (استجابات `store/v1` القائمة بلا تغيير حرفياً).

## 5. القرارات المطلوبة (D-4a…D-4j)

| ID | السؤال | توصيتي |
|---|---|---|
| D-4a | A أم B؟ | **A** |
| D-4b | اللغات: ar+en لكل صفحة أم لغة واحدة؟ والعنوان لكل لغة؟ | ar+en، العنوان لكل لغة |
| D-4c | صيغة المحتوى: Markdown مقيَّد أم HTML مقيَّد؟ | Markdown |
| D-4d | من يحرّر؟ صلاحية Customizer القائمة أم صلاحية جديدة؟ | القائمة (`commerce.manage`) |
| D-4e | اقتران النشر: مع نشر الوثيقة (A) أم مستقل (B)؟ | مقبول مع A |
| D-4f | المحتوى الأولي: لا نص مُولَّد (404 + إخفاء الروابط) | لا نص مُخترَع |
| D-4g | نطاق الـslugs: الأربع فقط الآن؟ | الأربع |
| D-4h | اعتماد مكتبة تنقية/Markdown (`league/commonmark`) أم محوّل داخلي | المكتبة |
| D-4i | ترويسات التخزين المؤقت: `no-store` أم قصيرة مع `Vary: Host` | `no-store` مبدئياً |
| D-4j | سياسة الاحتفاظ/تدقيق تغييرات النص القانوني | الإصدارات القائمة تكفي (A) |

## 6. خطة التنفيذ بعد الاعتماد (شرائح صغيرة)

1. **B8-1** (باكند): توسيع `normalizePages` + توأما TS (عقد فقط) + تجريد `body` من `store/v1/storefront` + اختبارات الإدارة.
2. **B8-2** (باكند): `GET store/v1/policies/{slug}` + المنقّي + اختبارات العقد/العزل/XSS (PG).
3. **X4** (واجهة، لاحقاً): استبدال `data/policies.ts` وإخفاء الروابط عند 404 — **لا يُعلَّم مكتملاً قبل Deployed + Env-Verified**.
(تحرير النص في Customizer الويب شريحة منفصلة ضمن H5 ولا تدخل هنا.)

## 7. الحالة في المتتبّع (محدَّثة بصدق في هذا الـPR)
* **B8:** Blocked — تحليل مُسلَّم، التنفيذ متوقف بانتظار D-4a…D-4j. · **X4:** Blocked (لا يُعدّ مكتملاً). · **D-4:** Open.
* مزامنة ما دُمج: **X3 Merged** (#1753 · `585691b`)، **X6 Merged** (#1749 · `91bb82d`، #1750 · `4789b2e`) — مدموجتان وغير منشورتين/مُتحقَّق منهما بيئياً.

## 8. المخاطر
* ترك `/policies/*` على Spree يعني بقاء الصفحات القانونية تفشل (R-03) إلى حين B8-1/B8-2/X4.
* الخيار A يقرن نشر النص القانوني بنشر الوثيقة؛ إن كان هذا غير مقبولاً فB.
* اعتماد مكتبة جديدة يمسّ سلسلة التوريد (يُراجَع ويُثبَّت إصدارها).
* لم يُشغَّل أي بناء/اختبار (وثائق فقط).
