<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use LogicException;

/**
 * حدث دورة حالات مقارنة كشف طرف (IMP-PS-A3c، `CompanyWide`): `mark_reviewed` | `reopen` | `close` (A3d). **سجل append-only** — لا تعديل ولا حذف (النموذج والقاعدة). لا أثر مالي.
 */
class PartnerStatementReconciliationEvent extends BaseModel implements CompanyWide
{
    public const UPDATED_AT = null;

    public const ACTION_MARK_REVIEWED = 'mark_reviewed';

    public const ACTION_REOPEN = 'reopen';

    public const ACTION_CLOSE = 'close';

    protected $fillable = [
        'tenant_id', 'reconciliation_id', 'seq', 'action', 'from_status', 'to_status', 'run_id', 'ledger_fingerprint', 'statement_digest', 'summary', 'reason', 'created_by', 'reviewer_id', 'claims_count',
    ];

    protected $casts = ['seq' => 'integer', 'summary' => 'array'];

    protected static function booted(): void
    {
        parent::booted();
        static::updating(static function (): void {
            throw new LogicException('حدث دورة الحالات غير قابل للتعديل (سجل append-only).');
        });
        static::deleting(static function (): void {
            throw new LogicException('حدث دورة الحالات غير قابل للحذف (سجل append-only).');
        });
    }
}
