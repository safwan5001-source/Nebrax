<?php

namespace App\Services\Commerce;

use App\Models\StorefrontPresentation;
use App\Models\StorefrontPublishedMedia;
use Illuminate\Support\Str;

/**
 * CUST-HV V2c — مجموعة معرّفات الوسائط التي تشير إليها الوثيقة **المنشورة** لكل
 * متجر (V0 §7.8). تُعاد بناؤها كاملةً مع **كل** كتابةٍ لـ`published_config`
 * (نشر فوري، نشر مجدول، النشر المتوافق القديم) من نقطة اختناقٍ واحدة — حدث
 * `saved` على `StorefrontPresentation` — فلا مسار نشرٍ جديد يستطيع نسيانها، وتجري
 * ضمن معاملة النشر نفسها فلا تُرى مجموعةٌ لا تطابق الرأس المنشور.
 *
 * مسار التسليم العام يقرأ هذه المجموعة بصفٍّ واحدٍ بفهرس: «لا مسح JSON لكل طلب».
 * إلغاء النشر/استبداله بوثيقةٍ بلا مرجع يُفرغ المجموعة فيصير المعرّف 404 فوراً
 * على أصل الخادم (والبروكسي يلتزم بنافذة المراجعة 5 دقائق — AMEND-16).
 */
final class StorefrontPublishedMediaIndex
{
    public function __construct(private readonly StorefrontMediaReferenceScanner $scanner) {}

    public function rebuild(StorefrontPresentation $presentation): void
    {
        $config = is_array($presentation->published_config) ? $presentation->published_config : [];

        $ids = [];
        foreach ($this->scanner->extract($config) as [$mediaId]) {
            $ids[$mediaId] = true;
        }
        // معرّفٌ غير UUID (مدخلٌ عبثيّ داخل الوثيقة) لا يدخل المجموعة أبداً.
        $ids = array_filter(array_keys($ids), static fn (string $id): bool => Str::isUuid($id));

        StorefrontPublishedMedia::query()
            ->where('storefront_id', $presentation->storefront_id)
            ->delete();

        foreach ($ids as $mediaId) {
            StorefrontPublishedMedia::query()->create([
                'tenant_id' => $presentation->tenant_id,
                'storefront_id' => $presentation->storefront_id,
                'media_id' => $mediaId,
            ]);
        }
    }

    public function isPublished(string $storefrontId, string $mediaId): bool
    {
        return StorefrontPublishedMedia::query()
            ->where('storefront_id', $storefrontId)
            ->where('media_id', $mediaId)
            ->exists();
    }
}
