<?php

namespace App\Models;

use App\Tenancy\BelongsToBranch;
use App\Tenancy\TenantContext;
use DomainException;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;
use LogicException;

/**
 * تجاوز فرع **داخل** نسخة تكوين — ثابت، تابع لنسخة بعينها، لا يُعدَّل ولا يُحذف.
 *
 * `BelongsToBranch`: صف موسوم بفرع بتصفية صريحة (لا Global Scope). الفرع دائماً
 * يُمرَّر صراحةً من الخدمة؛ لا يُشتق من الفرع النشط. `NULL` في عمود = يرث من النسخة.
 */
class DeliveryPlatformVersionOverride extends BaseModel
{
    use BelongsToBranch;

    public $timestamps = false;

    protected $fillable = [
        'tenant_id', 'delivery_platform_profile_version_id', 'branch_id',
        'collection_mode', 'external_reference_policy', 'created_at',
    ];

    protected $casts = ['created_at' => 'datetime'];

    protected static function booted(): void
    {
        static::creating(function (self $override): void {
            $context = app(TenantContext::class);
            if (! $context->has()) {
                throw new DomainException('Tenant context is required for delivery platform configuration.');
            }
            if ($override->tenant_id !== null && (string) $override->tenant_id !== (string) $context->id()) {
                throw new DomainException('Delivery platform override tenant cannot be forged.');
            }
            $override->tenant_id = (string) $context->id();

            if (empty($override->branch_id)) {
                throw new DomainException('A branch override must name its branch explicitly.');
            }
            // TenantScope: فرع مستأجر آخر لا يُحلّ.
            if (! Branch::query()->whereKey($override->branch_id)->exists()) {
                throw new DomainException('Override branch must belong to the active tenant.');
            }
            if (! DeliveryPlatformProfileVersion::query()->whereKey($override->delivery_platform_profile_version_id)->exists()) {
                throw new DomainException('Override version must belong to the active tenant.');
            }
            if ($override->collection_mode !== null
                && ! in_array($override->collection_mode, DeliveryPlatformProfileVersion::COLLECTION_MODES, true)) {
                throw new DomainException('Invalid collection mode.');
            }
            if ($override->external_reference_policy !== null
                && ! in_array($override->external_reference_policy, DeliveryPlatformProfileVersion::REFERENCE_POLICIES, true)) {
                throw new DomainException('Invalid external reference policy.');
            }
        });

        static::updating(static fn () => throw new LogicException('تجاوز فرع داخل نسخة لا يُعدَّل؛ أنشئ نسخة جديدة.'));
        static::deleting(static fn () => throw new LogicException('تجاوز فرع داخل نسخة لا يُحذف.'));
    }

    /**
     * إدراج دفعة تجاوزات لنسخة واحدة بنفس حرّاس `creating` لكن **مجمَّعة**: فرع/نسخة
     * بالمستأجر النشط باستعلام واحد لكل الدفعة بدل استعلامين لكل تجاوز.
     * الإدراج الجماعي لا يطلق أحداث النموذج، فتُكرَّر الفحوص هنا صراحةً.
     *
     * @param  array<string, array{collection_mode:?string,external_reference_policy:?string}>  $rows  مفتاحها معرّف الفرع
     */
    public static function createBatch(DeliveryPlatformProfileVersion $version, array $rows, \DateTimeInterface $at): void
    {
        if ($rows === []) {
            return;
        }
        $context = app(TenantContext::class);
        if (! $context->has()) {
            throw new DomainException('Tenant context is required for delivery platform configuration.');
        }
        $tenantId = (string) $context->id();
        if ((string) $version->tenant_id !== $tenantId
            || ! DeliveryPlatformProfileVersion::query()->whereKey($version->getKey())->exists()) {
            throw new DomainException('Override version must belong to the active tenant.');
        }

        $ids = array_map('strval', array_keys($rows));
        foreach ($ids as $id) {
            if (! Str::isUuid($id)) {
                throw new DomainException('Override branch must belong to the active tenant.');
            }
        }
        // TenantScope: فروع مستأجر آخر لا تُحلّ.
        if (Branch::query()->whereIn('id', $ids)->count() !== count($ids)) {
            throw new DomainException('Override branch must belong to the active tenant.');
        }

        $insert = [];
        foreach ($rows as $branchId => $row) {
            foreach (['collection_mode' => DeliveryPlatformProfileVersion::COLLECTION_MODES, 'external_reference_policy' => DeliveryPlatformProfileVersion::REFERENCE_POLICIES] as $field => $allowed) {
                if (($row[$field] ?? null) !== null && ! in_array($row[$field], $allowed, true)) {
                    throw new DomainException('Invalid override value.');
                }
            }
            $insert[] = [
                'id' => (string) Str::uuid(),
                'tenant_id' => $tenantId,
                'delivery_platform_profile_version_id' => $version->getKey(),
                'branch_id' => (string) $branchId,
                'collection_mode' => $row['collection_mode'] ?? null,
                'external_reference_policy' => $row['external_reference_policy'] ?? null,
                'created_at' => $at->format('Y-m-d H:i:s'),
            ];
        }

        static::withoutGlobalScopes()->insert($insert);
    }

    public function version(): BelongsTo
    {
        return $this->belongsTo(DeliveryPlatformProfileVersion::class, 'delivery_platform_profile_version_id');
    }
}
