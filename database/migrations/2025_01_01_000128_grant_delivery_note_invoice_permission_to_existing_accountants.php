<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    private const PERMISSION = 'delivery_notes.invoice';

    /**
     * التسجيلات الجديدة تأخذ الصلاحية من Rbac::MATRIX. أما التسجيلات القائمة
     * فلها صف role محفوظ هو مصدر الحقيقة، ولذلك نضيف الصلاحية إلى المحاسب
     * النظامي فقط مع الإبقاء على أي صلاحيات حالية كما هي. لا تمس الهجرة دوراً
     * مخصصاً أو owner/admin (اللذان يملكان * أصلاً) أو staff.
     */
    public function up(): void
    {
        $now = now();

        DB::table('roles')
            ->where('slug', 'accountant')
            ->where('is_system', true)
            ->orderBy('id')
            ->get()
            ->each(function (object $role) use ($now): void {
                $permissions = $this->permissions($role->permissions);
                if (in_array(self::PERMISSION, $permissions, true)) {
                    return;
                }

                $permissions[] = self::PERMISSION;
                DB::table('roles')->where('id', $role->id)->update([
                    'permissions' => json_encode(array_values(array_unique($permissions))),
                    'updated_at' => $now,
                ]);
            });
    }

    /** يعكس backfill المحاسب النظامي وحده؛ لا يحذف أو يعيد كتابة أي دور مخصص. */
    public function down(): void
    {
        $now = now();

        DB::table('roles')
            ->where('slug', 'accountant')
            ->where('is_system', true)
            ->orderBy('id')
            ->get()
            ->each(function (object $role) use ($now): void {
                $permissions = array_values(array_filter(
                    $this->permissions($role->permissions),
                    fn (string $permission): bool => $permission !== self::PERMISSION,
                ));

                DB::table('roles')->where('id', $role->id)->update([
                    'permissions' => json_encode($permissions),
                    'updated_at' => $now,
                ]);
            });
    }

    /** @return array<int,string> */
    private function permissions(mixed $stored): array
    {
        $decoded = is_array($stored) ? $stored : json_decode((string) $stored, true);

        return is_array($decoded)
            ? array_values(array_filter($decoded, 'is_string'))
            : [];
    }
};
