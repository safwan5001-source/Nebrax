<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use LogicException;

/**
 * قرار مراجعة واحد على سطر كشف (IMP-PS-A3a، `CompanyWide`): confirm | override | clear. **سجل append-only**: لا تعديل ولا حذف (يحرسه النموذج والقاعدة)،
 * والقرار الفعّال لسطر = أعلى نسخة له (clear = لا قرار). **لا أثر مالي**: لا قيد ولا مستند ولا رصيد ولا ZATCA — مراجعة لنتائج مشتقة فقط.
 */
class PartnerStatementReviewDecision extends BaseModel implements CompanyWide
{
    public const UPDATED_AT = null;

    public const ACTION_CONFIRM = 'confirm';

    public const ACTION_OVERRIDE = 'override';

    public const ACTION_CLEAR = 'clear';

    public const ACTIONS = [self::ACTION_CONFIRM, self::ACTION_OVERRIDE, self::ACTION_CLEAR];

    protected $fillable = [
        'tenant_id', 'reconciliation_id', 'run_id', 'line_id', 'revision', 'action', 'unit_keys', 'engine_outcome', 'expected_net_minor', 'set_net_minor',
        'difference_minor', 'accepted_difference', 'reason', 'ledger_fingerprint', 'created_by',
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
