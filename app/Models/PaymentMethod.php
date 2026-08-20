<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/**
 * طريقة دفع معرفة للمؤسسة.
 *
 * تحدد لغة وسيلة الدفع ووجهتها المالية ورسوم المعالجة، لكنها لا تولد قيداً بذاتها.
 * يلتقط PaymentService قيم الرسوم وحساب المصروف في سند الدفع قبل الترحيل حتى لا
 * تعيد تعديلات الإعدادات اللاحقة تفسير سند مسودة أو سند مرحل.
 */
class PaymentMethod extends BaseModel implements CompanyWide
{
    protected $fillable = [
        'tenant_id',
        'name',
        'name_en',
        'settlement_type',
        'cash_bank_account_id',
        'instructions',
        'available_online',
        'is_active',
        'is_default',
        'fees_enabled',
        'fee_rate_bps',
        'fee_fixed_amount',
        'fee_min_amount',
        'fee_tax_rate',
        'fee_expense_account_id',
    ];

    protected $casts = [
        'available_online' => 'boolean',
        'is_active' => 'boolean',
        'is_default' => 'boolean',
        'fees_enabled' => 'boolean',
        'fee_rate_bps' => 'integer',
        'fee_fixed_amount' => 'integer',
        'fee_min_amount' => 'integer',
        'fee_tax_rate' => 'integer',
    ];

    protected $attributes = [
        'settlement_type' => 'cash',
        'available_online' => false,
        'is_active' => true,
        'is_default' => false,
        'fees_enabled' => false,
        'fee_rate_bps' => 0,
        'fee_fixed_amount' => 0,
        'fee_min_amount' => 0,
        'fee_tax_rate' => 0,
    ];

    /** الخزينة أو الحساب البنكي الذي يستقبل أو يصرف أصل دفعة الطريقة. */
    public function cashBankAccount(): BelongsTo
    {
        return $this->belongsTo(CashBankAccount::class, 'cash_bank_account_id');
    }

    /** حساب المصروف الذي تحمل عليه المؤسسة عمولة هذه الطريقة. */
    public function feeExpenseAccount(): BelongsTo
    {
        return $this->belongsTo(Account::class, 'fee_expense_account_id');
    }

    /** السندات التي اختارت الطريقة؛ تمنع حذف إعداد ذي أثر تدقيقي. */
    public function payments(): HasMany
    {
        return $this->hasMany(Payment::class);
    }
}
