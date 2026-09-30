<?php

/**
 * MOBILE-PREVIEW-7 — تهيئة تبادل QR/الرابط العميق لمعاينة App Builder.
 *
 * `deep_link_host` مضيفٌ **مخصَّص للمعاينة فقط**، منفصل عمداً عن
 * `kDeepLinkHost` في `mobile/lib/deeplink/deep_link_resolver.dart` (الخاصّ
 * بتنقّل التشغيل الإنتاجي داخل التطبيق). الفصل مقصود: تطبيق المعاينة
 * (`main_device_preview.dart`) مسارٌ Dart مستقلّ تماماً عن رمز التشغيل
 * الإنتاجي (`main.dart`)، فمنحه نطاقاً فرعياً مستقلاً يمنع أي التباسٍ بين
 * مَن يملك التحقّق من الروابط العميقة لكلّ مضيف — أبسط من مصفوفة `apps`
 * متعددة التطبيقات على نطاق واحد (كلا النطاقين اليوم بديلٌ مؤقّت تحت
 * `.example`؛ لا نطاقٌ حقيقيٌّ مُوثَّق بعد — بوابة تشغيلية صريحة، انظر تقرير
 * التنفيذ).
 */
return [
    'deep_link_host' => env('PREVIEW_DEEP_LINK_HOST', 'preview.awj-runtime-proof.example'),
];
