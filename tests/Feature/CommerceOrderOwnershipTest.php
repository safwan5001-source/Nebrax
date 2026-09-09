<?php

namespace Tests\Feature;

use App\Http\Middleware\EstablishCustomerContext;
use App\Models\CommerceOrder;
use App\Models\CustomerIdentity;
use App\Models\Partner;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Commerce\CommerceOrderService;
use App\Services\CustomerPartnerLinkService;
use App\Tenancy\CustomerContext;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use RuntimeException;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PR-COM-6B — Commerce Customer Ownership & Authorization Integration
 * ═══════════════════════════════════════════════════════════════
 *
 * Covers the two things COM-6B actually adds on top of COM-6A: persisted
 * order ownership (`commerce_orders.customer_identity_id`, server-derived
 * only) and the ownership-scoped read boundary
 * (`CommerceOrderService::ownedOrders()`/`findOwnedOrder()`). Drives the
 * real `EstablishCustomerContext` middleware, not a re-implementation,
 * exactly like `CommerceCustomerContextIntegrationTest` (COM-6A).
 *
 * Run: php artisan test --filter=CommerceOrderOwnershipTest
 */
class CommerceOrderOwnershipTest extends TestCase
{
    use RefreshDatabase;

    private CommerceOrderService $orders;
    private Product $product;
    private SalesChannel $channel;
    private Tenant $tenant;

    protected function setUp(): void
    {
        parent::setUp();

        $this->tenant = Tenant::create([
            'name' => 'نبراس الطموح', 'slug' => 'nibras-com6b',
            'vat_number' => '300000000000003', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($this->tenant->id);

        $this->product = Product::create(['name' => 'منتج طلب', 'sale_price' => 15000]);
        $this->channel = SalesChannel::create(['slug' => 'mobile', 'name' => 'متجرنا', 'type' => SalesChannel::TYPE_MOBILE]);
        $this->orders = app(CommerceOrderService::class);
    }

    private function items(int $quantity = 2): array
    {
        return [['product_id' => $this->product->id, 'quantity' => $quantity]];
    }

    private function identity(Tenant $tenant, string $email, bool $verified = true): CustomerIdentity
    {
        return CustomerIdentity::create([
            'tenant_id' => $tenant->id,
            'display_name' => 'Customer',
            'email' => $email,
            'password' => 'password123',
            'email_verified_at' => $verified ? now() : null,
            'is_active' => true,
        ]);
    }

    private function partner(Tenant $tenant, string $name): Partner
    {
        return Partner::create([
            'tenant_id' => $tenant->id,
            'name' => $name,
            'type' => 'customer',
            'is_active' => true,
        ]);
    }

    private function staffActor(Tenant $tenant): User
    {
        return User::create([
            'tenant_id' => $tenant->id,
            'name' => 'Owner',
            'email' => 'owner-com6b-' . $tenant->slug . '@nibras-com6b.test',
            'password' => 'password123',
            'role' => 'owner',
            'is_active' => true,
        ]);
    }

    private function link(CustomerIdentity $identity, Partner $partner): void
    {
        app(CustomerPartnerLinkService::class)->link($identity, $partner, $this->staffActor($identity->tenant));
    }

    /** Mirrors CommerceCustomerContextIntegrationTest's helper — drives the real middleware. */
    private function withEstablishedContext(CustomerIdentity|User $principal, callable $callback): mixed
    {
        $request = Request::create('/');
        $request->setUserResolver(fn () => $principal);

        $result = null;
        app(EstablishCustomerContext::class)->handle($request, function () use ($callback, &$result) {
            $result = $callback();

            return new \Symfony\Component\HttpFoundation\Response();
        });

        return $result;
    }

    private function createOrder(CustomerIdentity $identity, array $extraData = []): CommerceOrder
    {
        return $this->withEstablishedContext($identity, fn () => $this->orders->create(
            ['sales_channel_id' => $this->channel->id, ...$extraData],
            $this->items(),
        ));
    }

    // ═══════════════════════════════════════════════════════════
    //  Authenticated ownership
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function an_authenticated_customer_owns_the_order_they_create(): void
    {
        $identity = $this->identity($this->tenant, 'owner-unlinked@nibras-com6b.test');

        $order = $this->createOrder($identity);

        $this->assertSame($identity->id, $order->customer_identity_id);
        $this->assertNull($order->partner_id);
    }

    /** @test */
    public function an_authenticated_linked_customer_owns_the_order_and_partner_is_still_server_derived(): void
    {
        $identity = $this->identity($this->tenant, 'owner-linked@nibras-com6b.test');
        $partner = $this->partner($this->tenant, 'عميل مرتبط بملكية');
        $this->link($identity, $partner);

        $order = $this->createOrder($identity);

        $this->assertSame($identity->id, $order->customer_identity_id);
        $this->assertSame($partner->id, $order->partner_id);
    }

    /** @test */
    public function a_guest_order_has_no_customer_identity_owner(): void
    {
        $order = $this->orders->create(['sales_channel_id' => $this->channel->id], $this->items());

        $this->assertNull($order->customer_identity_id);
    }

    /**
     * `trustedPartnerSelection` only ever governs `partner_id` (COM-6A) —
     * it has no equivalent channel for `customer_identity_id`. A trusted
     * staff/internal caller can select an existing Partner but can never
     * assign a Commerce order to a customer identity that did not
     * authenticate the request itself.
     */
    /** @test */
    public function an_explicitly_trusted_staff_call_cannot_assign_customer_identity_ownership(): void
    {
        $foreignIdentity = $this->identity($this->tenant, 'foreign-owner@nibras-com6b.test');
        $partner = $this->partner($this->tenant, 'عميل طاقم موثوق بالملكية');

        $order = $this->orders->create(
            [
                'sales_channel_id' => $this->channel->id,
                'partner_id' => $partner->id,
                'customer_identity_id' => $foreignIdentity->id,
            ],
            $this->items(),
            trustedPartnerSelection: true,
        );

        $this->assertNull($order->customer_identity_id);
        $this->assertSame($partner->id, $order->partner_id);
    }

    /** @test */
    public function a_spoofed_customer_identity_id_cannot_override_the_authenticated_owner(): void
    {
        $identity = $this->identity($this->tenant, 'real-owner@nibras-com6b.test');
        $foreignIdentity = $this->identity($this->tenant, 'spoofed-owner@nibras-com6b.test');

        $order = $this->createOrder($identity, ['customer_identity_id' => $foreignIdentity->id]);

        $this->assertSame($identity->id, $order->customer_identity_id);
        $this->assertNotSame($foreignIdentity->id, $order->customer_identity_id);
    }

    // ═══════════════════════════════════════════════════════════
    //  IDOR
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function an_authenticated_customer_can_retrieve_their_own_order(): void
    {
        $identity = $this->identity($this->tenant, 'self-lookup@nibras-com6b.test');
        $order = $this->createOrder($identity);

        $found = $this->withEstablishedContext($identity, fn () => $this->orders->findOwnedOrder($order->id));

        $this->assertNotNull($found);
        $this->assertSame($order->id, $found->id);
    }

    /** @test */
    public function identity_a_cannot_retrieve_identity_bs_order(): void
    {
        $identityA = $this->identity($this->tenant, 'idor-a@nibras-com6b.test');
        $identityB = $this->identity($this->tenant, 'idor-b@nibras-com6b.test');
        $orderB = $this->createOrder($identityB);

        $found = $this->withEstablishedContext($identityA, fn () => $this->orders->findOwnedOrder($orderB->id));

        $this->assertNull($found, 'IDOR: a foreign order id must resolve exactly like a nonexistent one.');
    }

    /** @test */
    public function a_nonexistent_order_id_and_a_foreign_order_id_are_indistinguishable(): void
    {
        $identity = $this->identity($this->tenant, 'non-enumerating@nibras-com6b.test');
        $other = $this->identity($this->tenant, 'non-enumerating-other@nibras-com6b.test');
        $foreignOrder = $this->createOrder($other);

        $foreignResult = $this->withEstablishedContext($identity, fn () => $this->orders->findOwnedOrder($foreignOrder->id));
        $missingResult = $this->withEstablishedContext($identity, fn () => $this->orders->findOwnedOrder((string) Str::uuid()));

        $this->assertNull($foreignResult);
        $this->assertNull($missingResult);
    }

    /** @test */
    public function a_guest_order_is_not_retrievable_by_any_authenticated_customer(): void
    {
        $guestOrder = $this->orders->create(['sales_channel_id' => $this->channel->id], $this->items());
        $identity = $this->identity($this->tenant, 'cannot-claim-guest@nibras-com6b.test');

        $found = $this->withEstablishedContext($identity, fn () => $this->orders->findOwnedOrder($guestOrder->id));

        $this->assertNull($found, 'A guest-created order has no owner and must not be claimable by any identity.');
    }

    /** @test */
    public function owned_orders_fails_closed_without_an_established_context(): void
    {
        $this->assertFalse(app(CustomerContext::class)->isEstablished());

        $this->expectException(RuntimeException::class);
        $this->orders->ownedOrders();
    }

    // ═══════════════════════════════════════════════════════════
    //  Tenant isolation
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function owned_orders_fails_closed_when_context_tenant_mismatches_the_active_tenant(): void
    {
        $foreignTenant = Tenant::create([
            'name' => 'مستأجر ملكية آخر', 'slug' => 'nibras-com6b-foreign',
            'vat_number' => '300000000000006', 'currency' => 'SAR', 'is_active' => true,
        ]);
        $foreignIdentity = $this->identity($foreignTenant, 'foreign-tenant@nibras-com6b-foreign.test');

        // Directly establishes a context for a tenant other than the active
        // one — EstablishCustomerContext itself never produces this state;
        // this is the same defense-in-depth fail-closed guard proven for
        // order creation in COM-6A, applied to the read side.
        app(CustomerContext::class)->set($foreignTenant->id, $foreignIdentity->id, null);

        $this->expectException(RuntimeException::class);
        $this->orders->ownedOrders();
    }

    /** @test */
    public function a_customer_only_ever_owns_orders_in_their_own_tenant(): void
    {
        $tenantB = Tenant::create([
            'name' => 'مستأجر ب ملكية', 'slug' => 'nibras-com6b-tenant-b',
            'vat_number' => '300000000000007', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenantB->id);
        $productB = Product::create(['name' => 'منتج ب', 'sale_price' => 5000]);
        $channelB = SalesChannel::create(['slug' => 'mobile', 'name' => 'قناة ب', 'type' => SalesChannel::TYPE_MOBILE]);
        $identityB = $this->identity($tenantB, 'tenant-b@nibras-com6b-tenant-b.test');
        $orderB = $this->withEstablishedContext($identityB, fn () => $this->orders->create(
            ['sales_channel_id' => $channelB->id],
            [['product_id' => $productB->id, 'quantity' => 1]],
        ));
        $this->assertSame($identityB->id, $orderB->customer_identity_id);

        app(TenantContext::class)->set($this->tenant->id);
        $identityA = $this->identity($this->tenant, 'tenant-a@nibras-com6b.test');
        $orderA = $this->createOrder($identityA);

        $foundByA = $this->withEstablishedContext($identityA, fn () => $this->orders->findOwnedOrder($orderA->id));
        $this->assertNotNull($foundByA);

        // Same identity A, but the active tenant is now B. This is a
        // stronger guarantee than findOwnedOrder returning null: identity
        // A's tenant does not match the active tenant at all, so
        // EstablishCustomerContext itself refuses to establish a context
        // for this request — the read-side ownership query is never even
        // reached, exactly as it never would be on a real
        // /api/customer/v1/{tenantSlug}/... route where the slug resolves
        // to tenant B while the caller's token belongs to tenant A.
        app(TenantContext::class)->set($tenantB->id);
        $this->expectException(\Symfony\Component\HttpKernel\Exception\HttpException::class);
        $this->withEstablishedContext($identityA, fn () => $this->orders->findOwnedOrder($orderB->id));
    }

    /** @test */
    public function the_composite_foreign_key_rejects_a_cross_tenant_customer_identity(): void
    {
        $otherTenant = Tenant::create([
            'name' => 'مستأجر أجنبي للهوية', 'slug' => 'nibras-com6b-fk',
            'vat_number' => '300000000000008', 'currency' => 'SAR', 'is_active' => true,
        ]);
        $foreignIdentity = $this->identity($otherTenant, 'fk-foreign@nibras-com6b-fk.test');

        $this->expectException(QueryException::class);

        // Bypasses the service layer entirely to prove the database itself
        // — not only CommerceOrderService::resolveOwnership() — refuses to
        // let a commerce_orders row claim a customer_identity_id belonging
        // to a different tenant, mirroring customer_partner_links' own
        // composite FK proof (CustomerFoundationDatabaseInvariantTest).
        DB::table('commerce_orders')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $this->tenant->id,
            'sales_channel_id' => $this->channel->id,
            'customer_identity_id' => $foreignIdentity->id,
            'number' => 'FK-TEST-1',
            'status' => 'draft',
            'total' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);
    }

    // ═══════════════════════════════════════════════════════════
    //  Principal separation
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_staff_user_principal_can_never_own_or_retrieve_a_commerce_order(): void
    {
        $staff = $this->staffActor($this->tenant);
        $request = Request::create('/');
        $request->setUserResolver(fn () => $staff);

        try {
            app(EstablishCustomerContext::class)->handle($request, fn () => 'unreachable');
        } catch (\Throwable) {
            // expected — EstablishCustomerContext rejects non-CustomerIdentity principals.
        }

        $this->assertFalse(app(CustomerContext::class)->isEstablished());

        $order = $this->orders->create(['sales_channel_id' => $this->channel->id], $this->items());
        $this->assertNull($order->customer_identity_id);

        $this->expectException(RuntimeException::class);
        $this->orders->ownedOrders();
    }

    // ═══════════════════════════════════════════════════════════
    //  Context lifecycle
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function sequential_requests_do_not_leak_ownership_between_customers(): void
    {
        $identityA = $this->identity($this->tenant, 'seq-owner-a@nibras-com6b.test');
        $orderA = $this->createOrder($identityA);

        $this->assertFalse(app(CustomerContext::class)->isEstablished());

        $identityB = $this->identity($this->tenant, 'seq-owner-b@nibras-com6b.test');
        $orderB = $this->createOrder($identityB);

        $this->assertNotSame($orderA->id, $orderB->id);

        $bSeesOwnOrder = $this->withEstablishedContext($identityB, fn () => $this->orders->findOwnedOrder($orderB->id));
        $bSeesAsOrder = $this->withEstablishedContext($identityB, fn () => $this->orders->findOwnedOrder($orderA->id));
        $aSeesOwnOrder = $this->withEstablishedContext($identityA, fn () => $this->orders->findOwnedOrder($orderA->id));
        $aSeesBsOrder = $this->withEstablishedContext($identityA, fn () => $this->orders->findOwnedOrder($orderB->id));

        $this->assertNotNull($bSeesOwnOrder);
        $this->assertNull($bSeesAsOrder);
        $this->assertNotNull($aSeesOwnOrder);
        $this->assertNull($aSeesBsOrder);
    }

    // ═══════════════════════════════════════════════════════════
    //  COM-5A/5B/6A regression sentinel
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function ownership_persistence_creates_no_accounting_or_inventory_side_effect(): void
    {
        $identity = $this->identity($this->tenant, 'ownership-regression@nibras-com6b.test');
        $order = $this->createOrder($identity);
        $confirmed = $this->orders->confirm($order);

        $this->assertTrue($confirmed->isConfirmed());
        $this->assertSame(0, \App\Models\JournalEntry::query()->count());
        $this->assertSame(0, \App\Models\InventoryReservation::query()->count());
        $this->assertSame(0, \App\Models\Invoice::query()->count());
        $this->assertSame(0, \App\Models\Payment::query()->count());
        $this->assertSame(0, \App\Models\StockMovement::query()->count());
    }
}
