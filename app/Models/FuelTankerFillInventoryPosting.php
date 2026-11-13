<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use LogicException;

/**
 * TANKER-PR6A — ربط سند تعبئة الصهريج بحركة المخزون الرسمية (**بنية فقط**: ضوابط منع التكرار والعكس في القاعدة). **لا كاتب لهذا النموذج في هذه الشريحة.**
 *
 * قرار المالك: «لا خصم الآن». الترحيل الفعلي (خصم الكمية والتكلفة في معاملة واحدة) هو PR-6B بعد اعتماد المعالجة المحاسبية؛ لذلك يرفض النموذج
 * أي إنشاء أو تعديل أو حذف برمجياً (فشل مغلق) كي لا يُكتب أثر يوحي بأن الوقود صُرف. يحرس ذلك اختبار ساكن أيضاً (لا مرجع للنموذج خارج هذا الملف).
 * القراءة مسموحة (حراسة الاتساق والتقارير). القيود في القاعدة (فهارس فريدة + مُشغّلات) تثبّت سلوك الترحيل القادم.
 */
class FuelTankerFillInventoryPosting extends BaseModel
{
    use BranchScoped;

    public const STATUS_POSTED = 'posted';
    public const STATUS_REVERSED = 'reversed';

    /** الإيقاف المقصود: يُرفع في PR-6B بقرار صريح لا بإعداد. */
    private const WRITES_DISABLED = 'الترحيل المخزني لسندات تعبئة الصهاريج غير مفعَّل (PR-6B) — لا خصم ولا كتابة في هذه المرحلة.';

    protected $fillable = [];

    protected static function booted(): void
    {
        static::creating(fn () => throw new LogicException(self::WRITES_DISABLED));
        static::updating(fn () => throw new LogicException(self::WRITES_DISABLED));
        static::deleting(fn () => throw new LogicException(self::WRITES_DISABLED));
    }

    public function tankerFill(): BelongsTo { return $this->belongsTo(FuelTankerFill::class, 'fuel_tanker_fill_id'); }
}
