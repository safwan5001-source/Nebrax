<?php

namespace App\Services;

use App\Models\Branch;
use App\Models\DeliveryPlatformProfile;
use App\Models\DeliveryPlatformProfileVersion as Version;
use App\Models\DeliveryPlatformVersionOverride as Override;
use App\Models\SalesChannel;
use App\Models\User;
use App\Support\DeliveryPlatformCatalog;
use App\Tenancy\TenantContext;
use Carbon\CarbonInterface;
use DomainException;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;

/**
 * DLV-FOUNDATION-1 — طبقة إعداد منصات التوصيل: إنشاء/تعديل/حلّ تاريخي.
 *
 * **لا أثر مالي ولا مخزني ولا دفع**: لا تلمس `LedgerService` ولا `PaymentService`
 * ولا `InvoiceService` ولا POS. `collection_mode` بيانات تُسجَّل فقط.
 *
 * كل تعديل = نسخة إلحاقية جديدة في معاملة واحدة بعد قفل صف الملف، تحمل لقطة
 * كاملة من تجاوزات الفروع (المنسوخة كما هي أو المعدَّلة). تعديل بلا فرق فعلي
 * لا ينتج نسخة (idempotent). الحلّ بمعرّف نسخة ثابت المعنى مهما تغيّر بعده.
 *
 * أخطاء العمل تُرمى `RuntimeException` (تتحوّل إلى 422 في المتحكّم)؛ `DomainException`
 * القادمة من حرّاس النماذج تُحوَّل إليها كي لا تتسرّب 500.
 */
final class DeliveryPlatformConfigService
{
    public function __construct(private readonly TenantContext $tenantContext)
    {
    }

    /**
     * @param  array<string, mixed>  $input  platform_key, ?sales_channel_id, ?collection_mode,
     *                                       ?external_reference_policy, ?display_name, ?display_name_en,
     *                                       ?logo_asset_key, ?is_active, ?branch_overrides, ?change_reason
     */
    public function create(array $input, ?User $actor = null): DeliveryPlatformProfile
    {
        $this->requireTenant();

        $platformKey = (string) ($input['platform_key'] ?? '');
        $catalog = DeliveryPlatformCatalog::get($platformKey);
        if ($catalog === null) {
            throw new RuntimeException('منصة التوصيل غير معروفة.');
        }

        return $this->guarded(fn () => DB::transaction(function () use ($input, $actor, $platformKey, $catalog) {
            if (DeliveryPlatformProfile::query()->where('platform_key', $platformKey)->lockForUpdate()->exists()) {
                throw new RuntimeException('ملف هذه المنصة موجود مسبقاً للمؤسسة.');
            }

            $channel = $this->resolveChannelForCreate($platformKey, $catalog, $input['sales_channel_id'] ?? null);

            $profile = DeliveryPlatformProfile::create([
                'sales_channel_id' => $channel->id,
                'platform_key' => $platformKey,
                'is_active' => (bool) ($input['is_active'] ?? true),
            ]);

            $overrides = $this->normalizeOverrides($input['branch_overrides'] ?? [], $actor);
            $this->appendVersion($profile, 1, [
                'collection_mode' => $input['collection_mode'] ?? Version::COLLECTION_MERCHANT,
                'external_reference_policy' => $input['external_reference_policy'] ?? Version::REFERENCE_OPTIONAL,
                'display_name' => $this->nonEmpty($input['display_name'] ?? null) ?? $catalog['name'],
                'display_name_en' => $this->nonEmpty($input['display_name_en'] ?? null) ?? $catalog['name_en'],
                'logo_asset_key' => $this->nonEmpty($input['logo_asset_key'] ?? null),
                'is_active' => $profile->is_active,
            ], $overrides, $input['change_reason'] ?? null, $actor);

            return $profile->fresh();
        }));
    }

    /**
     * إنشاء/تفعيل **متكرر الأمان**: يعيد الملف القائم دون نسخة جديدة إن لم يتعارض الطلب
     * مع إعداده الحالي (الحقول الغائبة أو null = بلا رأي)، ويُنشئه إن لم يوجد. تعارض صريح
     * (قيمة مختلفة أو قناة أخرى) يُرفض ويُوجَّه إلى التعديل (PUT) — لا تغيير صامت.
     * إعادة المحاولة بعد استجابة ملتبسة (أو سباق على الإنشاء) آمنة.
     *
     * @param  array<string, mixed>  $input
     * @return array{0: DeliveryPlatformProfile, 1: bool} [الملف، هل أُنشئ الآن]
     */
    public function ensure(array $input, ?User $actor = null): array
    {
        $this->requireTenant();
        $key = (string) ($input['platform_key'] ?? '');
        if (! DeliveryPlatformCatalog::exists($key)) {
            throw new RuntimeException('منصة التوصيل غير معروفة.');
        }

        $existing = DeliveryPlatformProfile::query()->where('platform_key', $key)->first();
        if ($existing === null) {
            try {
                return [$this->create($input, $actor), true];
            } catch (RuntimeException $e) {
                // سباق: ملف المنصة أُنشئ بين الفحص والإدراج — يُعامَل كمتكرر إن لم يتعارض.
                $existing = DeliveryPlatformProfile::query()->where('platform_key', $key)->first();
                if ($existing === null) {
                    throw $e;
                }
            }
        }

        $this->assertCompatibleWithExisting($existing, $input, $actor);

        return [$existing, false];
    }

    /** @param array<string, mixed> $input */
    private function assertCompatibleWithExisting(DeliveryPlatformProfile $profile, array $input, ?User $actor): void
    {
        $conflict = fn () => new RuntimeException('ملف هذه المنصة موجود بإعداد مختلف — عدّله عبر التعديل (PUT) لا الإنشاء.');

        if (! empty($input['sales_channel_id']) && $input['sales_channel_id'] !== $profile->sales_channel_id) {
            throw $conflict();
        }

        $current = $this->latestVersion($profile);
        foreach (['collection_mode', 'external_reference_policy'] as $field) {
            if (isset($input[$field]) && $input[$field] !== $current->{$field}) {
                throw $conflict();
            }
        }
        foreach (['display_name', 'display_name_en', 'logo_asset_key'] as $field) {
            // فارغ/مسافات فقط = بلا رأي (كالغائب): لا يُقارَن، فلا تتحوّل إعادة المحاولة
            // بحمولة الإنشاء نفسها (التي يستبدل `create` فراغها باسم الكتالوج) إلى تعارض.
            $wanted = $this->nonEmpty($input[$field] ?? null);
            if ($wanted !== null && $wanted !== $current->{$field}) {
                throw $conflict();
            }
        }
        if (isset($input['is_active']) && (bool) $input['is_active'] !== (bool) $current->is_active) {
            throw $conflict();
        }
        if (isset($input['branch_overrides'])) {
            $provided = $this->normalizeOverrides($input['branch_overrides'], $actor);
            $existing = $this->overrideMap($current);
            ksort($provided);
            ksort($existing);
            if ($provided !== $existing) {
                throw $conflict();
            }
        }
    }

    /**
     * @param  array<string, mixed>  $changes  أي مفتاح غائب يبقى كما في النسخة الحالية؛
     *                                         `branch_overrides` الغائب أو null = بلا تغيير، و[] = مسح المتاح للفاعل.
     */
    public function update(DeliveryPlatformProfile $profile, array $changes, ?User $actor = null): DeliveryPlatformProfile
    {
        $this->requireTenant();

        return $this->guarded(fn () => DB::transaction(function () use ($profile, $changes, $actor) {
            $locked = DeliveryPlatformProfile::query()->whereKey($profile->getKey())->lockForUpdate()->first();
            if ($locked === null) {
                throw new RuntimeException('ملف المنصة غير متاح للمؤسسة الحالية.');
            }

            $current = $this->latestVersion($locked);
            $currentOverrides = $this->overrideMap($current);

            $desired = [
                'collection_mode' => $changes['collection_mode'] ?? $current->collection_mode,
                'external_reference_policy' => $changes['external_reference_policy'] ?? $current->external_reference_policy,
                'display_name' => array_key_exists('display_name', $changes)
                    ? ($this->nonEmpty($changes['display_name']) ?? $current->display_name)
                    : $current->display_name,
                'display_name_en' => array_key_exists('display_name_en', $changes)
                    ? $this->nonEmpty($changes['display_name_en'])
                    : $current->display_name_en,
                'logo_asset_key' => array_key_exists('logo_asset_key', $changes)
                    ? $this->nonEmpty($changes['logo_asset_key'])
                    : $current->logo_asset_key,
                // null = غير مُرسَل (لا يعني تعطيلاً): الحقل الغائب أو null يُبقي القيمة الحالية.
                'is_active' => isset($changes['is_active']) ? (bool) $changes['is_active'] : (bool) $current->is_active,
            ];

            $desiredOverrides = $currentOverrides;
            // null/غائب = بلا تغيير؛ [] صريحة = مسح المتاح للفاعل.
            if (isset($changes['branch_overrides'])) {
                $provided = $this->normalizeOverrides($changes['branch_overrides'], $actor);
                $allowed = $actor?->allowedBranchIds();
                // فاعلٌ مقيَّد بفروع لا يمحو تجاوزات فروعٍ لا يملكها: يُستبدل المتاح له وحده.
                $kept = $allowed === null
                    ? []
                    : array_filter($currentOverrides, fn ($row, $branchId) => ! in_array($branchId, $allowed, true), ARRAY_FILTER_USE_BOTH);
                $desiredOverrides = $kept + $provided;
            }

            $this->assertValues($desired);

            if ($this->snapshot($desired, $desiredOverrides) === $this->snapshot($this->versionValues($current), $currentOverrides)) {
                return $locked->fresh();
            }

            $this->appendVersion(
                $locked,
                $current->version_number + 1,
                $desired,
                $desiredOverrides,
                $changes['change_reason'] ?? null,
                $actor,
            );

            if ($locked->is_active !== $desired['is_active']) {
                $locked->is_active = $desired['is_active'];
                $locked->save();
            }

            return $locked->fresh();
        }));
    }

    /**
     * يعلّق **النسخة الحالية فقط** (مع تجاوزاتها) على كل ملف كعلاقة `currentVersion` —
     * دون تحميل الحوليّة. استعلامان ثابتان مهما كثرت النسخ؛ `max` على عمود عددي
     * (علاقة `ofMany` تفشل على PostgreSQL لأنها تجمّع بمعرّف UUID).
     *
     * @param  iterable<DeliveryPlatformProfile>  $profiles
     */
    public function attachCurrentVersions(iterable $profiles): void
    {
        $profiles = collect($profiles)->values();
        if ($profiles->isEmpty()) {
            return;
        }

        $max = Version::query()
            ->whereIn('delivery_platform_profile_id', $profiles->pluck('id'))
            ->selectRaw('delivery_platform_profile_id, max(version_number) as current_number')
            ->groupBy('delivery_platform_profile_id')
            ->pluck('current_number', 'delivery_platform_profile_id');

        $current = collect();
        if ($max->isNotEmpty()) {
            $current = Version::query()->with('overrides')
                ->where(function ($query) use ($max) {
                    foreach ($max as $profileId => $number) {
                        $query->orWhere(fn ($pair) => $pair
                            ->where('delivery_platform_profile_id', $profileId)
                            ->where('version_number', (int) $number));
                    }
                })
                ->get()
                ->keyBy('delivery_platform_profile_id');
        }

        foreach ($profiles as $profile) {
            $profile->setRelation('currentVersion', $current->get($profile->id));
        }
    }

    public function latestVersion(DeliveryPlatformProfile $profile): Version
    {
        $version = Version::query()
            ->where('delivery_platform_profile_id', $profile->getKey())
            ->orderByDesc('version_number')
            ->first();
        if ($version === null) {
            throw new RuntimeException('ملف المنصة بلا نسخة تكوين.');
        }

        return $version;
    }

    /**
     * الإعداد الفعلي: نسخة محدّدة بمعرّفها، أو الأحدث بتاريخ فعالية `$at`، أو الأحدث.
     * معرّف النسخة المسجَّل يُحلّ دوماً لنفس القيم؛ تجاوز الفرع يُقرأ من النسخة نفسها.
     *
     * @return array<string, mixed>|null `null` إن لم توجد نسخة فعّالة وقتئذٍ
     */
    public function resolve(
        DeliveryPlatformProfile $profile,
        ?string $branchId = null,
        ?string $versionId = null,
        ?CarbonInterface $at = null,
    ): ?array {
        $this->requireTenant();
        if ($versionId !== null && $at !== null) {
            throw new RuntimeException('حدّد معرّف نسخة أو تاريخاً، لا الاثنين معاً.');
        }

        $query = Version::query()->where('delivery_platform_profile_id', $profile->getKey());
        if ($versionId !== null) {
            $version = $query->whereKey($versionId)->first();
        } elseif ($at !== null) {
            // الفعالية تُخزَّن بتوقيت التطبيق وبالميكروثانية: يُحوَّل الزمن (بما فيه أي إزاحة
            // `+03:00`) إلى توقيت التطبيق ويُربَط نصّاً بالدقة نفسها، لا بصيغة الثواني الافتراضية.
            $instant = $at->copy()->setTimezone(config('app.timezone'))->format('Y-m-d H:i:s.u');
            $version = $query->where('effective_from', '<=', $instant)->orderByDesc('version_number')->first();
        } else {
            $version = $query->orderByDesc('version_number')->first();
        }

        return $version === null ? null : $this->effective($profile, $version, $branchId);
    }

    /** @return array<string, mixed> */
    private function effective(DeliveryPlatformProfile $profile, Version $version, ?string $branchId): array
    {
        $override = null;
        if ($branchId !== null) {
            // TenantScope: فرع مستأجر آخر لا يُحلّ ويُعامَل كغير موجود.
            if (! Branch::query()->whereKey($branchId)->exists()) {
                throw new RuntimeException('الفرع غير متاح للمؤسسة الحالية.');
            }
            $override = Override::query()
                ->where('delivery_platform_profile_version_id', $version->id)
                ->where('branch_id', $branchId)
                ->first();
        }

        return [
            'profile_id' => $profile->id,
            'platform_key' => $profile->platform_key,
            'sales_channel_id' => $profile->sales_channel_id,
            'version_id' => $version->id,
            'version_number' => $version->version_number,
            'effective_from' => $version->effective_from?->format('Y-m-d\\TH:i:s.uP'),
            'is_active' => (bool) $version->is_active,
            'display_name' => $version->display_name,
            'display_name_en' => $version->display_name_en,
            'logo_asset_key' => $version->logo_asset_key,
            'branch_id' => $branchId,
            'branch_override_applied' => $override !== null,
            'collection_mode' => $override?->collection_mode ?? $version->collection_mode,
            'external_reference_policy' => $override?->external_reference_policy ?? $version->external_reference_policy,
        ];
    }

    /** @param array{name:string,name_en:string} $catalog */
    private function resolveChannelForCreate(string $platformKey, array $catalog, mixed $channelId): SalesChannel
    {
        $slug = DeliveryPlatformCatalog::channelSlug($platformKey);

        if (is_string($channelId) && $channelId !== '') {
            // TenantScope: معرّف قناة من مستأجر آخر لا يُحلّ ويُعامَل كغير موجود.
            $channel = SalesChannel::query()->whereKey($channelId)->lockForUpdate()->first();
            if ($channel === null) {
                throw new RuntimeException('قناة البيع غير متاحة للمؤسسة الحالية.');
            }
            $this->assertChannelEligible($channel, $slug);

            return $channel;
        }

        $occupant = SalesChannel::query()->withTrashed()->where('slug', $slug)->lockForUpdate()->first();
        if ($occupant !== null) {
            if ($occupant->trashed()) {
                throw new RuntimeException("السلاج «{$slug}» محجوز بقناة محذوفة سابقاً — يحتاج مراجعة تشغيلية يدوية.");
            }
            $this->assertChannelEligible($occupant, $slug);

            return $occupant;
        }

        return SalesChannel::create([
            'slug' => $slug,
            'name' => $catalog['name_en'],
            'type' => SalesChannel::TYPE_EXTERNAL,
            'is_active' => true,
        ]);
    }

    private function assertChannelEligible(SalesChannel $channel, string $expectedSlug): void
    {
        if ($channel->type !== SalesChannel::TYPE_EXTERNAL) {
            throw new RuntimeException('قناة منصة التوصيل يجب أن تكون من النوع external.');
        }
        if (! $channel->is_active) {
            throw new RuntimeException('قناة البيع غير نشطة.');
        }
        if ($channel->slug !== $expectedSlug) {
            throw new RuntimeException("سلاج القناة يجب أن يكون «{$expectedSlug}».");
        }
        if (DeliveryPlatformProfile::query()->where('sales_channel_id', $channel->id)->exists()) {
            throw new RuntimeException('القناة مرتبطة بملف منصة آخر.');
        }
    }

    /**
     * @param  mixed  $raw  list of ['branch_id'=>uuid, 'collection_mode'=>?, 'external_reference_policy'=>?]
     * @return array<string, array{collection_mode:?string,external_reference_policy:?string}> keyed by branch id
     */
    private function normalizeOverrides(mixed $raw, ?User $actor): array
    {
        if (! is_array($raw)) {
            throw new RuntimeException('تجاوزات الفروع يجب أن تكون قائمة.');
        }

        // مرور أول: الشكل والتكرار وجمع المعرّفات — بلا أي استعلام.
        $rows = [];
        foreach ($raw as $row) {
            $branchId = is_array($row) ? ($row['branch_id'] ?? null) : null;
            if (! is_string($branchId) || $branchId === '') {
                throw new RuntimeException('كل تجاوز يحتاج فرعاً.');
            }
            if (isset($rows[$branchId])) {
                throw new RuntimeException('لا يمكن تكرار الفرع نفسه في التجاوزات.');
            }
            $rows[$branchId] = $row;
        }
        if ($rows === []) {
            return [];
        }

        // الفروع ونطاق الفاعل تُحلّ **مرة واحدة للدفعة** (لا استعلامان لكل تجاوز).
        // TenantScope: فرع مستأجر آخر لا يُحلّ. معرّف غير UUID يُعامَل كغير متاح
        // (PostgreSQL يرفض النص غير UUID بخطأ 22P02 بدل أن يعيد صفراً).
        $validIds = array_values(array_filter(array_keys($rows), fn ($id) => Str::isUuid((string) $id)));
        $known = $validIds === [] ? [] : array_flip(Branch::query()->whereIn('id', $validIds)->pluck('id')->all());
        $allowed = $actor?->allowedBranchIds();

        $result = [];
        foreach ($rows as $branchId => $row) {
            if (! isset($known[$branchId]) || ($allowed !== null && ! in_array($branchId, $allowed, true))) {
                throw new RuntimeException('الفرع غير متاح لهذا التجاوز.');
            }
            $mode = $row['collection_mode'] ?? null;
            $policy = $row['external_reference_policy'] ?? null;
            if ($mode === null && $policy === null) {
                throw new RuntimeException('التجاوز يجب أن يحدد سياسة تحصيل أو سياسة مرجع خارجي.');
            }
            $this->assertValues([
                'collection_mode' => $mode ?? Version::COLLECTION_MERCHANT,
                'external_reference_policy' => $policy ?? Version::REFERENCE_OPTIONAL,
            ]);
            $result[$branchId] = ['collection_mode' => $mode, 'external_reference_policy' => $policy];
        }

        return $result;
    }

    /** @param array<string, mixed> $values */
    private function assertValues(array $values): void
    {
        if (! in_array($values['collection_mode'] ?? null, Version::COLLECTION_MODES, true)) {
            throw new RuntimeException('سياسة التحصيل غير صالحة.');
        }
        if (! in_array($values['external_reference_policy'] ?? null, Version::REFERENCE_POLICIES, true)) {
            throw new RuntimeException('سياسة المرجع الخارجي غير صالحة.');
        }
    }

    /**
     * @param  array<string, mixed>  $values
     * @param  array<string, array{collection_mode:?string,external_reference_policy:?string}>  $overrides
     */
    private function appendVersion(
        DeliveryPlatformProfile $profile,
        int $number,
        array $values,
        array $overrides,
        mixed $reason,
        ?User $actor,
    ): Version {
        $this->assertValues($values);
        $now = now();
        // الساعة قد ترجع أو تتساوى بين كاتبَين: effective_from لا ينقص أبداً عن سابقه.
        $previous = Version::query()
            ->where('delivery_platform_profile_id', $profile->id)
            ->orderByDesc('version_number')
            ->value('effective_from');
        if ($previous !== null) {
            $previous = \Illuminate\Support\Carbon::parse($previous);
            if ($now->lte($previous)) {
                $now = $previous->copy()->addMicrosecond();
            }
        }

        $version = Version::create([
            'delivery_platform_profile_id' => $profile->id,
            'version_number' => $number,
            'collection_mode' => $values['collection_mode'],
            'external_reference_policy' => $values['external_reference_policy'],
            'display_name' => $values['display_name'],
            'display_name_en' => $values['display_name_en'],
            'logo_asset_key' => $values['logo_asset_key'],
            'is_active' => (bool) $values['is_active'],
            'change_reason' => $this->nonEmpty($reason),
            'created_by' => $actor?->id,
            'effective_from' => $now,
            'created_at' => $now,
        ]);

        Override::createBatch($version, $overrides, $now);

        return $version;
    }

    /** @return array<string, array{collection_mode:?string,external_reference_policy:?string}> */
    private function overrideMap(Version $version): array
    {
        $map = [];
        foreach (Override::query()->where('delivery_platform_profile_version_id', $version->id)->get() as $row) {
            $map[$row->branch_id] = [
                'collection_mode' => $row->collection_mode,
                'external_reference_policy' => $row->external_reference_policy,
            ];
        }

        return $map;
    }

    /** @return array<string, mixed> */
    private function versionValues(Version $version): array
    {
        return [
            'collection_mode' => $version->collection_mode,
            'external_reference_policy' => $version->external_reference_policy,
            'display_name' => $version->display_name,
            'display_name_en' => $version->display_name_en,
            'logo_asset_key' => $version->logo_asset_key,
            'is_active' => (bool) $version->is_active,
        ];
    }

    /**
     * @param  array<string, mixed>  $values
     * @param  array<string, array{collection_mode:?string,external_reference_policy:?string}>  $overrides
     */
    private function snapshot(array $values, array $overrides): string
    {
        ksort($overrides);
        $values = array_intersect_key($values, array_flip([
            'collection_mode', 'external_reference_policy', 'display_name', 'display_name_en', 'logo_asset_key', 'is_active',
        ]));
        ksort($values);

        return json_encode([$values, $overrides], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
    }

    private function nonEmpty(mixed $value): ?string
    {
        $value = is_string($value) ? trim($value) : null;

        return $value === null || $value === '' ? null : $value;
    }

    private function requireTenant(): string
    {
        $tenantId = $this->tenantContext->id();
        if ($tenantId === null) {
            throw new RuntimeException('سياق المؤسسة مطلوب لإعداد منصات التوصيل.');
        }

        return $tenantId;
    }

    private function guarded(callable $fn): mixed
    {
        try {
            return $fn();
        } catch (DomainException $e) {
            throw new RuntimeException($e->getMessage(), 0, $e);
        } catch (QueryException $e) {
            // سباق على القيد الفريد: رسالة عمل لا SQL.
            if (str_contains(strtolower($e->getMessage()), 'unique')) {
                throw new RuntimeException('ملف هذه المنصة أو قناتها أو رقم النسخة موجود مسبقاً.', 0, $e);
            }
            // سباق: فرعٌ حُذف بين التحقق والإدراج — قيد FK يرفض الإدراج؛ رسالة عمل (422) لا 500.
            if (($e->errorInfo[0] ?? null) === '23503' || str_contains(strtolower($e->getMessage()), 'foreign key')) {
                throw new RuntimeException('أحد الفروع لم يعد متاحاً — أعد المحاولة.', 0, $e);
            }
            throw $e;
        }
    }
}
