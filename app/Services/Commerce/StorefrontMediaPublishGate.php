<?php

namespace App\Services\Commerce;

use App\Models\StorefrontMedia;
use InvalidArgumentException;

/**
 * CUST-HV V2c — بوابة النشر لمراجع الوسائط (V0 §7.8 + AMEND-5/9/10/14/21).
 * تُستدعى من `StorefrontPresentationPublishValidator` على الوثيقة **المطبَّعة**
 * في كل مسارات النشر (فوري، قديم، جدولة، تنفيذ مجدول)، فلا بوابة موازية.
 *
 * **قراءةٌ فقط، دائماً.** لا توليد مشتقّات هنا ولا في أي مسارٍ يبدأ من النشر
 * (AMEND-9، ثابتٌ لا تغيّره أي أوركستريشن): مرجعٌ مشتقّه `pending`/`failed`/غائب
 * يُرفض بـ422 على مساره، وبرمزٍ ثابتٍ تترجمه الواجهة.
 *
 * لكل `MediaRef` في الوثيقة (يُلتقط حيثما وُجد `mediaId` — الماسح لا يفترض
 * موضعاً):
 *  1. الأصل موجود لهذا المستأجر و`active`            → `media_missing`
 *  2. السلّم الأساسي `ready`                          → `media_not_ready`
 *  3. alt لكل لغةٍ تُعرض (ar، en) ما لم يكن `decorative` — أولويةٌ: alt الاستخدام
 *     للّغة، ثم alt الأصل للّغة؛ **لا يحلّ العربي محلّ الإنجليزي أبداً** → `alt_required_ar|en`
 *  4. التحويل صالح                                    → `transform_invalid`
 *  5. كل مشتقّات التحويل `ready`                      → `derivative_not_ready` | `derivative_failed`
 * مفتاح الخطأ مسار الحقل (`homepage.sections.0.design.background.media.alt.en`).
 */
class StorefrontMediaPublishGate
{
    private const LOCALES = ['ar', 'en'];

    public function __construct(
        private readonly StorefrontMediaReferenceScanner $scanner,
        private readonly StorefrontMediaDerivativeService $derivatives,
    ) {}

    /**
     * @param  array<string,mixed>  $normalized
     * @return array<string, array{code: string, message: string}>
     */
    public function errors(array $normalized): array
    {
        $refs = $this->scanner->extractRefs($normalized);
        if ($refs === []) {
            return [];
        }

        /** @var array<string,StorefrontMedia|null> $assets */
        $assets = StorefrontMedia::query()
            ->whereIn('id', array_values(array_unique(array_column(array_column($refs, 'ref'), 'mediaId'))))
            ->where('state', StorefrontMedia::STATE_ACTIVE)
            ->get()
            ->keyBy('id')
            ->all();

        $errors = [];
        foreach ($refs as ['path' => $path, 'ref' => $ref]) {
            $asset = $assets[$ref['mediaId']] ?? null;

            if ($asset === null) {
                $errors["{$path}.mediaId"] = ['code' => 'media_missing', 'message' => 'الصورة المختارة لم تعد موجودة في مكتبة الوسائط.'];

                continue;
            }
            if (! $asset->isReady()) {
                $errors["{$path}.mediaId"] = ['code' => 'media_not_ready', 'message' => 'لم تكتمل معالجة هذه الصورة بعد، أو فشلت. أعد المحاولة من مكتبة الوسائط.'];

                continue;
            }

            foreach ($this->altErrors($path, $ref, $asset) as $key => $error) {
                $errors[$key] = $error;
            }

            $this->transformErrors($errors, $path, $ref, $asset);
        }

        return $errors;
    }

    /**
     * @param  array<string,mixed>  $ref
     * @return array<string, array{code: string, message: string}>
     */
    private function altErrors(string $path, array $ref, StorefrontMedia $asset): array
    {
        if (($ref['decorative'] ?? false) === true) {
            return []; // `alt=""` صحيحٌ لكل اللغات (AMEND-10).
        }

        $own = is_array($ref['alt'] ?? null) ? $ref['alt'] : [];
        $errors = [];
        foreach (self::LOCALES as $locale) {
            $override = $own[$locale] ?? null;
            $library = $locale === 'ar' ? $asset->alt_ar : $asset->alt_en;
            $has = (is_string($override) && trim($override) !== '') || (is_string($library) && trim($library) !== '');
            if (! $has) {
                $errors["{$path}.alt.{$locale}"] = [
                    'code' => "alt_required_{$locale}",
                    'message' => $locale === 'ar'
                        ? 'النص البديل بالعربية مطلوب لهذه الصورة (أو اجعلها زخرفية).'
                        : 'النص البديل بالإنجليزية مطلوب لهذه الصورة (أو اجعلها زخرفية).',
                ];
            }
        }

        return $errors;
    }

    /**
     * @param  array<string, array{code: string, message: string}>  $errors
     * @param  array<string,mixed>  $ref
     */
    private function transformErrors(array &$errors, string $path, array $ref, StorefrontMedia $asset): void
    {
        try {
            $transform = StorefrontMediaTransform::fromInput([
                'crop' => $ref['crop'] ?? null,
                'rotate' => $ref['rotate'] ?? 0,
                'focal' => $ref['focal'] ?? null,
                'fit' => $ref['fit'] ?? 'cover',
            ]);
        } catch (InvalidArgumentException) {
            $errors["{$path}.crop"] = ['code' => 'transform_invalid', 'message' => 'إعدادات قصّ الصورة غير صالحة. أعد ضبط الإطار.'];

            return;
        }

        if ($transform->isDefault()) {
            return; // يخدمه السلّم الأساسي (جاهزٌ أعلاه).
        }

        $status = $this->derivatives->status($asset, $transform);
        if ($status['state'] === StorefrontMediaDerivativeService::USAGE_READY) {
            return;
        }

        $failed = $status['state'] === StorefrontMediaDerivativeService::USAGE_FAILED;
        $errors["{$path}.crop"] = [
            'code' => $failed ? 'derivative_failed' : 'derivative_not_ready',
            'message' => $failed
                ? 'فشل تجهيز إطار هذه الصورة. أعد المحاولة من محرّر الصورة قبل النشر.'
                : 'إطار هذه الصورة لم يُجهَّز بعد. انتظر اكتمال المعالجة ثم انشر.',
        ];
    }
}
