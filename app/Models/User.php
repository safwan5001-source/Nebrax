<?php

namespace App\Models;

use App\Support\Rbac;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Laravel\Sanctum\HasApiTokens;

class User extends Authenticatable
{
    use HasUuids, HasApiTokens, SoftDeletes;

    public $incrementing = false;
    protected $keyType = 'string';

    protected $fillable = [
        'tenant_id', 'employee_id', 'name', 'email', 'phone', 'password', 'role', 'permissions', 'preferences', 'is_active',
    ];

    protected $hidden = ['password', 'remember_token'];

    protected $casts = [
        'email_verified_at' => 'datetime',
        'password'          => 'hashed',
        'permissions'       => 'array',
        'preferences'       => 'array',
        'is_active'         => 'boolean',
    ];

    public function tenant(): BelongsTo
    {
        return $this->belongsTo(Tenant::class);
    }

    /** الفروع المسنَدة إلى المستخدم. **فارغة = كل الفروع** (سلوك ما قبل التقييد). */
    public function branches(): BelongsToMany
    {
        return $this->belongsToMany(Branch::class, 'branch_user')->withTimestamps();
    }

    /** المستودعات المسنَدة إليه. **فارغة = كل المستودعات**. */
    public function warehouses(): BelongsToMany
    {
        return $this->belongsToMany(Warehouse::class, 'user_warehouse')->withTimestamps();
    }

    /**
     * معرّفات فروعه، أو `null` إن كان غير مقيَّد.
     *
     * **التمييز بين `null` و`[]` جوهريّ:** `null` تعني «بلا قيد» فتُهمَل
     * التصفية، و`[]` لا تُعاد أبداً — إذ لو أُعيدت لصار مستخدمٌ بلا إسناد
     * محجوباً عن كل شيء، وهو انقلابٌ صامت في سلوك كل مستأجر قائم.
     *
     * @return array<int, string>|null
     */
    public function allowedBranchIds(): ?array
    {
        $ids = $this->branches()->pluck('branches.id')->all();

        return $ids === [] ? null : $ids;
    }

    /** @return array<int, string>|null معرّفات مستودعاته، أو `null` إن كان غير مقيَّد. */
    public function allowedWarehouseIds(): ?array
    {
        $ids = $this->warehouses()->pluck('warehouses.id')->all();

        return $ids === [] ? null : $ids;
    }

    /** هل يملك المستخدم الوصول إلى هذا الفرع؟ (غير المقيَّد يملك الكلّ) */
    public function canAccessBranch(?string $branchId): bool
    {
        $allowed = $this->allowedBranchIds();

        return $allowed === null || ($branchId !== null && in_array($branchId, $allowed, true));
    }

    /** هل يملك الوصول إلى هذا المستودع؟ (غير المقيَّد يملك الكلّ) */
    public function canAccessWarehouse(?string $warehouseId): bool
    {
        $allowed = $this->allowedWarehouseIds();

        return $allowed === null || ($warehouseId !== null && in_array($warehouseId, $allowed, true));
    }

    /**
     * سجلّ الموظف الذي يمثّله هذا المستخدم (إن وُجد).
     * غيابه يعني حساب دخول غير مرتبط بموظف (المالك الأول مثلاً) — توافق رجعي.
     */
    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    /** هل يملك المستخدم الصلاحية المطلوبة حسب دوره؟ */
    public function hasPermission(string $permission): bool
    {
        return Rbac::allows($this->role, $permission);
    }
}
