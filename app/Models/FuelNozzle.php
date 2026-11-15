<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * فوهة وقود تشغيلية. مصدر الحقيقة للربط Pump → Tank → FuelProduct؛
 * الخدمة تفرض تطابق محطة/فرع/منتج هذه المراجع قبل الحفظ.
 */
class FuelNozzle extends BaseModel implements CompanyWide
{

    public const STATUS_ACTIVE = 'active';
    public const STATUS_INACTIVE = 'inactive';
    public const STATUS_MAINTENANCE = 'maintenance';

    public const STATUSES = [
        self::STATUS_ACTIVE,
        self::STATUS_INACTIVE,
        self::STATUS_MAINTENANCE,
    ];

    /** TANKER-PR3: أنواع العمليات التي يمكن تقييد الفوهة بها. `NULL` في `allowed_operations` = كلها (السلوك الحالي). */
    public const OPERATION_DIRECT_SALE = 'direct_sale';
    public const OPERATION_TANKER_FILL = 'tanker_fill';
    public const OPERATION_INTERNAL_ISSUE = 'internal_issue';

    /** @var list<string> بترتيب كنسي ثابت (يُخزَّن به). */
    public const OPERATIONS = [self::OPERATION_DIRECT_SALE, self::OPERATION_TANKER_FILL, self::OPERATION_INTERNAL_ISSUE];

    protected $fillable = [
        'tenant_id', 'branch_id', 'fuel_station_id', 'fuel_pump_id', 'fuel_tank_id',
        'fuel_product_id', 'nozzle_number', 'controller_key', 'meter_opening_milliliters', 'status', 'allowed_operations',
    ];

    protected $casts = [
        'meter_opening_milliliters' => 'integer',
        'allowed_operations' => 'array',
    ];

    protected $attributes = [
        'meter_opening_milliliters' => 0,
        'status' => self::STATUS_ACTIVE,
    ];

    /**
     * يحوّل مدخل القيد إلى الصيغة المخزَّنة: `null`/المجموعة الكاملة ⇒ `null` (كل العمليات)، وإلا قائمة فريدة بالترتيب الكنسي.
     * قائمة فارغة أو نوع غير معروف أو قيمة غير نصية أو قائمة غير متسلسلة ⇒ استثناء (لإيقاف فوهة تُعطَّل حالتها لا قيدها).
     *
     * @param  mixed  $operations
     * @return list<string>|null
     */
    public static function normalizeOperations(mixed $operations): ?array
    {
        if ($operations === null) {
            return null;
        }
        if (! is_array($operations) || ! array_is_list($operations) || $operations === []) {
            throw new \RuntimeException('قيد عمليات الفوهة يجب أن يكون قائمة غير فارغة من أنواع العمليات أو null (كل العمليات). لإيقاف فوهة غيّر حالتها.');
        }
        foreach ($operations as $operation) {
            if (! is_string($operation) || ! in_array($operation, self::OPERATIONS, true)) {
                throw new \RuntimeException('نوع عملية غير معروف في قيد الفوهة؛ المسموح: '.implode('، ', self::OPERATIONS).'.');
            }
        }
        $unique = array_values(array_intersect(self::OPERATIONS, $operations));

        return count($unique) === count(self::OPERATIONS) ? null : $unique;
    }

    /** @return list<string> العمليات المسموحة فعلياً (`NULL` ⇒ كلها). */
    public function effectiveOperations(): array
    {
        $stored = $this->allowed_operations;

        return is_array($stored) && $stored !== [] ? array_values(array_intersect(self::OPERATIONS, $stored)) : self::OPERATIONS;
    }

    public function allowsOperation(string $operation): bool
    {
        return in_array($operation, $this->effectiveOperations(), true);
    }

    public function station(): BelongsTo
    {
        return $this->belongsTo(FuelStation::class, 'fuel_station_id');
    }

    public function pump(): BelongsTo
    {
        return $this->belongsTo(FuelPump::class, 'fuel_pump_id');
    }

    public function tank(): BelongsTo
    {
        return $this->belongsTo(FuelTank::class, 'fuel_tank_id');
    }

    public function fuelProduct(): BelongsTo
    {
        return $this->belongsTo(FuelProduct::class);
    }
}
