<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * تحديث نظام / What's New (PR-NOTIF-6).
 *
 * **على مستوى المنصة — ليس نموذج أعمال مستأجر:** لا يرث `BaseModel`
 * ولا يملك `tenant_id`. الكاتب `PlatformAdministrator`.
 * سجلّ What's New دائم ومستقل عن حالة قراءة Notification.
 */
class SystemUpdate extends Model
{
    use HasUuids;

    public $incrementing = false;

    protected $keyType = 'string';

    public const STATUS_DRAFT = 'draft';
    public const STATUS_PUBLISHED = 'published';

    public const TARGET_ALL = 'all';
    public const TARGET_TENANTS = 'tenants';
    public const TARGET_USERS = 'users';

    protected $fillable = [
        'author_id',
        'status',
        'target_type',
        'title_ar',
        'title_en',
        'content_ar',
        'content_en',
        'published_at',
    ];

    protected $casts = [
        'published_at' => 'datetime',
    ];

    public function author(): BelongsTo
    {
        return $this->belongsTo(PlatformAdministrator::class, 'author_id');
    }

    public function targets(): HasMany
    {
        return $this->hasMany(SystemUpdateTarget::class);
    }

    public function isPublished(): bool
    {
        return $this->status === self::STATUS_PUBLISHED;
    }

    public function isDraft(): bool
    {
        return $this->status === self::STATUS_DRAFT;
    }
}
