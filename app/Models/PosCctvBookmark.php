<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * مرجع كاميرا (CCTV) — بيانات وصفية فقط (تسمية كاميرا/موقع + نطاق زمني + مرجع خارجي
 * اختياري). **لا فيديو يُخزَّن أو يُرفع أو يُبثّ هنا**، ولا تكامل مزوّد. الحذف Soft
 * (SoftDeletes) لا صلب؛ كل إضافة/تعديل/حذف تكتب نشاط قضية مقابلاً append-only.
 */
class PosCctvBookmark extends BaseModel
{
    use BranchScoped;
    use SoftDeletes;

    protected $fillable = [
        'branch_id', 'case_id', 'pos_session_id', 'cart_id', 'correlation_id',
        'camera_label', 'timestamp_start', 'timestamp_end', 'source_timezone',
        'external_reference', 'note', 'created_by',
    ];

    protected function casts(): array
    {
        return [
            'timestamp_start' => 'datetime',
            'timestamp_end' => 'datetime',
        ];
    }

    public function investigationCase(): BelongsTo
    {
        return $this->belongsTo(PosInvestigationCase::class, 'case_id');
    }

    public function session(): BelongsTo
    {
        return $this->belongsTo(PosSession::class, 'pos_session_id');
    }

    public function createdByUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }
}
