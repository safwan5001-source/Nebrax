<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * ملاحظة تحقيق append-only — لا مدوَّنة واحدة قابلة للطمس فوق قرار سابق. كل ملاحظة صفّ
 * مستقل بمؤلفه وتوقيته وفئته.
 */
class PosCaseNote extends BaseModel
{
    use BranchScoped;

    public const CATEGORY_GENERAL = 'general';
    public const CATEGORY_INVESTIGATION = 'investigation';
    public const CATEGORY_EVIDENCE = 'evidence';
    public const CATEGORY_RESOLUTION = 'resolution';

    public const CATEGORIES = [
        self::CATEGORY_GENERAL, self::CATEGORY_INVESTIGATION, self::CATEGORY_EVIDENCE, self::CATEGORY_RESOLUTION,
    ];

    public $timestamps = false;

    protected $fillable = [
        'branch_id', 'case_id', 'author_id', 'category', 'body', 'created_at',
    ];

    protected function casts(): array
    {
        return [
            'created_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::updating(static fn () => throw new LogicException('ملاحظة القضية لا تُعدَّل بعد إنشائها.'));
        static::deleting(static fn () => throw new LogicException('ملاحظة القضية لا تُحذف.'));
    }

    public function investigationCase(): BelongsTo
    {
        return $this->belongsTo(PosInvestigationCase::class, 'case_id');
    }

    public function author(): BelongsTo
    {
        return $this->belongsTo(User::class, 'author_id');
    }
}
