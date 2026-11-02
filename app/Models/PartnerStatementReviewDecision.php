<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use LogicException;

/**
 * قرار مراجعة واحد على سطر كشف (IMP-PS-A3a/A3b، `CompanyWide`): confirm | override | clear | link_pair. **سجل append-only**: لا تعديل ولا حذف (يحرسه النموذج والقاعدة)،
 * والقرار الفعّال لسطر = أعلى نسخة له (clear = لا قرار). **لا أثر مالي**: لا قيد ولا مستند ولا رصيد ولا ZATCA — مراجعة لنتائج مشتقة فقط.
 */
class PartnerStatementReviewDecision extends BaseModel implements CompanyWide
{
    public const UPDATED_AT = null;

    public const ACTION_CONFIRM = 'confirm';

    public const ACTION_OVERRIDE = 'override';

    public const ACTION_CLEAR = 'clear';

    /** PS-A3b: ربط يدوي صريح لسطر كشف بأحد طرفي زوج أصل/عكس مثبت بـ`reversal_of`. */
    public const ACTION_LINK_PAIR = 'link_pair';

    public const ACTIONS = [self::ACTION_CONFIRM, self::ACTION_OVERRIDE, self::ACTION_CLEAR, self::ACTION_LINK_PAIR];

    public const MEMBER_ORIGINAL = 'original';

    public const MEMBER_REVERSAL = 'reversal';

    public const MEMBERS = [self::MEMBER_ORIGINAL, self::MEMBER_REVERSAL];

    protected $fillable = [
        'tenant_id', 'reconciliation_id', 'run_id', 'line_id', 'revision', 'action', 'unit_keys', 'engine_outcome', 'expected_net_minor', 'set_net_minor',
        'difference_minor', 'accepted_difference', 'reason', 'ledger_fingerprint', 'created_by',
        'pair_member', 'pair_original_entry_id', 'pair_reversal_entry_id', 'engine_code',
    ];

    protected $casts = [
        'revision' => 'integer', 'unit_keys' => 'array', 'expected_net_minor' => 'integer', 'set_net_minor' => 'integer', 'difference_minor' => 'integer',
        'accepted_difference' => 'boolean',
    ];

    protected static function booted(): void
    {
        parent::booted();
        static::updating(static function (): void {
            throw new LogicException('قرار المراجعة غير قابل للتعديل بعد إنشائه (سجل append-only).');
        });
        static::deleting(static function (): void {
            throw new LogicException('قرار المراجعة غير قابل للحذف (سجل append-only).');
        });
    }
}
