<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * مرجع تبادل QR/رابط عميق لمرّة واحدة (MOBILE-PREVIEW-7) — **نيّة إنشاء جلسة
 * معاينة، لا جلسة بذاتها**: `PreviewSession` الفعلية لا تُنشَأ إلا عند تبادلٍ
 * ناجح واحد لهذا الصفّ (`PreviewExchangeService::consume()`).
 *
 * لا يحمل هذا النموذج أبداً النصّ الخام للمرجع — `reference_hash` فقط
 * (sha256 hex)، نفس انضباط `auth_action_tokens`/`ApiClientKeyService`.
 *
 * `CompanyWide`: يخصّ المؤسسة/التطبيق لا فرعاً بعينه — نفس تصنيف
 * `PreviewSession` الذي يصدر عنه.
 */
class PreviewExchangeReference extends BaseModel implements CompanyWide
{
    /** TTL ثابت غير قابل للتمديد — ليس جلسة عمل، بل رمزٌ لمرّة واحدة (§5.6 من معمارية MP-5). */
    public const TTL_MINUTES = 5;

    protected $fillable = [
        'tenant_id',
        'builder_app_id',
        'reference_hash',
        'schema_snapshot',
        'draft_revision',
        'channel',
        'device_label',
        'created_by',
        'expires_at',
        'consumed_at',
        'preview_session_id',
    ];

    protected $casts = [
        'schema_snapshot' => 'array',
        'draft_revision' => 'integer',
        'expires_at' => 'immutable_datetime',
        'consumed_at' => 'immutable_datetime',
    ];

    public function app(): BelongsTo
    {
        return $this->belongsTo(BuilderApp::class, 'builder_app_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function session(): BelongsTo
    {
        return $this->belongsTo(PreviewSession::class, 'preview_session_id');
    }

    public function isConsumed(): bool
    {
        return $this->consumed_at !== null;
    }

    public function isExpired(): bool
    {
        return $this->expires_at->isPast();
    }

    public function isUsable(): bool
    {
        return ! $this->isConsumed() && ! $this->isExpired();
    }
}
