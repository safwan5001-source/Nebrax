<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Laravel\Sanctum\HasApiTokens;

/**
 * جلسة معاينة App Builder — مبدأ مصادقة Sanctum خامس ومستقل تماماً
 * (`docs/plans/app-builder/MOBILE-PREVIEW-5-SECURITY-ARCHITECTURE.md` §3،
 * §5.2)، إلى جانب `User`/`ApiClient`/`CustomerIdentity`/`PlatformAdministrator`.
 *
 * ليست مستخدماً ولا عميل API: هويّة طلب `preview/v1` وقت التشغيل هي جلسة
 * معاينة واحدة، مربوطة بمستأجرٍ وتطبيقٍ واحدين لا يتغيّران بعد الإصدار
 * (`AuthenticatePreviewSession` يقرأهما من هذا الصفّ حصراً، لا من الطلب).
 *
 * التوكن نفسه صفّ Sanctum عادي (tokenable = PreviewSession) — لا تشفير
 * مخصّص، ولا عمود سرّ على هذا النموذج (نفس شكل `ApiClient`/`CustomerIdentity`
 * تماماً). القدرة الوحيدة الممنوحة له هي `preview:read` (§ABILITY أدناه).
 *
 * `CompanyWide`: تخصّ جلسة المعاينة المؤسسة لا فرعاً بعينه — تطابق تصنيف
 * `BuilderApp`/`BuilderDraftExperience` نفسه الذي تُصدَر الجلسة عنه.
 */
class PreviewSession extends BaseModel implements CompanyWide
{
    use HasApiTokens;

    /** القدرة الوحيدة الممنوحة لأي توكن جلسة معاينة — لا wildcard، لا سواها أبداً. */
    public const ABILITY_READ = 'preview:read';

    public const SOURCE_DRAFT = 'draft';

    public const SOURCE_PUBLISHED = 'published';

    public const SOURCE_DEFAULT = 'default';

    public const SOURCES = [self::SOURCE_DRAFT, self::SOURCE_PUBLISHED, self::SOURCE_DEFAULT];

    public const CHANNEL_BROWSER = 'browser';

    public const CHANNEL_DEVICE = 'device';

    public const CHANNELS = [self::CHANNEL_BROWSER, self::CHANNEL_DEVICE];

    /** السقف الأقصى المسموح للـTTL (دقائق) — لا يتجاوزه أي إصدار مهما طُلب. */
    public const MAX_TTL_MINUTES = 60;

    /** الـTTL الافتراضي (دقائق) حين لا يُطلَب غيره صراحةً. */
    public const DEFAULT_TTL_MINUTES = 15;

    protected $fillable = [
        'tenant_id',
        'builder_app_id',
        'source',
        'schema_snapshot',
        'draft_revision',
        'published_version_id',
        'channel',
        'device_label',
        'created_by',
        'expires_at',
        'revoked_at',
        'last_used_at',
    ];

    protected $casts = [
        'schema_snapshot' => 'array',
        'draft_revision' => 'integer',
        'expires_at' => 'immutable_datetime',
        'revoked_at' => 'immutable_datetime',
        'last_used_at' => 'immutable_datetime',
    ];

    public function app(): BelongsTo
    {
        return $this->belongsTo(BuilderApp::class, 'builder_app_id');
    }

    public function publishedVersion(): BelongsTo
    {
        return $this->belongsTo(BuilderPublishedExperienceVersion::class, 'published_version_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function isRevoked(): bool
    {
        return $this->revoked_at !== null;
    }

    public function isExpired(): bool
    {
        return $this->expires_at->isPast();
    }

    /** حيّة وقابلة للاستعمال الآن — لا منتهية ولا مبطَلة. §5.15: نفس الشرط في كل نقاط الفحص. */
    public function isUsable(): bool
    {
        return ! $this->isRevoked() && ! $this->isExpired();
    }
}
