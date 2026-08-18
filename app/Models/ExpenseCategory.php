<?php

namespace App\Models;

use App\Tenancy\BranchScoped;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * تصنيف المصروف: تسمية تشغيلية وتحليلية، لا بديل عن حساب المصروف ولا أثر لها
 * في توليد القيد. عزلها فرعي لأن قائمة التصنيفات المتاحة للفرع تدخل في إنشاء
 * المستند وتصفحه.
 */
class ExpenseCategory extends BaseModel
{
    use BranchScoped;
    use SoftDeletes;

    protected $fillable = ['tenant_id', 'branch_id', 'name', 'description', 'is_active'];

    protected $casts = ['is_active' => 'boolean'];

    protected $attributes = ['is_active' => true];

    public function expenses(): HasMany
    {
        return $this->hasMany(Expense::class, 'category_id');
    }
}
