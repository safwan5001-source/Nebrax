<?php

namespace App\Services\Commerce;

use App\Models\StorefrontMedia;
use App\Models\StorefrontMediaDerivative;
use InvalidArgumentException;

/**
 * CUST-HV V6b-2 — يحوّل `MediaRef` إلى حدود لمعان **قابلة للإثبات** لبوّابة التباين (V0 §3.2.1).
 *
 * **قراءةٌ فقط** (كبوّابة الوسائط: لا توليد من مسار النشر — AMEND-9). يعيد `null` = «غير مُثبَت»
 * في كل حالةٍ لا يوجد فيها دليلٌ كامل: أصلٌ غائب/غير `active`/غير جاهز، تحويلٌ فاسد، مشتقّاتٌ
 * غائبة أو قيد المعالجة أو فاشلة، أو أي صفٍّ بلا دليلٍ صالح (قديم لم يُملأ، شفّاف، نسخةٌ مجهولة).
 *
 * الإطار الافتراضي ⇒ دليل الأصل (أعرض درجةٍ مخدومة)؛ الإطار المحوَّل ⇒ اتحاد أدلة **كل** صفوف
 * مشتقّات ذلك الاستخدام (AMEND-8: ما يُعرَض لا الأصل). الحدود الراجعة موسَّعةٌ بهامش الترميز
 * ({@see StorefrontMediaPixelEvidence::bounds()}).
 */
class StorefrontMediaContrastEvidence
{
    /** @var array<string, array{min:list<int>,max:list<int>}|null> */
    private array $memo = [];

    /**
     * @param  array<string,mixed>  $ref  `MediaRef` مطبَّع
     * @return array{min:list<int>,max:list<int>}|null
     */
    public function boundsFor(array $ref): ?array
    {
        $key = (string) json_encode($ref);

        return array_key_exists($key, $this->memo) ? $this->memo[$key] : ($this->memo[$key] = $this->resolve($ref));
    }

    /**
     * Whether the (tenant-scoped, active) asset of a `MediaRef` is animated. Same scoped lookup as the evidence itself, so a
     * foreign or unknown id is simply `false` (the ownership gate rejects it separately). P3-A-06: the global background is
     * still-only and an animation's later frames have no pixel evidence.
     *
     * @param  array<string,mixed>  $ref
     */
    public function isAnimated(array $ref): bool
    {
        $id = $ref['mediaId'] ?? null;
        if (! is_string($id)) {
            return false;
        }
        $asset = StorefrontMedia::query()->whereKey($id)->where('state', StorefrontMedia::STATE_ACTIVE)->first();

        return $asset !== null && $asset->isAnimated();
    }

    /**
     * @param  array<string,mixed>  $ref
     * @return array{min:list<int>,max:list<int>}|null
     */
    private function resolve(array $ref): ?array
    {
        $id = $ref['mediaId'] ?? null;
        if (! is_string($id)) {
            return null;
        }
        /** @var StorefrontMedia|null $asset */
        $asset = StorefrontMedia::query()->whereKey($id)->where('state', StorefrontMedia::STATE_ACTIVE)->first();
        if ($asset === null || ! $asset->isReady()) {
            return null;
        }

        try {
            $transform = StorefrontMediaTransform::fromInput([
                'crop' => $ref['crop'] ?? null,
                'rotate' => $ref['rotate'] ?? 0,
                'focal' => $ref['focal'] ?? null,
                'fit' => $ref['fit'] ?? 'cover',
            ]);
        } catch (InvalidArgumentException) {
            return null;
        }

        return $this->boundsForUsage($asset, $transform);
    }

    /**
     * حدود لمعان استخدامٍ (أصل + تحويل) — للقراءة فقط. تُستعمل أيضاً من مساحة العمل (V6b-4a) لتعرض نتيجة
     * التباين الحيّة بالقيم ذاتها التي تحكم بها بوّابة النشر.
     *
     * @return array{min:list<int>,max:list<int>}|null
     */
    public function boundsForUsage(StorefrontMedia $asset, StorefrontMediaTransform $transform): ?array
    {
        if ($asset->state !== StorefrontMedia::STATE_ACTIVE || ! $asset->isReady()) {
            return null;
        }

        // AWJ-ANIMATED-MEDIA P1 — الحركة: الإطارات اللاحقة غير مقيسة (لا دليل بكسل لها، ولا نخمّنه من الإطار الأول).
        // الأسوأ حالةً هو الإثبات الوحيد الصادق: أي بكسلٍ في أي إطار قد يكون أي لون ⇒ المدى الكامل [0..255] لكل قناة.
        // الخوارزمية القائمة ذاتها (لا مسار ثانٍ) تُثبت النص إذن فقط إن بلغ تباينه الحدّ أمام الأسود والأبيض معاً —
        // أي بوجود طبقة تعتيم/تلوين كافية فعلاً — فلا نص مقروء بالحظ فوق إطارٍ لاحق. وبلا طبقة كافية: «غير مُثبَت».
        if ($asset->isAnimated()) {
            return ['min' => [0, 0, 0], 'max' => [255, 255, 255]];
        }

        if ($transform->isDefault()) {
            return StorefrontMediaPixelEvidence::bounds(is_array($asset->region_luminance) ? $asset->region_luminance : []);
        }

        $rows = StorefrontMediaDerivative::query()
            ->where('media_id', $asset->id)
            ->where('usage_key', $transform->usageKey($asset->id))
            ->get();
        if ($rows->isEmpty()) {
            return null;
        }

        $min = [255, 255, 255];
        $max = [0, 0, 0];
        foreach ($rows as $row) {
            if ($row->state !== StorefrontMediaDerivative::STATE_READY) {
                return null;
            }
            $bounds = StorefrontMediaPixelEvidence::bounds(is_array($row->region_luminance) ? $row->region_luminance : []);
            if ($bounds === null) {
                return null;
            }
            for ($i = 0; $i < 3; $i++) {
                $min[$i] = min($min[$i], $bounds['min'][$i]);
                $max[$i] = max($max[$i], $bounds['max'][$i]);
            }
        }

        return ['min' => $min, 'max' => $max];
    }
}
