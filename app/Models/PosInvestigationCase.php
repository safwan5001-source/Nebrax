<?php

namespace App\Models;

use App\Support\GeneratesDocumentNumbers;
use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * ملف تحقيق رقابي — وثيقة عمل بشرية القرار تجمع استثناءات/أدلة مرتبطة (Phase 2) في مسار
 * مراجعة واحد: Detect → Review → **Investigate → Document → Resolve** → Learn.
 *
 * لا يعدّل الاستثناء أو الحدث المصدر ولا يحذفهما. `confirmed_loss_minor` قرار بشري صرف —
 * لا يُشتقّ أبداً من `PosException.severity` ولا من `PosRiskSnapshot.total_score`، ولا يمرّ
 * عبر `LedgerService` أو يولّد قيداً. بيانات تشغيلية معزولة بفرع أصل القضية (BranchScoped)،
 * مرقَّمة عبر GeneratesDocumentNumbers القياسي (بادئة LP).
 */
class PosInvestigationCase extends BaseModel
{
    use BranchScoped;
    use GeneratesDocumentNumbers;

    public const STATUS_OPEN = 'open';
    public const STATUS_INVESTIGATING = 'investigating';
    public const STATUS_AWAITING_INFORMATION = 'awaiting_information';
    public const STATUS_EXPLAINED = 'explained';
    public const STATUS_CONTROL_FAILURE = 'control_failure';
    public const STATUS_CONFIRMED_LOSS = 'confirmed_loss';
    public const STATUS_DISMISSED = 'dismissed';
    public const STATUS_CLOSED = 'closed';

    public const STATUSES = [
        self::STATUS_OPEN, self::STATUS_INVESTIGATING, self::STATUS_AWAITING_INFORMATION,
        self::STATUS_EXPLAINED, self::STATUS_CONTROL_FAILURE, self::STATUS_CONFIRMED_LOSS,
        self::STATUS_DISMISSED, self::STATUS_CLOSED,
    ];

    /** حالات تتطلب سبب/ملخص حسم عند الانتقال إليها (الإغلاق يتطلب دوماً سبباً — قاعدة §5). */
    public const OUTCOME_STATUSES = [
        self::STATUS_EXPLAINED, self::STATUS_CONTROL_FAILURE, self::STATUS_CONFIRMED_LOSS,
        self::STATUS_DISMISSED, self::STATUS_CLOSED,
    ];

    public const PRIORITY_LOW = 'low';
    public const PRIORITY_NORMAL = 'normal';
    public const PRIORITY_HIGH = 'high';
    public const PRIORITY_CRITICAL = 'critical';

    public const PRIORITIES = [
        self::PRIORITY_LOW, self::PRIORITY_NORMAL, self::PRIORITY_HIGH, self::PRIORITY_CRITICAL,
    ];

    protected $fillable = [
        'branch_id', 'number', 'title', 'summary', 'status', 'priority',
        'owner_id', 'opened_by', 'opened_at', 'last_activity_at', 'resolved_at', 'closed_at',
        'subject_user_id', 'pos_session_id', 'cart_id', 'correlation_id',
        'amount_under_review_minor', 'confirmed_loss_minor', 'recovered_amount_minor',
        'outcome', 'resolution_reason', 'resolution_summary',
    ];

    protected function casts(): array
    {
        return [
            'opened_at' => 'datetime',
            'last_activity_at' => 'datetime',
            'resolved_at' => 'datetime',
            'closed_at' => 'datetime',
            'amount_under_review_minor' => 'integer',
            'confirmed_loss_minor' => 'integer',
            'recovered_amount_minor' => 'integer',
        ];
    }

    public static function documentNumberColumn(): string
    {
        return 'number';
    }

    public function owner(): BelongsTo
    {
        return $this->belongsTo(User::class, 'owner_id');
    }

    public function openedByUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'opened_by');
    }

    public function subject(): BelongsTo
    {
        return $this->belongsTo(User::class, 'subject_user_id');
    }

    public function session(): BelongsTo
    {
        return $this->belongsTo(PosSession::class, 'pos_session_id');
    }

    public function evidenceLinks(): HasMany
    {
        return $this->hasMany(PosCaseEvidenceLink::class, 'case_id');
    }

    public function activities(): HasMany
    {
        return $this->hasMany(PosCaseActivity::class, 'case_id')->orderBy('created_at');
    }

    public function notes(): HasMany
    {
        return $this->hasMany(PosCaseNote::class, 'case_id')->orderBy('created_at');
    }

    public function cctvBookmarks(): HasMany
    {
        return $this->hasMany(PosCctvBookmark::class, 'case_id');
    }
}
