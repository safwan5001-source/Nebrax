<?php

namespace Tests\Feature;

use App\Models\CommerceCart;
use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\Tenant;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * Cart One-Shot Lifecycle — migration
 * `2026_10_04_010000_add_consumed_status_to_commerce_carts`.
 *
 * SQLite and PostgreSQL represent `commerce_carts.status` differently
 * (verified against the live schema before writing the migration, not
 * assumed): SQLite has no CHECK constraint on the column at all (a plain
 * `varchar` — Laravel's SQLite grammar never emitted one for `enum()`
 * here), while PostgreSQL has a named CHECK constraint
 * (`commerce_carts_status_check`). The migration is a no-op on SQLite and
 * a `DROP CONSTRAINT` + `ADD CONSTRAINT` on PostgreSQL — this test proves
 * both branches instead of assuming a single representation.
 */
class CommerceCartConsumedStatusMigrationTest extends TestCase
{
    use RefreshDatabase;

    private const MIGRATION = '2026_10_04_010000_add_consumed_status_to_commerce_carts.php';

    /** @return array{tenant: Tenant, channel: SalesChannel, storefront: Storefront} */
    private function seedContext(string $slug): array
    {
        $tenant = Tenant::create([
            'name' => "مستأجر ترحيل {$slug}", 'slug' => 'cart-migration-'.$slug.'-'.Str::random(6),
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenant->id);
        $channel = SalesChannel::create([
            'slug' => 'web', 'name' => 'Web', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true,
        ]);
        $storefront = Storefront::create([
            'slug' => 'main', 'name' => 'Main', 'sales_channel_id' => $channel->id, 'is_active' => true,
        ]);

        return ['tenant' => $tenant, 'channel' => $channel, 'storefront' => $storefront];
    }

    private function makeCart(array $ctx, string $status): CommerceCart
    {
        return CommerceCart::create([
            'storefront_id' => $ctx['storefront']->id,
            'sales_channel_id' => $ctx['channel']->id,
            'token_hash' => hash('sha256', 'migration-cart-'.Str::random(16)),
            'status' => $status,
            'expires_at' => now()->addDay(),
        ]);
    }

    #[Test]
    public function existing_active_and_expired_rows_survive_up_and_active_stays_default(): void
    {
        $ctx = $this->seedContext('survive');
        $active = $this->makeCart($ctx, CommerceCart::STATUS_ACTIVE);
        $expired = $this->makeCart($ctx, CommerceCart::STATUS_EXPIRED);
        app(TenantContext::class)->forget();

        // Migration already ran as part of the base schema in RefreshDatabase —
        // re-running up() here proves it is safe to run twice and does not
        // touch existing rows either way.
        $migration = require database_path('migrations/'.self::MIGRATION);
        $migration->up();

        $this->assertSame(CommerceCart::STATUS_ACTIVE, $active->fresh()->status);
        $this->assertSame(CommerceCart::STATUS_EXPIRED, $expired->fresh()->status);

        $insertedId = (string) Str::uuid();
        DB::table('commerce_carts')->insert([
            'id' => $insertedId,
            'tenant_id' => $ctx['tenant']->id,
            'storefront_id' => $ctx['storefront']->id,
            'sales_channel_id' => $ctx['channel']->id,
            'token_hash' => hash('sha256', 'default-status-'.Str::random(8)),
            'expires_at' => now()->addDay(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->assertSame(CommerceCart::STATUS_ACTIVE, DB::table('commerce_carts')->where('id', $insertedId)->value('status'));
    }

    #[Test]
    public function consumed_can_be_persisted_after_up(): void
    {
        $ctx = $this->seedContext('consumed-ok');
        $cart = $this->makeCart($ctx, CommerceCart::STATUS_ACTIVE);

        $cart->update(['status' => CommerceCart::STATUS_CONSUMED]);
        $this->assertSame(CommerceCart::STATUS_CONSUMED, $cart->fresh()->status);
        app(TenantContext::class)->forget();
    }

    #[Test]
    public function all_original_constraints_and_indexes_remain_after_up(): void
    {
        $ctx = $this->seedContext('constraints-remain');
        app(TenantContext::class)->forget();

        // FKs: tenant_id cascade, storefront_id/sales_channel_id restrict — unchanged.
        $this->expectException(QueryException::class);
        DB::table('commerce_carts')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $ctx['tenant']->id,
            'storefront_id' => (string) Str::uuid(), // non-existent storefront
            'sales_channel_id' => $ctx['channel']->id,
            'token_hash' => hash('sha256', 'bad-fk-'.Str::random(8)),
            'expires_at' => now()->addDay(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    #[Test]
    public function token_hash_unique_constraint_remains_after_up(): void
    {
        $ctx = $this->seedContext('unique-remains');
        $hash = hash('sha256', 'duplicate-token-'.Str::random(8));
        DB::table('commerce_carts')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $ctx['tenant']->id,
            'storefront_id' => $ctx['storefront']->id,
            'sales_channel_id' => $ctx['channel']->id,
            'token_hash' => $hash,
            'expires_at' => now()->addDay(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        app(TenantContext::class)->forget();

        $this->expectException(QueryException::class);
        DB::table('commerce_carts')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $ctx['tenant']->id,
            'storefront_id' => $ctx['storefront']->id,
            'sales_channel_id' => $ctx['channel']->id,
            'token_hash' => $hash,
            'expires_at' => now()->addDay(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    #[Test]
    public function postgres_check_constraint_is_widened_to_accept_consumed_and_still_rejects_arbitrary_values(): void
    {
        if (DB::connection()->getDriverName() !== 'pgsql') {
            $this->markTestSkipped('CHECK constraint موجود على PostgreSQL فقط — SQLite لا يفرض واحداً على هذا العمود.');
        }

        $ctx = $this->seedContext('pg-check');
        app(TenantContext::class)->forget();

        // 'consumed' مقبولة الآن.
        DB::table('commerce_carts')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $ctx['tenant']->id,
            'storefront_id' => $ctx['storefront']->id,
            'sales_channel_id' => $ctx['channel']->id,
            'token_hash' => hash('sha256', 'pg-consumed-'.Str::random(8)),
            'status' => CommerceCart::STATUS_CONSUMED,
            'expires_at' => now()->addDay(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
        $this->assertDatabaseHas('commerce_carts', ['status' => CommerceCart::STATUS_CONSUMED]);

        // قيمةٌ عشوائية تبقى مرفوضة — القيد ما زال يفرض قائمة القيم المسموحة، لا يُفتح بلا حدود.
        $this->expectException(QueryException::class);
        DB::table('commerce_carts')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $ctx['tenant']->id,
            'storefront_id' => $ctx['storefront']->id,
            'sales_channel_id' => $ctx['channel']->id,
            'token_hash' => hash('sha256', 'pg-invalid-'.Str::random(8)),
            'status' => 'not-a-real-status',
            'expires_at' => now()->addDay(),
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    #[Test]
    public function down_succeeds_when_no_consumed_rows_exist_and_restores_the_active_expired_restriction(): void
    {
        $ctx = $this->seedContext('down-clean');
        $this->makeCart($ctx, CommerceCart::STATUS_ACTIVE);
        $this->makeCart($ctx, CommerceCart::STATUS_EXPIRED);
        app(TenantContext::class)->forget();

        $migration = require database_path('migrations/'.self::MIGRATION);
        $migration->down();

        $this->assertSame(2, DB::table('commerce_carts')->count());

        if (DB::connection()->getDriverName() !== 'pgsql') {
            $migration->up();

            return;
        }

        $this->expectException(QueryException::class);

        try {
            DB::table('commerce_carts')->insert([
                'id' => (string) Str::uuid(),
                'tenant_id' => $ctx['tenant']->id,
                'storefront_id' => $ctx['storefront']->id,
                'sales_channel_id' => $ctx['channel']->id,
                'token_hash' => hash('sha256', 'post-down-consumed-'.Str::random(8)),
                'status' => CommerceCart::STATUS_CONSUMED,
                'expires_at' => now()->addDay(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
        } finally {
            $migration->up();
        }
    }

    #[Test]
    public function down_refuses_when_a_consumed_row_exists_and_does_not_modify_or_delete_data(): void
    {
        $ctx = $this->seedContext('down-refuse');
        $active = $this->makeCart($ctx, CommerceCart::STATUS_ACTIVE);
        $consumed = $this->makeCart($ctx, CommerceCart::STATUS_ACTIVE);
        $consumed->update(['status' => CommerceCart::STATUS_CONSUMED]);
        app(TenantContext::class)->forget();

        $migration = require database_path('migrations/'.self::MIGRATION);

        try {
            $migration->down();
            $this->fail('يجب أن يرفض down() التراجع بوجود صفّ consumed.');
        } catch (\RuntimeException $exception) {
            $this->assertStringContainsString('consumed', $exception->getMessage());
        }

        // لا تعديل ولا حذف: الصفّان كما هما، والقيد الموسَّع (إن وُجد) ما زال يقبل consumed.
        $this->assertSame(CommerceCart::STATUS_ACTIVE, $active->fresh()->status);
        $this->assertSame(CommerceCart::STATUS_CONSUMED, $consumed->fresh()->status);
        $this->assertSame(2, DB::table('commerce_carts')->count());
    }
}
