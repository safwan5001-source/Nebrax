<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * TANKER-PR6B-2 — سجل **محاولات** ترحيل/عكس سند تعبئة الصهريج مخزنياً (دليل تدقيقي append-only، **بنية فقط**). **لا كاتب لهذا النموذج في هذه الشريحة:** لا خدمة تسجّل محاولة
 * فعلية ولا مسار يستدعيه؛ الكاتب الأول هو PR-6B-3 (خدمة الترحيل) بقرار صريح. يرفض النموذج أي إنشاء/تعديل/حذف برمجياً حتى ذلك الحين (فشل مغلق)، ويحرس ذلك اختبار ساكن (لا مرجع
 * للنموذج خارج هذا الملف). القراءة مسموحة. القيود في القاعدة (فهارس فريدة جزئية + مُشغّلات) تثبّت سلوك الكاتب القادم.
 */
class FuelTankerFillInventoryPostingAttempt extends BaseModel
{
    use BranchScoped;

    public const OPERATION_POST = 'post';
    public const OPERATION_REVERSE = 'reverse';
    public const OPERATIONS = [self::OPERATION_POST, self::OPERATION_REVERSE];

    public const OUTCOME_SUCCEEDED = 'succeeded';
    public const OUTCOME_REJECTED = 'rejected';
    public const OUTCOME_FAILED = 'failed';
    public const OUTCOMES = [self::OUTCOME_SUCCEEDED, self::OUTCOME_REJECTED, self::OUTCOME_FAILED];

    /** الإيقاف المقصود: يُرفع في PR-6B-3 بقرار صريح لا بإعداد. */
    private const WRITES_DISABLED = 'تسجيل محاولات الترحيل المخزني لسندات تعبئة الصهاريج غير مفعَّل (PR-6B-3) — لا كتابة في هذه المرحلة.';

    protected $fillable = [];

    protected static function booted(): void
    {
        static::creating(fn () => throw new LogicException(self::WRITES_DISABLED));
        static::updating(fn () => throw new LogicException(self::WRITES_DISABLED));
        static::deleting(fn () => throw new LogicException(self::WRITES_DISABLED));
    }

    public function tankerFill(): BelongsTo { return $this->belongsTo(FuelTankerFill::class, 'fuel_tanker_fill_id'); }
    public function posting(): BelongsTo { return $this->belongsTo(FuelTankerFillInventoryPosting::class, 'posting_id'); }
}
