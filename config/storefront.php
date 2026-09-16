<?php

/**
 * COM-7-P2B — بوابة الثقة بين خادم Next.js storefront وLaravel.
 *
 * `store/v1/*` قراءة عامة مجهولة يصلها أي متصفح مباشرة، فحسم Tenant عبر
 * `$request->getHost()` وحده يرى دومًا نطاق Laravel الخاص (مثل api.awj.app)
 * لا نطاق المتجر الذي زاره العميل الحقيقي — لأن خادم Next.js (لا المتصفح) هو
 * من يستدعي هذا الـ API، والاتصال الفعلي يستهدف نطاق Laravel نفسه.
 *
 * يحلّ `ResolveStorefrontDomain` هذا عبر ترويسة `X-Storefront-Forwarded-Host`
 * التي يضيفها خادم Next.js وحده (Host الحقيقي الذي وصل إلى خادمه من الزائر —
 * موثوقٌ بنفس درجة $request->getHost() لو استُقبل الطلب مباشرة)، **لكن فقط**
 * حين تُرفَق بترويسة `X-Storefront-Gateway-Secret` مطابقة للسرّ هنا — وإلا
 * تُتجاهل الترويسة كلياً ويُستخدم `$request->getHost()` كالمعتاد (سلوك P2A
 * الأصلي دون تغيير). بلا هذه البوابة، أي متصفح يستطيع إرسال الترويسة مباشرة
 * لانتحال أي متجر — الفحص هنا هو ما يمنع ذلك، لا مجرد وجود الترويسة.
 *
 * السرّ **خادم-فقط**: متغيّر بيئة واحد يُضبط في كلا الطرفين (Laravel
 * وNext.js)، لا يُشتقّ من أي مدخل عميل، ولا يُعرَض في أي استجابة JSON. تركه
 * فارغاً (الافتراض) يعطّل آلية إعادة التوجيه بالكامل بأمان — لا نصف تفعيل.
 *
 * ═══════════════════════════════════════════════════════════════
 *  `managed_base_domain` — النطاق الأساسي لمتاجر Commerce المُدارة من AWJ
 *  (COM-STORE-PROVISION-1)
 * ═══════════════════════════════════════════════════════════════
 *  عقدٌ منفصلٌ تماماً عن `config/tenancy.php` (`AWJ_TENANT_BASE_DOMAIN`):
 *  ذاك نطاق ERP الفرعي `{tenant}.awjdev.xyz`/`{tenant}.awj.app`، وهذا نطاق
 *  المتجر العام `{tenant}.store.awjdev.xyz`/`{tenant}.store.awj.app` —
 *  حدّا توجيه/أمان مختلفان تماماً، لا يجوز خلطهما.
 *
 *  القيمة **نطاقٌ أساسي فقط** (hostname بلا مخطط/مسار/نجمة wildcard)؛
 *  `App\Support\ManagedStorefrontHostname` هو المستهلك الوحيد، ويطبّعها عبر
 *  `HostnameNormalizer` نفسه قبل استعمالها — لا تكرار منطق تطبيع هنا.
 *  تغييرها لاحقاً إلى `store.awj.app` كافٍ وحده لتوليد
 *  `{tenant}.store.awj.app` بلا أي تعديل كودٍ في منطق العمل.
 *
 *  الافتراض أدناه هو **عقد الإنتاج المستقبلي** (نفس نمط `AWJ_TENANT_BASE_DOMAIN`
 *  الذي افتراضه `awj.app`) — بيئة AWJ الحالية المؤقتة تُشغِّل القيمة الفعلية
 *  `store.awjdev.xyz` عبر متغيّر البيئة `AWJ_STOREFRONT_BASE_DOMAIN` (يُضبط في
 *  Railway، لا يُعدَّل هنا).
 */
return [
    'gateway_secret' => env('STOREFRONT_GATEWAY_SECRET'),

    'managed_base_domain' => env('AWJ_STOREFRONT_BASE_DOMAIN', 'store.awj.app'),
];
