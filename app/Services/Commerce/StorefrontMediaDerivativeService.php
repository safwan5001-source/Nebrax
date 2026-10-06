<?php

namespace App\Services\Commerce;

use App\Models\StorefrontMedia;
use App\Models\StorefrontMediaDerivative;
use App\Services\R2StorageService;
use App\Tenancy\TenantContext;
use Aws\Exception\AwsException;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\URL;
use Illuminate\Support\Str;
use Throwable;

/**
 * CUST-HV V2b — مشتقّات التحويل لوسائط المُخصِّص: توليدٌ محدود الوحدة، حالةٌ
 * نهائية مضمونة، وتحقّقٌ للقراءة (V0 §7.5 + AMEND-21).
 *
 * ## الأوركستريشن المختار (وإثباته)
 *
 * بيئة AWJ الإنتاجية بلا `schedule:run` ولا cron ولا عامل طابور حقيقي
 * (`QUEUE_CONNECTION=sync`) — V0 §7.5 قاعدة 4. لذا:
 *
 * 1. **وحدة العمل = استخدامٌ واحد في طلبٍ واحد:** `ensure()` يفكّ الأصل مرةً
 *    واحدة ويُصيِّر حتى 8 ملفات (4 عروض × صيغتان). حدٌّ بالبناء (قاعدة 3) —
 *    لا "ولِّد كل ما تحتاجه الوثيقة" في طلبٍ واحد. وثيقةٌ كبيرة = N طلبٍ
 *    متتابع من المحرِّر (استمرارٌ يقوده الطلب، بلا اعتماد على بنية غير
 *    مضمونة)؛ كلٌّ منها يبلغ حالةً نهائية قبل أن يردّ.
 * 2. **لا `pending` دائم (قاعدة 1 و5):** كل صفٍّ يحمل عقد إيجارٍ قصيراً
 *    (`claimed_at`). `pending` أقدم من المدّة يُقرأ `failed(interrupted)`
 *    ويستعيده طلبٌ لاحق — فانقطاع الطلب (مهلة/OOM/إعادة تشغيل) لا يترك استخداماً
 *    عالقاً؛ يصير فاشلاً قابلاً لإعادة المحاولة بنقرة. والمطالبة ذرّية
 *    (UPDATE شرطي) فطلبان متزامنان على استخدامٍ واحد لا يولّدان مرتين.
 * 3. **النشر قراءةٌ فقط (قاعدة 2):** `status()` لا يكتب ولا يولّد أبداً؛ هو
 *    ما تستعمله بوابة النشر (V2c). لا مسار توليدٍ عند النشر.
 *
 * ## الهوية والعزل
 * المستأجر من `TenantContext` عبر `R2StorageService`/نطاق `BaseModel`؛ لا مفتاح
 * ولا بادئة من المستدعي. ملفات R2: `…/storefront-media/{media}/{transformKey}.{fmt}`.
 */
class StorefrontMediaDerivativeService
{
    public const FORMATS = [StorefrontMediaVariantGenerator::FORMAT_WEBP, StorefrontMediaVariantGenerator::FORMAT_JPG];

    public const USAGE_ABSENT = 'absent';
    public const USAGE_PROCESSING = 'processing';
    public const USAGE_READY = 'ready';
    public const USAGE_FAILED = 'failed';

    public function __construct(
        private readonly R2StorageService $r2,
        private readonly StorefrontMediaVariantGenerator $generator,
        private readonly StorefrontMediaService $media,
        private readonly TenantContext $tenant,
    ) {}

    /** @return list<int> */
    public function nominalWidths(): array
    {
        $widths = array_values(array_unique(array_map('intval', (array) config('storefront_media.derivative_widths', [480, 768, 1280, 1920]))));
        sort($widths);

        return $widths;
    }

    /**
     * يضمن وصول الاستخدام إلى حالةٍ نهائية (ready | failed) أو يعيد `processing`
     * فقط حين يملك طلبٌ آخر حيٌّ إيجارَ التوليد الآن.
     *
     * @return array<string,mixed> انظر `status()`
     *
     * @throws StorefrontMediaException
     */
    public function ensure(StorefrontMedia $media, StorefrontMediaTransform $transform, bool $retry = false): array
    {
        if (! $this->media->uploadsEnabled()) {
            throw StorefrontMediaException::storageNotEnabled();
        }
        if (! $media->isActive()) {
            throw new StorefrontMediaException('media_not_active', 'الوسيط محذوف.', 409);
        }
        if (! $media->isReady()) {
            throw new StorefrontMediaException('media_not_ready', 'لم تكتمل معالجة الصورة بعد. انتظر ثم أعد المحاولة.', 409);
        }
        if ($transform->isDefault()) {
            throw new StorefrontMediaException(
                'transform_is_default',
                'الإطار الافتراضي لا يحتاج مشتقّات؛ يُخدَم من المتغيّرات الأساسية.',
            );
        }

        $usageKey = $transform->usageKey($media->id);
        $this->assertWithinBounds($media, $usageKey);

        $mine = $this->materialiseRows($media, $transform, $usageKey);
        $mine = array_merge($mine, $this->claimReclaimable($media, $usageKey, $retry, array_keys($mine)));

        if ($mine !== []) {
            $this->generate($media, $transform, $mine);
        }

        return $this->status($media, $transform);
    }

    /**
     * حالة الاستخدام الآن — **قراءةٌ بحتة**: لا كتابة ولا توليد (بوابة النشر V2c).
     *
     * @return array{
     *   media_id:string, usage_key:string, state:string, retryable:bool, error_code:string|null,
     *   files:list<array{width:int,format:string,transform_key:string,state:string,error_code:string|null,rendered_width:int|null,rendered_height:int|null,bytes:int|null}>
     * }
     */
    public function status(StorefrontMedia $media, StorefrontMediaTransform $transform): array
    {
        $usageKey = $transform->usageKey($media->id);
        $rows = StorefrontMediaDerivative::query()
            ->where('media_id', $media->id)
            ->where('usage_key', $usageKey)
            ->orderBy('width')
            ->orderBy('format')
            ->get();

        $expected = count($this->nominalWidths()) * count(self::FORMATS);
        $files = [];
        $failed = null;
        $processing = false;
        $ready = 0;

        foreach ($rows as $row) {
            [$state, $error] = $this->effectiveState($row);
            $files[] = [
                'width' => $row->width,
                'format' => $row->format,
                'transform_key' => $row->transform_key,
                'state' => $state,
                'error_code' => $state === StorefrontMediaDerivative::STATE_FAILED ? $error : null,
                'rendered_width' => $state === StorefrontMediaDerivative::STATE_READY ? $row->rendered_width : null,
                'rendered_height' => $state === StorefrontMediaDerivative::STATE_READY ? $row->rendered_height : null,
                'bytes' => $state === StorefrontMediaDerivative::STATE_READY ? $row->bytes : null,
            ];
            if ($state === StorefrontMediaDerivative::STATE_FAILED) {
                $failed ??= $error;
            } elseif ($state === StorefrontMediaDerivative::STATE_PENDING) {
                $processing = true;
            } else {
                $ready++;
            }
        }

        $state = match (true) {
            $rows->isEmpty() => self::USAGE_ABSENT,
            $failed !== null => self::USAGE_FAILED,
            $processing || $ready < $expected => self::USAGE_PROCESSING,
            default => self::USAGE_READY,
        };

        return [
            'media_id' => $media->id,
            'usage_key' => $usageKey,
            'state' => $state,
            'retryable' => $state === self::USAGE_FAILED,
            'error_code' => $failed,
            'files' => $files,
        ];
    }

    /** رابط موقَّع قصير الأجل لملفٍ مُشتقٍّ جاهز (معاينة مساحة العمل — V4). */
    public function signedUrl(StorefrontMediaDerivative $derivative): ?string
    {
        if ($derivative->state !== StorefrontMediaDerivative::STATE_READY) {
            return null;
        }
        $tenantId = $this->tenant->id();
        if ($tenantId === null) {
            return null;
        }

        return URL::temporarySignedRoute(
            'commerce.workspace.storefront-media.derivative',
            now()->addMinutes((int) config('storefront_media.signed_url_minutes', 20)),
            [
                'media' => $derivative->media_id,
                'tenant' => $tenantId,
                'file' => StorefrontMediaDerivative::fileName($derivative->transform_key, $derivative->format),
            ],
        );
    }

    /**
     * @return mixed مجرى البايتات من R2
     *
     * @throws StorefrontMediaException
     */
    public function read(StorefrontMediaDerivative $derivative)
    {
        try {
            return $this->r2->get(StorefrontMedia::R2_DOMAIN, $derivative->media_id, $derivative->storage_key);
        } catch (Throwable $e) {
            report($e);
            throw StorefrontMediaException::storageUnavailable();
        }
    }

    // ───────────────────────────── internals ─────────────────────────────

    /** @return array{0:string,1:string|null} الحالة الفعلية مع قراءة الإيجار المنتهي فشلاً. */
    private function effectiveState(StorefrontMediaDerivative $row): array
    {
        if ($row->state === StorefrontMediaDerivative::STATE_PENDING && $this->leaseExpired($row->claimed_at)) {
            return [StorefrontMediaDerivative::STATE_FAILED, 'interrupted'];
        }

        return [$row->state, $row->error_code];
    }

    private function leaseExpired(?\DateTimeInterface $claimedAt): bool
    {
        if ($claimedAt === null) {
            return true;
        }

        return $claimedAt->getTimestamp() < now()->subSeconds((int) config('storefront_media.derivative_lease_seconds', 120))->getTimestamp();
    }

    private function assertWithinBounds(StorefrontMedia $media, string $usageKey): void
    {
        $known = StorefrontMediaDerivative::query()
            ->where('media_id', $media->id)
            ->where('usage_key', $usageKey)
            ->exists();
        if ($known) {
            return;
        }

        $usages = StorefrontMediaDerivative::query()->where('media_id', $media->id)->distinct()->count('usage_key');
        if ($usages >= (int) config('storefront_media.max_derivative_usages_per_media', 200)) {
            throw new StorefrontMediaException(
                'derivative_limit_reached',
                'بلغت هذه الصورة الحد الأقصى من الأطر المخصَّصة. أعد استخدام إطارٍ قائم.',
            );
        }

        $rows = StorefrontMediaDerivative::query()->count();
        if ($rows + count($this->nominalWidths()) * count(self::FORMATS) > (int) config('storefront_media.max_derivative_rows_per_tenant', 4000)) {
            throw new StorefrontMediaException(
                'derivative_quota_exceeded',
                'تجاوزت حصة مشتقّات الصور المسموحة. أزل أطراً غير مستخدمة ثم أعد المحاولة.',
            );
        }
    }

    /**
     * ينشئ صفوف الاستخدام الناقصة (كلٌّ `pending` ومُطالَبٌ بها من هذا الطلب).
     * سباقٌ على الفهرس الفريد يعني أن طلباً آخر أنشأها وهو مالكها.
     *
     * @return array<string,StorefrontMediaDerivative> الصفوف التي أنشأها هذا الطلب، بمفتاح الهوية
     */
    private function materialiseRows(StorefrontMedia $media, StorefrontMediaTransform $transform, string $usageKey): array
    {
        $existing = StorefrontMediaDerivative::query()
            ->where('media_id', $media->id)
            ->where('usage_key', $usageKey)
            ->get()
            ->keyBy(fn (StorefrontMediaDerivative $r): string => $this->identity($r->width, $r->format));

        $created = [];
        foreach ($this->nominalWidths() as $width) {
            foreach (self::FORMATS as $format) {
                $id = $this->identity($width, $format);
                if ($existing->has($id)) {
                    continue;
                }
                $key = $transform->key($media->id, $width, $format);
                try {
                    $created[$id] = StorefrontMediaDerivative::query()->create([
                        'id' => (string) Str::uuid(),
                        'tenant_id' => $media->tenant_id,
                        'media_id' => $media->id,
                        'usage_key' => $usageKey,
                        'transform_key' => $key,
                        'transform' => $transform->toArray(),
                        'width' => $width,
                        'format' => $format,
                        'storage_key' => StorefrontMediaDerivative::fileName($key, $format),
                        'state' => StorefrontMediaDerivative::STATE_PENDING,
                        'attempts' => 1,
                        'claimed_at' => now(),
                    ]);
                } catch (QueryException) {
                    // سبقَنا طلبٌ متزامنٌ إلى الفهرس الفريد: الصفّ له وإيجاره سارٍ.
                }
            }
        }

        return $created;
    }

    /**
     * يطالب ذرّياً بالصفوف القابلة للاسترداد: `pending` بإيجارٍ منتهٍ دائماً،
     * و`failed` عند `retry` فقط (فلا حلقة إعادة محاولةٍ ساخنة بلا طلبٍ صريح).
     * `UPDATE` شرطيٌّ لكل صف — طلبان متزامنان لا يطالبان بالصفّ نفسه.
     *
     * @param  list<string>  $alreadyMine
     * @return array<string,StorefrontMediaDerivative>
     */
    private function claimReclaimable(StorefrontMedia $media, string $usageKey, bool $retry, array $alreadyMine): array
    {
        $cutoff = now()->subSeconds((int) config('storefront_media.derivative_lease_seconds', 120));
        $claimed = [];

        $rows = StorefrontMediaDerivative::query()
            ->where('media_id', $media->id)
            ->where('usage_key', $usageKey)
            ->whereIn('state', [StorefrontMediaDerivative::STATE_PENDING, StorefrontMediaDerivative::STATE_FAILED])
            ->get();

        foreach ($rows as $row) {
            $id = $this->identity($row->width, $row->format);
            if (in_array($id, $alreadyMine, true)) {
                continue;
            }

            $won = StorefrontMediaDerivative::query()
                ->where('id', $row->id)
                ->where(function ($q) use ($retry, $cutoff): void {
                    $q->where(function ($stale) use ($cutoff): void {
                        $stale->where('state', StorefrontMediaDerivative::STATE_PENDING)
                            ->where(function ($lease) use ($cutoff): void {
                                $lease->whereNull('claimed_at')->orWhere('claimed_at', '<', $cutoff);
                            });
                    });
                    if ($retry) {
                        $q->orWhere('state', StorefrontMediaDerivative::STATE_FAILED);
                    }
                })
                ->update([
                    'state' => StorefrontMediaDerivative::STATE_PENDING,
                    'claimed_at' => now(),
                    'error_code' => null,
                    'attempts' => $row->attempts + 1,
                    'updated_at' => now(),
                ]);

            if ($won === 1) {
                $claimed[$id] = $row->refresh();
            }
        }

        return $claimed;
    }

    /**
     * يُصيِّر ويخزّن الصفوف المُطالَب بها. أي استثناءٍ يُنهي كل ما لم يبلغ حالةً
     * نهائية `failed` برمزٍ ثابت — لا يخرج هذا الدالة وصفٌّ مُطالَبٌ به `pending`
     * إلا إن انقطعت العملية نفسها (فيحميه الإيجار).
     *
     * @param  array<string,StorefrontMediaDerivative>  $mine
     */
    private function generate(StorefrontMedia $media, StorefrontMediaTransform $transform, array $mine): void
    {
        $temp = tempnam(sys_get_temp_dir(), 'sfd');
        $stored = [];
        $written = [];
        $settled = [];

        try {
            if ($temp === false) {
                throw StorefrontMediaException::storageUnavailable();
            }
            $body = $this->r2->get(StorefrontMedia::R2_DOMAIN, $media->id, $media->storage_key);
            file_put_contents($temp, (string) $body);
            unset($body);

            // نفس حارس كلفة الفكّ عند الرفع (N-1): تدوير المستخدم — أو اتجاه EXIF —
            // يضيف نسخةً مدوَّرةً في الذاكرة فيُحتسب بالعامل الأعلى. فشله فشلٌ
            // نهائيٌّ برمزٍ ثابت لا استثناءٌ يُسقط العامل.
            $rotated = $transform->rotate !== 0
                || ($media->mime === 'image/jpeg' && StorefrontMediaOrientation::read($temp) !== 1);
            $this->media->assertDecodable((int) $media->width, (int) $media->height, $rotated ? 6 : 1);

            $widths = array_values(array_unique(array_map(static fn (StorefrontMediaDerivative $r): int => $r->width, $mine)));

            $stats = $this->generator->renderTransform($temp, $transform, $widths, function (int $width, string $format, string $bytes, string $mime, int $renderedWidth, int $renderedHeight) use ($media, $mine, &$stored, &$written, &$settled): void {
                $id = $this->identity($width, $format);
                $row = $mine[$id] ?? null;
                if ($row === null) {
                    return; // ملفٌ لا يخصّ هذا الطلب (يملكه طلبٌ آخر أو جاهزٌ مسبقاً).
                }

                try {
                    $this->r2->put(StorefrontMedia::R2_DOMAIN, $media->id, $row->storage_key, $bytes, $mime);
                    $stored[] = $row->storage_key;
                    $written[$id] = true;
                    $row->forceFill([
                        'rendered_width' => $renderedWidth,
                        'rendered_height' => $renderedHeight,
                        'bytes' => strlen($bytes),
                    ]);
                } catch (Throwable $e) {
                    $this->fail($row, $this->failureCode($e));
                    $settled[$id] = true;
                    $this->report($e);
                }
            });

            foreach ($mine as $id => $row) {
                if (isset($settled[$id]) || ! isset($written[$id])) {
                    continue;
                }
                $row->forceFill([
                    'avg_luminance' => $stats['avg_luminance'],
                    'dominant_colour' => $stats['dominant_colour'],
                    'state' => StorefrontMediaDerivative::STATE_READY,
                    'error_code' => null,
                    'claimed_at' => null,
                    'generated_at' => now(),
                ])->save();
                $settled[$id] = true;
            }
        } catch (Throwable $e) {
            $code = $this->failureCode($e);
            foreach ($mine as $id => $row) {
                if (isset($settled[$id])) {
                    continue;
                }
                if (in_array($row->storage_key, $stored, true)) {
                    $this->deleteQuietly($media, $row->storage_key);
                }
                $this->fail($row, $code);
                $settled[$id] = true;
            }
            $this->report($e);
        } finally {
            if (is_string($temp)) {
                @unlink($temp);
            }
        }

        // احتياطٌ نهائي: صفٌّ مُطالَبٌ به لم يبلغ حالةً نهائية (مسارٌ لم يُتوقَّع)
        // يصير فاشلاً صريحاً بدل أن ينتظر انتهاء الإيجار.
        foreach ($mine as $id => $row) {
            if (! isset($settled[$id])) {
                $this->fail($row, 'processing_failed');
            }
        }
    }

    private function fail(StorefrontMediaDerivative $row, string $code): void
    {
        $row->forceFill([
            'state' => StorefrontMediaDerivative::STATE_FAILED,
            'error_code' => $code,
            'claimed_at' => null,
        ])->save();
    }

    private function deleteQuietly(StorefrontMedia $media, string $file): void
    {
        try {
            $this->r2->delete(StorefrontMedia::R2_DOMAIN, $media->id, $file);
        } catch (Throwable) {
            // أفضل جهد: المصالِح (V2c) يزيل ما تبقّى بالبادئة.
        }
    }

    private function identity(int $width, string $format): string
    {
        return $width.'.'.$format;
    }

    /** رمزٌ ثابت تترجمه الواجهة؛ لا نص استثناءٍ يخرج أبداً. */
    private function failureCode(Throwable $e): string
    {
        return match (true) {
            $e instanceof StorefrontMediaException => $e->errorCode,
            $e instanceof \Intervention\Image\Interfaces\ExceptionInterface => 'image_unreadable',
            $e instanceof AwsException, $e instanceof \RuntimeException => 'storage_unavailable',
            default => 'processing_failed',
        };
    }

    private function report(Throwable $e): void
    {
        if (! $e instanceof StorefrontMediaException) {
            report($e);
        }
    }
}
