<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\Relations\HasMany;

/** نوع توظيف — كيانٌ مُدار لكل مؤسسة، يتبع تصنيف Employee (CompanyWide). */
class EmploymentType extends BaseModel implements CompanyWide
{
    protected $fillable = ['tenant_id', 'name', 'is_active'];

    protected $casts = ['is_active' => 'boolean'];

    protected $attributes = ['is_active' => true];

    public function employees(): HasMany
    {
        return $this->hasMany(Employee::class);
    }
}
