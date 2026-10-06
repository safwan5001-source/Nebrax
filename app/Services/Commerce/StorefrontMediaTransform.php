<?php

namespace App\Services\Commerce;

use InvalidArgumentException;

/**
 * CUST-HV V2b — تحويل استخدامٍ على وسيط (V0 §7.5/§7.6): قصّ/تدوير/نقطة تركيز/
 * ملاءمة/تكبير، **مُطبَّعاً** تطبيعاً حتمياً يجمع المدخلات المتساوية بضجيج
 * الفاصلة العائمة في مفتاحٍ واحد ويفرّق الأطر المختلفة فعلاً.
 *
 * **هوية التحويل (AMEND-2/AMEND-11):** ترتيب حقولٍ ثابت —
 * `crop(x,y,w,h → 4 منازل ; aspect) | rotate | focal(int,int) | fit | zoom(2 منزلتان)`.
 * `zoom` مُدرَج صراحةً لا مشتقّاً من مستطيل القصّ: استخدامان بمستطيلٍ واحد
 * وتكبيرَين مختلفَين إطاران مختلفان ويجب ألّا يتصادما على مفتاحٍ واحد.
 *
 * **الإطار الافتراضي** (لا قصّ، لا تدوير، لا تركيز مغاير للمنتصف، `cover`)
 * لا مشتقّات له — تخدمه المتغيّرات الأساسية على الأصل. أي فرقٍ في أيٍّ منها
 * (حتى التركيز/الملاءمة) يجعله تحويلاً بمفتاحٍ مستقل، حرفياً كما في V0.
 *
 * المفتاح لا يُخزَّن في وثيقة المظهر أبداً (§3.2 — `MediaRef` لا يتغيّر): يشتقّه
 * الخادم/المُصيِّر من حقول `MediaRef` نفسها.
 */
final class StorefrontMediaTransform
{
    /** @var array<string, float|null> نسبة العرض/الارتفاع المقفولة (`null` = حرّ مقفول على مستطيل القصّ). */
    public const ASPECTS = [
        '16:5' => 3.2,
        '3:1' => 3.0,
        '16:9' => 16 / 9,
        '4:3' => 4 / 3,
        '1:1' => 1.0,
        '4:5' => 0.8,
        'free-locked' => null,
    ];

    public const FITS = ['cover', 'contain'];
    public const ROTATIONS = [0, 90, 180, 270];
    public const MIN_ZOOM = 1.0;
    public const MAX_ZOOM = 4.0;
    /** أصغر ضلعٍ لمستطيل القصّ (جزءٌ من الصورة) — دونه إطارٌ بلا معنى. */
    public const MIN_CROP_SIDE = 0.01;

    private const TOP_LEVEL = ['crop', 'rotate', 'focal', 'fit'];
    private const CROP_KEYS = ['x', 'y', 'w', 'h', 'aspect', 'zoom'];

    /**
     * @param  array{x:float,y:float,w:float,h:float,aspect:string}|null  $crop
     * @param  array{x:int,y:int}|null  $focal
     */
    private function __construct(
        public readonly ?array $crop,
        public readonly int $rotate,
        public readonly ?array $focal,
        public readonly string $fit,
        public readonly float $zoom,
    ) {}

    /**
     * يتحقق ويطبّع. أي مخالفةٍ → `InvalidArgumentException` برسالةٍ تحمل مسار الحقل
     * (`crop.zoom`) ليربطها المتحكّم بخطأ تحققٍ بذلك المسار.
     *
     * @throws InvalidArgumentException
     */
    public static function fromInput(mixed $raw): self
    {
        if ($raw === null || $raw === []) {
            $raw = [];
        }
        if (! is_array($raw) || array_is_list($raw) && $raw !== []) {
            throw new InvalidArgumentException('transform: يجب أن يكون كائناً.');
        }

        foreach (array_keys($raw) as $key) {
            if (! in_array($key, self::TOP_LEVEL, true)) {
                throw new InvalidArgumentException("transform.{$key}: حقل غير مسموح.");
            }
        }

        $rotate = $raw['rotate'] ?? 0;
        if (! is_int($rotate) && ! (is_float($rotate) && floor($rotate) === $rotate)) {
            throw new InvalidArgumentException('transform.rotate: يجب أن يكون 0 أو 90 أو 180 أو 270.');
        }
        $rotate = (int) $rotate;
        if (! in_array($rotate, self::ROTATIONS, true)) {
            throw new InvalidArgumentException('transform.rotate: يجب أن يكون 0 أو 90 أو 180 أو 270.');
        }

        $fit = $raw['fit'] ?? 'cover';
        if (! is_string($fit) || ! in_array($fit, self::FITS, true)) {
            throw new InvalidArgumentException('transform.fit: يجب أن يكون cover أو contain.');
        }

        $focal = null;
        if (array_key_exists('focal', $raw) && $raw['focal'] !== null) {
            $focal = self::focal($raw['focal']);
        }

        $crop = null;
        $zoom = 1.0;
        if (array_key_exists('crop', $raw) && $raw['crop'] !== null) {
            [$crop, $zoom] = self::crop($raw['crop']);
        }

        return new self($crop, $rotate, $focal, $fit, $zoom);
    }

    /** @return array{x:int,y:int}|null المنتصف (50،50) هو الافتراضي فيُطبَّع إلى `null`. */
    private static function focal(mixed $raw): ?array
    {
        if (! is_array($raw)) {
            throw new InvalidArgumentException('transform.focal: يجب أن يكون كائناً {x,y}.');
        }
        foreach (array_keys($raw) as $key) {
            if (! in_array($key, ['x', 'y'], true)) {
                throw new InvalidArgumentException("transform.focal.{$key}: حقل غير مسموح.");
            }
        }
        $out = [];
        foreach (['x', 'y'] as $axis) {
            $value = $raw[$axis] ?? null;
            if (! is_int($value) && ! is_float($value)) {
                throw new InvalidArgumentException("transform.focal.{$axis}: رقم من 0 إلى 100.");
            }
            if (! is_finite((float) $value) || $value < 0 || $value > 100) {
                throw new InvalidArgumentException("transform.focal.{$axis}: رقم من 0 إلى 100.");
            }
            $out[$axis] = (int) round((float) $value);
        }

        return $out === ['x' => 50, 'y' => 50] ? null : $out;
    }

    /** @return array{0:array{x:float,y:float,w:float,h:float,aspect:string},1:float} */
    private static function crop(mixed $raw): array
    {
        if (! is_array($raw)) {
            throw new InvalidArgumentException('transform.crop: يجب أن يكون كائناً.');
        }
        foreach (array_keys($raw) as $key) {
            if (! in_array($key, self::CROP_KEYS, true)) {
                throw new InvalidArgumentException("transform.crop.{$key}: حقل غير مسموح.");
            }
        }

        $rect = [];
        foreach (['x', 'y', 'w', 'h'] as $side) {
            $value = $raw[$side] ?? null;
            if ((! is_int($value) && ! is_float($value)) || ! is_finite((float) $value)) {
                throw new InvalidArgumentException("transform.crop.{$side}: رقم من 0 إلى 1.");
            }
            $rect[$side] = round((float) $value, 4);
        }
        foreach (['x', 'y'] as $side) {
            if ($rect[$side] < 0.0 || $rect[$side] > 1.0) {
                throw new InvalidArgumentException("transform.crop.{$side}: رقم من 0 إلى 1.");
            }
        }
        foreach (['w', 'h'] as $side) {
            if ($rect[$side] < self::MIN_CROP_SIDE || $rect[$side] > 1.0) {
                throw new InvalidArgumentException("transform.crop.{$side}: رقم من 0.01 إلى 1.");
            }
        }
        if ($rect['x'] + $rect['w'] > 1.0 + 1e-9) {
            throw new InvalidArgumentException('transform.crop.w: يتجاوز المستطيل حدّ الصورة.');
        }
        if ($rect['y'] + $rect['h'] > 1.0 + 1e-9) {
            throw new InvalidArgumentException('transform.crop.h: يتجاوز المستطيل حدّ الصورة.');
        }

        $aspect = $raw['aspect'] ?? null;
        if (! is_string($aspect) || ! array_key_exists($aspect, self::ASPECTS)) {
            throw new InvalidArgumentException('transform.crop.aspect: نسبة غير مدعومة.');
        }

        $zoom = $raw['zoom'] ?? 1;
        if ((! is_int($zoom) && ! is_float($zoom)) || ! is_finite((float) $zoom)
            || $zoom < self::MIN_ZOOM || $zoom > self::MAX_ZOOM) {
            throw new InvalidArgumentException('transform.crop.zoom: رقم من 1 إلى 4.');
        }

        return [$rect + ['aspect' => $aspect], round((float) $zoom, 2)];
    }

    public function isDefault(): bool
    {
        return $this->crop === null
            && $this->rotate === 0
            && $this->focal === null
            && $this->fit === 'cover'
            && $this->zoom === 1.0;
    }

    /** السلسلة المطبَّعة بترتيب حقولٍ ثابت — مدخل المفتاحَين. */
    public function normalized(): string
    {
        $crop = $this->crop === null
            ? '-'
            : sprintf(
                '%s,%s,%s,%s;%s',
                number_format($this->crop['x'], 4, '.', ''),
                number_format($this->crop['y'], 4, '.', ''),
                number_format($this->crop['w'], 4, '.', ''),
                number_format($this->crop['h'], 4, '.', ''),
                $this->crop['aspect'],
            );
        $focal = $this->focal === null ? '-' : $this->focal['x'].','.$this->focal['y'];

        return sprintf(
            'crop=%s|rotate=%d|focal=%s|fit=%s|zoom=%s',
            $crop,
            $this->rotate,
            $focal,
            $this->fit,
            number_format($this->zoom, 2, '.', ''),
        );
    }

    /** `sha256(mediaId:normalized:width:format)[0..32]` — V0 §7.5 حرفياً. */
    public function key(string $mediaId, int $width, string $format): string
    {
        return substr(hash('sha256', $mediaId.':'.$this->normalized().':'.$width.':'.$format), 0, 32);
    }

    /** هوية الاستخدام وحدها (بلا عرضٍ/صيغة): تجمع صفوف الاستخدام الواحد. */
    public function usageKey(string $mediaId): string
    {
        return substr(hash('sha256', $mediaId.':'.$this->normalized()), 0, 32);
    }

    /** الشكل المطبَّع المخزَّن على الصف (يُعاد منه المُصيِّر دون إعادة إدخال). */
    public function toArray(): array
    {
        return [
            'crop' => $this->crop === null ? null : $this->crop + ['zoom' => $this->zoom],
            'rotate' => $this->rotate,
            'focal' => $this->focal,
            'fit' => $this->fit,
        ];
    }

    /** @param array<string,mixed> $stored ناتج `toArray()` */
    public static function fromStored(array $stored): self
    {
        return self::fromInput([
            'crop' => $stored['crop'] ?? null,
            'rotate' => $stored['rotate'] ?? 0,
            'focal' => $stored['focal'] ?? null,
            'fit' => $stored['fit'] ?? 'cover',
        ]);
    }
}
