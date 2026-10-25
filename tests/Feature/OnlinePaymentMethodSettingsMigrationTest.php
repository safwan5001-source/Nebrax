<?php

namespace Tests\Feature;

use App\Models\Tenant;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * PAY-SETTINGS-UX-2 — هجرة البوابة الافتراضية وأماكن الاستخدام: إضافية، والصفوف القائمة لا يتغيّر سلوكها (لا ظهور صامت في المتجر)، والتراجع يرفض متى وُجدت بيانات.
 */
class OnlinePaymentMethodSettingsMigrationTest extends TestCase
{
    use RefreshDatabase;

    private const PATH = 'database/migrations/2026_12_11_010000_add_usage_and_default_gateway_to_online_payment_method_settings.php';

    #[Test]
    public function existing_rows_keep_the_store_off_while_new_rows_default_to_on_and_rollback_refuses_with_data(): void
    {
        $this->assertSame(0, Artisan::call('migrate:rollback', ['--path' => self::PATH, '--force' => true]));
        $this->assertFalse(Schema::hasColumn('online_payment_method_settings', 'use_in_store'));

        $tenant = Tenant::create(['name' => 'T', 'slug' => 't-'.Str::random(6), 'currency' => 'SAR', 'is_active' => true]);
        DB::table('online_payment_method_settings')->insert([
            'id' => (string) Str::uuid(), 'tenant_id' => $tenant->id, 'method_key' => 'mada', 'enabled' => true, 'created_at' => now(), 'updated_at' => now(),
        ]);

        $this->assertSame(0, Artisan::call('migrate', ['--path' => self::PATH, '--force' => true]));
        $old = DB::table('online_payment_method_settings')->where('method_key', 'mada')->first();
        $this->assertFalse((bool) $old->use_in_store, 'الصف القائم لا يظهر في المتجر بلا قرار');
        $this->assertTrue((bool) $old->use_in_invoices);
        $this->assertNull($old->default_gateway_id);

        DB::table('online_payment_method_settings')->insert([
            'id' => (string) Str::uuid(), 'tenant_id' => $tenant->id, 'method_key' => 'visa', 'enabled' => false, 'created_at' => now(), 'updated_at' => now(),
        ]);
        $this->assertTrue((bool) DB::table('online_payment_method_settings')->where('method_key', 'visa')->value('use_in_store'));

        $this->expectException(\RuntimeException::class);
        $this->expectExceptionMessage('Rollback refused');
        Artisan::call('migrate:rollback', ['--path' => self::PATH, '--force' => true]);
    }
}
