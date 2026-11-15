<?php

namespace App\Models;

use App\Support\GeneratesDocumentNumbers;
use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use LogicException;

/**
 * TANKER-PR4 — سند تعبئة صهريج (سجل تشغيلي مستقل لكل تعبئة).
 *
 * **ليس حركة مخزون ولا فاتورة ولا قيداً ولا تحصيلاً:** `inventory_status = pending_integration` يعلن أن السند المسجَّل لم يُدمج مخزنياً بعد (PR-6)؛ لا تعتبره
 * خروجاً مكتملاً من الخزان. ممنوع هنا أي ربط بـ`StockMovement`/`JournalEntry`/`Invoice` قبل اعتماد قواعد التكامل.
 *
 * - `number` رقم إلكتروني متسلسل (`FTF-YYYY-00001`) مستقل عن `voucher_number` (السند الورقي بخط الموظف/المورّد). لا يخلط أحدهما بالآخر في أي سطح.
 * - غير قابل للتعديل: الانتقال الوحيد `recorded → voided` (سبب + منفّذ + وقت). لا حذف أبداً (يبقى رقم السند محجوزاً) — يحرسه مُشغّل قاعدة بيانات أيضاً.
 * - `BranchScoped`: سجل تشغيلي يتبع فرع محطته. الكتابة عبر `FuelTankerFillService` وحده.
 */
class FuelTankerFill extends BaseModel
{
    use BranchScoped;
    use GeneratesDocumentNumbers;

    public const STATUS_RECORDED = 'recorded';
    public const STATUS_VOIDED = 'voided';
    public const STATUSES = [self::STATUS_RECORDED, self::STATUS_VOIDED];

    /** السند لم يُدمج مخزنياً بعد؛ يتغيّر فقط بهجرة التكامل المعتمدة (PR-6). */
    public const INVENTORY_PENDING_INTEGRATION = 'pending_integration';

    /**
     * TANKER-PR6B-2 — حالتان **مُجهَّزتان في القاعدة فقط**: لا مسار يكتبهما الآن (النموذج يرفض أي تعديل لـ`inventory_status`، والترحيل غير مبنيّ). تنتقل بمُشغّلات متزامنة
     * مع جدول `fuel_tanker_fill_inventory_postings` حصراً (`pending_integration → posted → reversed`، بلا قفز ولا رجوع)؛ الكاتب الوحيد المستقبلي = PR-6B-3.
     */
    public const INVENTORY_POSTED = 'posted';
    public const INVENTORY_REVERSED = 'reversed';
    public const INVENTORY_STATUSES = [self::INVENTORY_PENDING_INTEGRATION, self::INVENTORY_POSTED, self::INVENTORY_REVERSED];

    public const SCOPE_STATION = 'station';
    public const SCOPE_TENANT = 'tenant';
    public const SCOPE_OWNER = 'owner';
    public const SCOPE_NONE = 'none';

    protected $fillable = [
        'tenant_id', 'branch_id', 'fuel_station_id', 'fuel_shift_id', 'fuel_pump_id', 'fuel_nozzle_id', 'fuel_tank_id', 'fuel_product_id',
        'fuel_tanker_owner_id', 'fuel_tanker_id', 'number', 'voucher_number', 'voucher_key', 'voucher_scope', 'voucher_scope_key',
        'quantity_milliliters', 'tanker_capacity_milliliters', 'capacity_overrun_milliliters', 'capacity_overrun_policy',
        'capacity_overrun_confirmed_by', 'capacity_overrun_confirmed_at', 'policy_snapshot', 'notes', 'status', 'inventory_status',
        'idempotency_key', 'request_fingerprint', 'recorded_by', 'recorded_at', 'voided_by', 'voided_at', 'void_reason',
    ];

    protected $casts = [
        'quantity_milliliters' => 'integer',
        'tanker_capacity_milliliters' => 'integer',
        'capacity_overrun_milliliters' => 'integer',
        'policy_snapshot' => 'array',
        'capacity_overrun_confirmed_at' => 'datetime',
        'recorded_at' => 'datetime',
        'voided_at' => 'datetime',
    ];

    protected $attributes = [
        'status' => self::STATUS_RECORDED,
        'inventory_status' => self::INVENTORY_PENDING_INTEGRATION,
    ];

    /** حقول الإلغاء الوحيدة القابلة للتغيير (مع الطابع الزمني) — كل ما عداها ثابت بعد الإنشاء. */
    private const VOID_FIELDS = ['status', 'voided_by', 'voided_at', 'void_reason', 'updated_at'];

    protected static function booted(): void
    {
        static::creating(function (self $fill): void {
            if ((int) $fill->quantity_milliliters <= 0) {
                throw new LogicException('كمية تعبئة الصهريج يجب أن تكون موجبة.');
            }
            if ($fill->status !== self::STATUS_RECORDED || $fill->inventory_status !== self::INVENTORY_PENDING_INTEGRATION) {
                throw new LogicException('يُنشأ سند التعبئة مسجَّلاً وغير مدمج مخزنياً فقط.');
            }
        });
        static::updating(function (self $fill): void {
            if (array_diff(array_keys($fill->getDirty()), self::VOID_FIELDS) !== []) {
                throw new LogicException('سند التعبئة غير قابل للتعديل؛ الانتقال الوحيد المسموح هو الإلغاء بسبب.');
            }
            if ($fill->isDirty('status') && ($fill->getOriginal('status') !== self::STATUS_RECORDED || $fill->status !== self::STATUS_VOIDED)) {
                throw new LogicException('الانتقال المسموح الوحيد هو من «مسجَّل» إلى «ملغى».');
            }
            if ($fill->getOriginal('status') === self::STATUS_VOIDED) {
                throw new LogicException('السند الملغى لا يتغيّر.');
            }
            if ($fill->isDirty('status') && $fill->getOriginal('inventory_status') === self::INVENTORY_POSTED) {
                throw new LogicException('لا يُلغى سند مرحَّل مخزنياً (posted)؛ يُعكس الترحيل أولاً (العكس والإلغاء عمليتان منفصلتان).');
            }
        });
        static::deleting(fn () => throw new LogicException('سند التعبئة لا يُحذف؛ يُلغى بسبب ويبقى رقم السند محجوزاً.'));
    }

    /**
     * تطبيع رقم السند الورقي: نص حرفي بلا تحويل رقمي (الأصفار البادئة تبقى: `04052` ≠ `4052`).
     * `display` = ما يُحفظ ويُعرض (قصّ + أرقام عربية/فارسية → 0-9 + مسافة واحدة)، `key` = مفتاح المنع (أحرف صغيرة بلا مسافات).
     *
     * @return array{display:string,key:string}|null  null إن كان الرقم غير صالح (فارغ، بلا حرف/رقم، أحرف غير مسموحة، أطول من 64)
     */
    public static function normalizeVoucher(string $raw): ?array
    {
        $digits = ['٠' => '0', '١' => '1', '٢' => '2', '٣' => '3', '٤' => '4', '٥' => '5', '٦' => '6', '٧' => '7', '٨' => '8', '٩' => '9',
            '۰' => '0', '۱' => '1', '۲' => '2', '۳' => '3', '۴' => '4', '۵' => '5', '۶' => '6', '۷' => '7', '۸' => '8', '۹' => '9'];
        $display = trim(preg_replace('/\s+/u', ' ', strtr($raw, $digits)) ?? '');
        if ($display === '' || mb_strlen($display) > 64 || preg_match('/^[\p{L}\p{N}][\p{L}\p{N}\-\/._# ]*$/u', $display) !== 1) {
            return null;
        }

        $key = mb_strtolower(str_replace(' ', '', $display));
        if (mb_strlen($key) > 128) { // تصغير Unicode قد يضاعف الطول (`İ` ⇒ حرفان): حدّ المفتاح المخزَّن.
            return null;
        }

        return ['display' => $display, 'key' => $key];
    }

    public function station(): BelongsTo { return $this->belongsTo(FuelStation::class, 'fuel_station_id'); }
    public function shift(): BelongsTo { return $this->belongsTo(FuelShift::class, 'fuel_shift_id'); }
    public function pump(): BelongsTo { return $this->belongsTo(FuelPump::class, 'fuel_pump_id'); }
    public function nozzle(): BelongsTo { return $this->belongsTo(FuelNozzle::class, 'fuel_nozzle_id'); }
    public function tank(): BelongsTo { return $this->belongsTo(FuelTank::class, 'fuel_tank_id'); }
    public function fuelProduct(): BelongsTo { return $this->belongsTo(FuelProduct::class, 'fuel_product_id'); }
    public function owner(): BelongsTo { return $this->belongsTo(FuelTankerOwner::class, 'fuel_tanker_owner_id'); }
    public function tanker(): BelongsTo { return $this->belongsTo(FuelTanker::class, 'fuel_tanker_id'); }
    public function recorder(): BelongsTo { return $this->belongsTo(User::class, 'recorded_by'); }
    public function voider(): BelongsTo { return $this->belongsTo(User::class, 'voided_by'); }

    /** TANKER-PR5: المرفقات النشطة فقط (المُزالة/المُستبدَلة سجل تاريخي يُقرأ عبر خدمة المرفقات). */
    public function activeAttachments(): HasMany
    {
        return $this->hasMany(FuelTankerFillAttachment::class, 'fuel_tanker_fill_id')->where('status', FuelTankerFillAttachment::STATUS_ACTIVE);
    }
}
