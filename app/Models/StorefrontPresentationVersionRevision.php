<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\TenantScope;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;
use RuntimeException;

/**
 * CUST-H5-3 — لقطة ثابتة لمستند نسخة مظهر عند حفظٍ ناجح.
 *
 * `CompanyWide`: بيانات تهيئة مستوى المؤسسة كنسختها (`StorefrontPresentationVersion`)، لا فرعاً.
 *
 * **ثابتة بعد الإنشاء:** أي تعديل أو حذف عبر النموذج يرمي استثناءً. الحذف الوحيد المشروع مسارا الاحتفاظ المحدود
 * (`StorefrontPresentationRevisionRecorder::prune`، استعلام جماعي مقصود) والحذف بالتتالي عند حذف النسخة/المتجر/المستأجر.
 *
 * ملكية المستأجر/المتجر تُشتق **دائماً** من صف النسخة نفسه لا من أي مدخل عميل، و`creating` يتحقق منها بنيوياً.
 */
class StorefrontPresentationVersionRevision extends BaseModel implements CompanyWide
{
    public const UPDATED_AT = null;

    protected $fillable = [
        'tenant_id',
        'storefront_id',
        'version_id',
        'version_revision',
        'schema_version',
        'config',
        'config_hash',
        'size_bytes',
    ];

    protected $casts = [
        'version_revision' => 'integer',
        'schema_version' => 'integer',
        'config' => 'array',
        'size_bytes' => 'integer',
    ];

    protected static function booted(): void
    {
        static::creating(function (self $revision) {
            $version = StorefrontPresentationVersion::withoutGlobalScope(TenantScope::class)
                ->select(['id', 'tenant_id', 'storefront_id'])
                ->find($revision->version_id);

            if (
                $version === null
                || $version->tenant_id !== $revision->tenant_id
                || $version->storefront_id !== $revision->storefront_id
            ) {
                throw new RuntimeException('النسخة غير موجودة لهذا المستأجر/المتجر.');
            }
        });

        static::updating(function () {
            throw new LogicException('مراجعات النسخ ثابتة ولا تُعدَّل.');
        });

        static::deleting(function () {
            throw new LogicException('مراجعات النسخ لا تُحذف إلا بحدّ الاحتفاظ أو بحذف النسخة.');
        });
    }

    public function version(): BelongsTo
    {
        return $this->belongsTo(StorefrontPresentationVersion::class, 'version_id');
    }
}
