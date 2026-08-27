<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    /** @var array<int,string> */
    private const PERMISSIONS = [
        'documents.center.operations',
        'documents.center.retry',
        'documents.center.usage',
        'documents.center.audit_export',
    ];

    public function up(): void
    {
        if (! Schema::hasTable('roles')) {
            return;
        }
        // owner/admin في المصدر الثابت يملكان *؛ نصلح فقط صفوف النظام التاريخية
        // التي خزنت قائمة صريحة، بلا لمس custom role أو accountant/staff.
        DB::table('roles')->where('is_system', true)->whereIn('slug', ['owner', 'admin'])->orderBy('id')->each(function ($role): void {
            $permissions = json_decode((string) $role->permissions, true);
            if (! is_array($permissions) || in_array('*', $permissions, true)) {
                return;
            }
            $updated = array_values(array_unique(array_merge($permissions, self::PERMISSIONS)));
            DB::table('roles')->where('id', $role->id)->update([
                'permissions' => json_encode($updated, JSON_THROW_ON_ERROR),
                'updated_at' => now(),
            ]);
        });
    }

    public function down(): void
    {
        if (! Schema::hasTable('roles')) {
            return;
        }
        DB::table('roles')->where('is_system', true)->whereIn('slug', ['owner', 'admin'])->orderBy('id')->each(function ($role): void {
            $permissions = json_decode((string) $role->permissions, true);
            if (! is_array($permissions) || in_array('*', $permissions, true)) {
                return;
            }
            $updated = array_values(array_diff($permissions, self::PERMISSIONS));
            DB::table('roles')->where('id', $role->id)->update([
                'permissions' => json_encode($updated, JSON_THROW_ON_ERROR),
                'updated_at' => now(),
            ]);
        });
    }
};
