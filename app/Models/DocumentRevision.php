<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use App\Tenancy\ResolvesBranchReferences;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Prunable;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\MorphTo;

/**
 * قيد في سجلّ تغييرات مستند — يُكتب مرّة ولا يُعدَّل.
 *
 * لا أثر محاسبي: لا يمسّ قيداً ولا رصيداً. غرضه أن تكون التغييرات الصامتة
 * على المسوّدات **مرئية** — وهي المنطقة التي لا تحرسها قاعدة الـ immutability.
 */
/** @see design-system/foundations/multi-branch-architecture.md — مشترك: سجلّ تابع لمستند — يتبع فرع رأسه */
class DocumentRevision extends BaseModel implements CompanyWide
{
    use Prunable;
    use ResolvesBranchReferences;

    /** سجلّ لا يُعدَّل: لا `updated_at` له معنى، لكن نُبقيه لبساطة الجدول. */
    protected $fillable = [
        'tenant_id', 'document_type', 'document_id', 'action', 'diff', 'user_id',
    ];

    protected $casts = ['diff' => 'array'];

    /** ميكروثانية — يرتّب الخطّ الزمني قيوداً تقع في الثانية نفسها. */
    protected $dateFormat = 'Y-m-d H:i:s.u';

    /**
     * الأنواع المعروفة: مفتاحٌ قصير ↔ كلاس. مصدر واحد يتشاركه المتحكّم (قائمة
     * بيضاء للاستعلام) والمورد (اسمٌ مقروء في التغذية) — فلا ينحرف أحدهما.
     */
    public const TYPES = [
        'invoice'      => \App\Models\Invoice::class,
        'quote'        => \App\Models\Quote::class,
        'procurement'  => \App\Models\ProcurementDocument::class,
        'stocktake'    => \App\Models\Stocktake::class,
        'stock_permit' => \App\Models\StockPermit::class,
    ];

    /** المفتاح القصير لكلاس مستند — أو null لنوع خارج القائمة. */
    public static function typeKey(?string $class): ?string
    {
        $key = array_search($class, self::TYPES, true);

        return $key === false ? null : $key;
    }

    /** مدّة الاحتفاظ بالأيام — سنتان تغطّيان دورة مراجعة ضريبية كاملة. */
    public const RETENTION_DAYS = 730;

    /**
     * سجلٌّ ينمو مع كل تعديل، فيحتاج حدّاً وإلا صار عبئاً على مستأجر كثيف
     * الحركة. `Prunable` من Laravel: يكفيه `php artisan model:prune` مجدولاً
     * — لا أمر مخصَّص ولا جدول انتظار.
     *
     * القديم يُحذف لا يُؤرشَف: قيمة هذا السجلّ في كشف الخطأ **قريباً** من
     * وقوعه؛ وبعد سنتين تكون الفترة مقفلةً ضريبياً والمستند مرحَّلاً immutable.
     */
    public function prunable(): Builder
    {
        return static::where('created_at', '<=', now()->subDays(self::RETENTION_DAYS));
    }

    public function document(): MorphTo
    {
        return $this->morphTo();
    }

    /** مرجع مخزَّن — لا يُصفّى بالفرع (المستخدم قد يكون من فرع آخر). */
    public function user(): BelongsTo
    {
        return $this->referenceBelongsTo(User::class);
    }
}
