<?php

namespace Tests\Feature;

use App\Models\CommerceCart;
use App\Models\CommerceCheckout;
use App\Models\CommerceOrder;
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

    private function makeCheckout(array $ctx, CommerceCart $cart, string $status): CommerceCheckout
    {
        return CommerceCheckout::create([
            'storefront_id' => $ctx['storefront']->id,
            'sales_channel_id' => $ctx['channel']->id,
            'cart_id' => $cart->id,
            'status' => $status,
            'expires_at' => now()->addHour(),
        ]);
    }

    private function makeOrder(array $ctx, CommerceCheckout $checkout): CommerceOrder
    {
        return CommerceOrder::create([
            'sales_channel_id' => $ctx['channel']->id,
            'storefront_id' => $ctx['storefront']->id,
            'commerce_checkout_id' => $checkout->id,
            'number' => 'CORD-MIG-TEST-'.Str::random(8),
            'status' => CommerceOrder::STATUS_CONFIRMED,
            'total' => 1000,
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

    // ═══════════════════════════════════════════════════════════════
    //  Backfill (P1 review follow-up) — historical `active` Cart with a
    //  provable prior successful CommerceOrder must become `consumed`.
    // ═══════════════════════════════════════════════════════════════

    /** A) historical active cart + completed checkout + successful CommerceOrder → consumed. */
    #[Test]
    public function a_historical_active_cart_with_a_completed_checkout_and_order_is_backfilled_to_consumed(): void
    {
        $ctx = $this->seedContext('backfill-a');
        $cart = $this->makeCart($ctx, CommerceCart::STATUS_ACTIVE);
        $checkout = $this->makeCheckout($ctx, $cart, CommerceCheckout::STATUS_COMPLETED);
        $this->makeOrder($ctx, $checkout);
        app(TenantContext::class)->forget();

        $migration = require database_path('migrations/'.self::MIGRATION);
        $migration->up();

        $this->assertSame(CommerceCart::STATUS_CONSUMED, $cart->fresh()->status);
    }

    /** B) historical active cart + open/incomplete checkout, no CommerceOrder → stays active. */
    #[Test]
    public function a_historical_active_cart_with_an_open_checkout_and_no_order_stays_active(): void
    {
        $ctx = $this->seedContext('backfill-b');
        $cart = $this->makeCart($ctx, CommerceCart::STATUS_ACTIVE);
        $this->makeCheckout($ctx, $cart, CommerceCheckout::STATUS_ACTIVE);
        app(TenantContext::class)->forget();

        $migration = require database_path('migrations/'.self::MIGRATION);
        $migration->up();

        $this->assertSame(CommerceCart::STATUS_ACTIVE, $cart->fresh()->status);
    }

    /** C) historical active cart with no Checkout/Order at all → stays active. */
    #[Test]
    public function a_historical_active_cart_with_no_checkout_or_order_stays_active(): void
    {
        $ctx = $this->seedContext('backfill-c');
        $cart = $this->makeCart($ctx, CommerceCart::STATUS_ACTIVE);
        app(TenantContext::class)->forget();

        $migration = require database_path('migrations/'.self::MIGRATION);
        $migration->up();

        $this->assertSame(CommerceCart::STATUS_ACTIVE, $cart->fresh()->status);
    }

    /**
     * D) historical expired cart stays expired — even when it is (however
     * implausibly) linked to a completed checkout + order, proving the
     * backfill's `WHERE status = 'active'` guard is unconditional and never
     * reinterprets `expired`.
     */
    #[Test]
    public function a_historical_expired_cart_stays_expired_even_with_a_completed_checkout_and_order(): void
    {
        $ctx = $this->seedContext('backfill-d');
        $cart = $this->makeCart($ctx, CommerceCart::STATUS_EXPIRED);
        $checkout = $this->makeCheckout($ctx, $cart, CommerceCheckout::STATUS_COMPLETED);
        $this->makeOrder($ctx, $checkout);
        app(TenantContext::class)->forget();

        $migration = require database_path('migrations/'.self::MIGRATION);
        $migration->up();

        $this->assertSame(CommerceCart::STATUS_EXPIRED, $cart->fresh()->status);
    }

    /**
     * E) Cross-tenant fail-closed: a Checkout/Order pair carrying a
     * *different* tenant_id than the Cart it points `cart_id` at (a data
     * shape the `cart_id` foreign key alone does not forbid — it has no
     * same-tenant clause) must never flip that Cart. The explicit
     * `tenant_id`-matched `EXISTS` join is what refuses this, not
     * `TenantScope` (inactive inside a migration's raw `DB::table()` calls).
     */
    #[Test]
    public function cross_tenant_checkout_and_order_data_never_backfills_another_tenants_cart(): void
    {
        $tenantA = $this->seedContext('backfill-e-a');
        $cartA = $this->makeCart($tenantA, CommerceCart::STATUS_ACTIVE);
        app(TenantContext::class)->forget();

        $tenantB = $this->seedContext('backfill-e-b');
        app(TenantContext::class)->forget();

        // Checkout/Order both carry tenant B's tenant_id but point cart_id
        // at tenant A's cart — a cross-tenant shape the FK itself permits.
        app(TenantContext::class)->set($tenantB['tenant']->id);
        $crossCheckout = CommerceCheckout::create([
            'storefront_id' => $tenantB['storefront']->id,
            'sales_channel_id' => $tenantB['channel']->id,
            'cart_id' => $cartA->id,
            'status' => CommerceCheckout::STATUS_COMPLETED,
            'expires_at' => now()->addHour(),
        ]);
        $this->makeOrder($tenantB, $crossCheckout);
        app(TenantContext::class)->forget();

        $migration = require database_path('migrations/'.self::MIGRATION);
        $migration->up();

        // Tenant A's cart is untouched — the cross-tenant checkout/order pair
        // never counts as proof for it.
        $this->assertSame(CommerceCart::STATUS_ACTIVE, $cartA->fresh()->status);

        // Tenant B, meanwhile, has no cart of its own in this scenario, and
        // the migration must not have created or mutated anything for it.
        app(TenantContext::class)->set($tenantB['tenant']->id);
        $this->assertSame(0, CommerceCart::withoutGlobalScopes()->where('tenant_id', $tenantB['tenant']->id)->count());
        app(TenantContext::class)->forget();
    }

    /** F) rollback with real backfilled `consumed` rows fails closed, same contract as a normally-consumed row. */
    #[Test]
    public function down_refuses_after_a_real_backfill_produced_consumed_rows(): void
    {
        $ctx = $this->seedContext('backfill-f');
        $cart = $this->makeCart($ctx, CommerceCart::STATUS_ACTIVE);
        $checkout = $this->makeCheckout($ctx, $cart, CommerceCheckout::STATUS_COMPLETED);
        $this->makeOrder($ctx, $checkout);
        app(TenantContext::class)->forget();

        $migration = require database_path('migrations/'.self::MIGRATION);
        $migration->up();
        $this->assertSame(CommerceCart::STATUS_CONSUMED, $cart->fresh()->status);

        try {
            $migration->down();
            $this->fail('يجب أن يرفض down() التراجع بوجود صفّ consumed ناتج عن backfill.');
        } catch (\RuntimeException $exception) {
            $this->assertStringContainsString('consumed', $exception->getMessage());
        }

        $this->assertSame(CommerceCart::STATUS_CONSUMED, $cart->fresh()->status);
    }
}
