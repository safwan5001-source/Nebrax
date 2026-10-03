<?php

namespace App\Http\Resources;

use App\Services\Commerce\StorefrontOfferView;

/**
 * CUST-H4-6 — تمثيل عرضٍ للقراءة. دالتان ثابتتان لا `JsonResource` لأن مصدرهما
 * `StorefrontOfferView` (نتيجة تقييم) لا نموذجٌ واحد.
 *
 * **العام**: قائمة سماح ضيقة للعروض الحيّة فقط — لا سبب حجب ولا حالة تهيئة ولا
 * تكلفة/هامش/مخزون خام (نفس صنف البيانات العلنية في `store/v1/products`).
 * الأسعار `{amount_minor, currency}` بنفس شكل `price` في `StorefrontProductResource`.
 * **لا نسبة ولا وفر ولا سعر مشطوب مُصرَّح به** — الرقمان فقط (مؤجَّل لـ H4-7).
 *
 * **الإداري**: يضيف حقول التهيئة (`is_active`/`position`/`created_at`...) و`evaluation`
 * بسبب الحجب، ليعرف التاجر أي مرشّحاتٍ تُعرض فعلاً الآن (§23.7 من العقد).
 */
final class StorefrontOfferResource
{
    /** @return array<string, mixed> */
    public static function public(StorefrontOfferView $view): array
    {
        $thumbnail = $view->thumbnail !== null
            ? StorefrontProductResource::mediaPayload([$view->thumbnail], null)[0]['url']
            : null;

        return [
            'id' => $view->offer->id,
            'product_id' => $view->offer->product_id,
            'name' => $view->product->name,
            'name_en' => $view->product->name_en,
            'thumbnail_url' => $thumbnail,
            'reference_price' => ['amount_minor' => $view->referencePrice, 'currency' => $view->currency],
            'offer_price' => ['amount_minor' => $view->offerPrice, 'currency' => $view->currency],
            'starts_at' => $view->offer->starts_at?->toIso8601String(),
            'ends_at' => $view->offer->ends_at?->toIso8601String(),
        ];
    }

    /** @return array<string, mixed> */
    public static function workspace(StorefrontOfferView $view): array
    {
        $offer = $view->offer;
        $product = $view->product;

        return [
            'id' => $offer->id,
            'product_id' => $offer->product_id,
            'product' => $product === null ? null : [
                'id' => $product->id,
                'name' => $product->name,
                'name_en' => $product->name_en,
                'thumbnail_url' => $view->thumbnail !== null
                    ? StorefrontProductResource::commerceMediaPayload([$view->thumbnail])[0]['url']
                    : null,
                'is_variant_managed' => $product->isVariantManaged(),
            ],
            'starts_at' => $offer->starts_at?->toIso8601String(),
            'ends_at' => $offer->ends_at?->toIso8601String(),
            'is_active' => $offer->is_active,
            'position' => $offer->position,
            'evaluation' => [
                'is_live' => $view->live,
                'reason' => $view->reason,
                'reference_price' => $view->live ? ['amount_minor' => $view->referencePrice, 'currency' => $view->currency] : null,
                'offer_price' => $view->live ? ['amount_minor' => $view->offerPrice, 'currency' => $view->currency] : null,
            ],
            'created_at' => $offer->created_at?->toIso8601String(),
            'updated_at' => $offer->updated_at?->toIso8601String(),
        ];
    }
}
