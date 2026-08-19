<?php

namespace App\Models;

use App\Tenancy\CompanyWide;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * @see design-system/foundations/hr-users-architecture.md — قسم ٣
 * دور صلاحيات قابل للضبط لكل مؤسسة، بديلاً عن `Rbac::MATRIX` الثابتة.
 *
 * **`CompanyWide`**: الأدوار تخصّ المؤسسة كلها لا فرعاً (كالمستخدمين والحسابات).
 * `slug` هو ما يشير إليه `users.role`. `is_system` يحمي الأدوار الأصلية الأربعة.
 * `permissions` مصفوفة؛ `["*"]` تعني كل الصلاحيات.
 */
class Role extends BaseModel implements CompanyWide
{
    use SoftDeletes;

    protected $fillable = [
        'tenant_id', 'slug', 'name', 'permissions', 'is_system',
    ];

    protected $casts = [
        'permissions' => 'array',
        'is_system'   => 'boolean',
    ];

    /** هل يمنح هذا الدور الصلاحية المطلوبة؟ (`*` يمنح الكلّ) */
    public function grants(string $permission): bool
    {
        $perms = $this->permissions ?? [];

        return in_array('*', $perms, true) || in_array($permission, $perms, true);
    }

    /** الدور محميّ من التعديل الهيكلي (المالك) أو الحذف (كل دورٍ نظامي). */
    public function isOwner(): bool
    {
        return $this->slug === 'owner';
    }
}
