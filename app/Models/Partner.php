<?php

namespace App\Models;

use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * طرف تجاري: عميل أو مورد (أو كلاهما).
 * بيانات أساسية تُربط بسطور القيد عبر (partner_type, partner_id) لكشوف الحساب.
 */
class Partner extends BaseModel
{
    use SoftDeletes;

    protected $fillable = [
        'tenant_id', 'code', 'type', 'name', 'name_en',
        'vat_number', 'cr_number', 'email', 'phone', 'address', 'city', 'is_active',
    ];

    protected $casts = [
        'is_active' => 'boolean',
    ];

    protected $attributes = [
        'type'      => 'customer',
        'is_active' => true,
    ];

    public function isCustomer(): bool
    {
        return in_array($this->type, ['customer', 'both'], true);
    }

    public function isSupplier(): bool
    {
        return in_array($this->type, ['supplier', 'both'], true);
    }
}
