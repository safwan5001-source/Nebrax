<?php

namespace App\Support;

/**
 * بذرة (seam) حلّ اسم المضيف إلى عناوين IP — يتيح للاختبارات حقن مُحلِّل حتميّ
 * فلا تعتمد على DNS العام، ولا يُضعَّف تحقّق SSRF في الإنتاج لتسهيل الاختبار.
 */
interface WebhookHostResolver
{
    /**
     * يحلّ اسم المضيف إلى قائمة عناوين IP (IPv4/IPv6). يعيد مصفوفة فارغة إذا
     * تعذّر الحلّ. المضيف الذي هو عنوان IP حرفيّ يُعاد كما هو (يتحقّق منه المتحقّق).
     *
     * @return list<string>
     */
    public function resolve(string $host): array;
}
