<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\QueryException;
use RuntimeException;

/**
 * ═══════════════════════════════════════════════════════════════
 *  BarcodeRegistryEntry — فضاء الباركود الموحّد على مستوى المستأجر
 * ═══════════════════════════════════════════════════════════════
 *  صفٌّ واحد لكل كودٍ مستعمَل — أساسياً (`Product.barcode`) كان أو بديلاً
 *  (`ProductBarcode.code`) — بقيدٍ فريد `(tenant_id, code)` هو مصدر الحقيقة
 *  الوحيد لتفرّد الباركود، لا فحص `exists()` على جدولين منفصلين.
 *
 *  **الضمان الذرّي حقيقةً هو القيد الفريد في قاعدة البيانات، لا `isTaken()`
 *  وحدها:** سباقان متزامنان قد يجتازا `isTaken()` معاً قبل أن يُدرج أيّهما،
 *  لكن `INSERT` الثاني يفشل حتماً على القيد الفريد — و`claim()` تترجم ذلك
 *  الفشل إلى رسالةٍ عربية مفهومة بدل استثناء قاعدة بيانات خام.
 */
class BarcodeRegistryEntry extends BaseModel implements CompanyWide
{
    protected $table = 'barcode_registry';

    protected $fillable = ['tenant_id', 'code', 'product_id', 'kind'];

    public function product(): BelongsTo
    {
        return $this->belongsTo(Product::class);
    }

    /**
     * يحجز كوداً لمنتج بصفة (أساسي/بديل). حفظٌ متكرّر لنفس (الكود، المنتج،
     * الصفة) بلا تغيير آمنٌ تماماً — لا يُنشئ صفّاً ثانياً ولا يرفض.
     */
    public static function claim(string $code, string $productId, string $kind): void
    {
        $existing = static::where('code', $code)->first();

        if ($existing !== null) {
            if ($existing->product_id === $productId && $existing->kind === $kind) {
                return;
            }

            throw new RuntimeException('الباركود مستخدم بالفعل في هذه المؤسسة.');
        }

        try {
            static::create(['code' => $code, 'product_id' => $productId, 'kind' => $kind]);
        } catch (QueryException $e) {
            if (self::isUniqueViolation($e)) {
                throw new RuntimeException('الباركود مستخدم بالفعل في هذه المؤسسة.');
            }

            throw $e;
        }
    }

    /** يحرّر كوداً واحداً — لتغيير/حذف باركودٍ بديل، أو تغيير الباركود الأساسي. */
    public static function release(string $code): void
    {
        static::where('code', $code)->delete();
    }

    /**
     * يحرّر كل ما يملكه منتج (أساسياً وبدائله معاً) دفعةً واحدة. يُستدعى
     * حصراً من مسار الحذف الحقيقي في `ProductLifecycleService::delete()` —
     * وهو مسارٌ لا يكتمل أصلاً إلا حين لا توجد أي مراجع تاريخية للمنتج،
     * فتحرير باركوده حينها لا يكسر أي هوية قائمة. **لا يُستدعى عند التعطيل**
     * (`is_active=false`) ولا عند الحذف الناعم وحده — فالهوية التاريخية قد
     * تبقى قائمة في تلك الحالة.
     */
    public static function releaseAllForProduct(string $productId): void
    {
        static::where('product_id', $productId)->delete();
    }

    /** فحصٌ مسبق لرسالة تحقّق مبكرة وواضحة — القيد الفريد هو الضامن الفعلي. */
    public static function isTaken(string $code, ?string $exceptProductId = null): bool
    {
        return static::where('code', $code)
            ->when($exceptProductId, fn ($q) => $q->where('product_id', '!=', $exceptProductId))
            ->exists();
    }

    private static function isUniqueViolation(QueryException $e): bool
    {
        $sqlState = (string) ($e->errorInfo[0] ?? '');
        $driverCode = (int) ($e->errorInfo[1] ?? 0);

        // PostgreSQL unique_violation = 23505 · SQLite constraint = 19
        return $sqlState === '23505' || $driverCode === 19 || str_contains(strtolower($e->getMessage()), 'unique');
    }
}
