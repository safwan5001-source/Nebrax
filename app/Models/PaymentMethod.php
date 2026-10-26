<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** طريقة دفع تشغيلية مشتركة للمؤسسة، بلا رسوم أو أثر محاسبي مستقل. */
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
        'pos_clearing_gateway_id',
        'pos_terminal_required',
        // تخصيص بصري اختياري. مؤشّر الشعار (logo_path/logo_disk) خارج fillable عمداً: يكتبه المتحكّم وحده بعد رفع مفحوص.
        'visual_mode',
        'icon_key',
        'icon_color',
    ];

    protected $casts = [
        'available_online' => 'boolean',
        'is_active' => 'boolean',
        'is_default' => 'boolean',
        'pos_terminal_required' => 'boolean',
    ];

    protected $attributes = [
        'settlement_type' => 'cash',
        'available_online' => false,
        'is_active' => true,
        'is_default' => false,
    ];

    /** الخزينة أو الحساب البنكي الذي تقترحه الطريقة عند إنشاء السند. */
    public function cashBankAccount(): BelongsTo
    {
        return $this->belongsTo(CashBankAccount::class, 'cash_bank_account_id');
    }

    /**
     * D-09: اتصال المستحوذ الذي تُقاصّ عليه مبيعات POS بهذه الطريقة (NULL = مطفأ ⇒ A11، الافتراضي). يقرؤه `PosService` وحده عند إنشاء السند.
     */
    public function posClearingGateway(): BelongsTo
    {
        return $this->belongsTo(PaymentGateway::class, 'pos_clearing_gateway_id');
    }

    /** السندات التي اختارت الطريقة؛ تمنع حذف إعداد مستخدم. */
    public function payments(): HasMany
    {
        return $this->hasMany(Payment::class);
    }
}
