<?php

namespace App\Support;

use App\Models\User;

/** شكل المستخدم في ردود الدخول و`/me` — مصدر واحد لدخول البريد ودخول المحطات. */
final class AuthUserPayload
{
    /** @return array<string, mixed> */
    public static function for(User $user): array
    {
        return [
            'id'        => $user->id,
            'name'      => $user->name,
            'email'     => $user->email,
            'role'        => $user->role,
            'permissions' => Rbac::permissionsForRole($user->role),
            'employee_id' => $user->employee_id,
            'tenant_id'   => $user->tenant_id,
            'preferences' => $user->preferences ?? ['locale' => 'ar', 'theme' => 'system', 'appTheme' => 'default'],
        ];
    }
}
