<?php

namespace Tests\Feature;

use App\Http\Middleware\EstablishCustomerContext;
use App\Models\CommerceOrder;
use App\Models\CustomerIdentity;
use App\Models\CustomerPartnerLink;
use App\Models\Partner;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Commerce\CommerceOrderService;
use App\Services\CustomerPartnerLinkService;
use App\Tenancy\CustomerContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use RuntimeException;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PR-COM-6A — Commerce ↔ Shared Customer Platform Context Integration
 * ═══════════════════════════════════════════════════════════════
 *
 * `CommerceOrderService::create()` is Commerce's only current caller-facing
 * write path (no Commerce HTTP route exists yet). These tests drive the
 * *real* `EstablishCustomerContext` middleware — the same class the
 * merged Customer Platform route group runs — rather than re-implementing
 * its checks, so the integration is proven against production code, not a
 * test double.
 *
 * Run: php artisan test --filter=CommerceCustomerContextIntegrationTest
 */
class CommerceCustomerContextIntegrationTest extends TestCase
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
            'name' => 'نبراس الطموح', 'slug' => 'nibras-com6a',
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

    private function identity(string $email, bool $verified = true): CustomerIdentity
    {
        return CustomerIdentity::create([
            'tenant_id' => $this->tenant->id,
            'display_name' => 'Customer',
            'email' => $email,
            'password' => 'password123',
            'email_verified_at' => $verified ? now() : null,
            'is_active' => true,
        ]);
    }

    private function partner(string $name = 'عميل مرتبط'): Partner
    {
        return Partner::create([
            'tenant_id' => $this->tenant->id,
            'name' => $name,
            'type' => 'customer',
            'is_active' => true,
        ]);
    }

    private function staffActor(): User
    {
        return User::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'Owner',
            'email' => 'owner-com6a@nibras-com6a.test',
            'password' => 'password123',
            'role' => 'owner',
            'is_active' => true,
        ]);
    }

    private function link(CustomerIdentity $identity, Partner $partner): CustomerPartnerLink
    {
        return app(CustomerPartnerLinkService::class)->link($identity, $partner, $this->staffActor());
    }

    /**
     * Drives the real `EstablishCustomerContext` middleware for the given
     * principal, running `$callback` while `CustomerContext` is established
     * exactly as it would be on a live `/api/customer/v1/{tenantSlug}/...`
     * request, then lets the middleware's own `finally` clear it — proving
     * COM-6A consumes production context plumbing, not a re-implementation.
     *
     * `handle()` is typed to return a `Symfony\...\Response`, so `$next`
     * must return one too; the real result is captured by reference and
     * returned separately.
     */
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

    // ═══════════════════════════════════════════════════════════
    //  A. Guest
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function guest_order_creation_invents_no_customer_identity_partner_or_link(): void
    {
        $this->assertFalse(app(CustomerContext::class)->isEstablished());

        $order = $this->orders->create(['sales_channel_id' => $this->channel->id], $this->items());

        $this->assertNull($order->partner_id);
        $this->assertSame(0, CustomerIdentity::query()->count());
        $this->assertSame(0, Partner::query()->count());
        $this->assertSame(0, CustomerPartnerLink::query()->count());
    }

    /** @test */
    public function guest_order_creation_still_accepts_an_explicit_partner_id_unchanged_from_com5a(): void
    {
        $partner = $this->partner('عميل ضيف يدوي');

        $order = $this->orders->create([
            'sales_channel_id' => $this->channel->id, 'partner_id' => $partner->id,
        ], $this->items());

        $this->assertSame($partner->id, $order->partner_id);
    }

    // ═══════════════════════════════════════════════════════════
    //  B. Authenticated, unlinked
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function authenticated_unlinked_customer_resolves_the_correct_identity_and_a_null_partner(): void
    {
        $identity = $this->identity('unlinked@nibras-com6a.test');

        $order = $this->withEstablishedContext($identity, function () use ($identity) {
            $this->assertTrue(app(CustomerContext::class)->isEstablished());
            $this->assertSame($identity->id, app(CustomerContext::class)->customerIdentityId());
            $this->assertFalse(app(CustomerContext::class)->hasPartnerLink());

            return $this->orders->create(['sales_channel_id' => $this->channel->id], $this->items());
        });

        $this->assertNull($order->partner_id);
        $this->assertSame(0, Partner::query()->count());
        $this->assertSame(0, CustomerPartnerLink::query()->count());
    }

    // ═══════════════════════════════════════════════════════════
    //  C. Authenticated, linked
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function authenticated_linked_customer_resolves_partner_only_from_context(): void
    {
        $identity = $this->identity('linked@nibras-com6a.test');
        $partner = $this->partner('عميل مرتبط فعلاً');
        $this->link($identity, $partner);

        $order = $this->withEstablishedContext($identity, fn () => $this->orders->create(
            ['sales_channel_id' => $this->channel->id],
            $this->items(),
        ));

        $this->assertSame($partner->id, $order->partner_id);
    }

    /** @test */
    public function commerce_never_mutates_the_partner_link_as_a_side_effect_of_ordering(): void
    {
        $identity = $this->identity('readonly@nibras-com6a.test');
        $partner = $this->partner('عميل قراءة فقط');
        $link = $this->link($identity, $partner);

        $this->withEstablishedContext($identity, fn () => $this->orders->create(
            ['sales_channel_id' => $this->channel->id],
            $this->items(),
        ));

        $this->assertSame(1, CustomerPartnerLink::query()->count());
        $link->refresh();
        $this->assertSame('active', $link->status);
        $this->assertSame($partner->id, $link->partner_id);
    }

    // ═══════════════════════════════════════════════════════════
    //  Request spoofing
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_spoofed_partner_id_cannot_override_an_established_unlinked_context(): void
    {
        $identity = $this->identity('spoof-unlinked@nibras-com6a.test');
        $foreignPartner = $this->partner('عميل غريب مُنتحَل');

        $order = $this->withEstablishedContext($identity, fn () => $this->orders->create(
            ['sales_channel_id' => $this->channel->id, 'partner_id' => $foreignPartner->id],
            $this->items(),
        ));

        $this->assertNull($order->partner_id);
    }

    /** @test */
    public function a_spoofed_foreign_partner_id_cannot_override_an_established_linked_context(): void
    {
        $identity = $this->identity('spoof-linked@nibras-com6a.test');
        $ownPartner = $this->partner('عميل مرتبط أصلي');
        $this->link($identity, $ownPartner);
        $foreignPartner = $this->partner('عميل غريب آخر');

        $order = $this->withEstablishedContext($identity, fn () => $this->orders->create(
            ['sales_channel_id' => $this->channel->id, 'partner_id' => $foreignPartner->id],
            $this->items(),
        ));

        $this->assertSame($ownPartner->id, $order->partner_id);
        $this->assertNotSame($foreignPartner->id, $order->partner_id);
    }

    /** @test */
    public function a_spoofed_customer_identity_id_in_the_payload_has_no_effect(): void
    {
        $identity = $this->identity('spoof-identity@nibras-com6a.test');
        $foreignIdentity = $this->identity('other-identity@nibras-com6a.test');

        $order = $this->withEstablishedContext($identity, fn () => $this->orders->create(
            ['sales_channel_id' => $this->channel->id, 'customer_identity_id' => $foreignIdentity->id],
            $this->items(),
        ));

        // The order carries no identity column yet (COM-6B); the assertion
        // that matters here is that creation succeeds unaffected and the
        // spoofed key is silently ignored, not consulted anywhere.
        $this->assertNull($order->partner_id);
    }

    /** @test */
    public function a_spoofed_tenant_id_in_the_payload_has_no_effect_on_the_active_tenant(): void
    {
        $other = Tenant::create([
            'name' => 'مستأجر آخر', 'slug' => 'nibras-com6a-other',
            'vat_number' => '300000000000004', 'currency' => 'SAR', 'is_active' => true,
        ]);

        $order = $this->orders->create(
            ['sales_channel_id' => $this->channel->id, 'tenant_id' => $other->id],
            $this->items(),
        );

        $this->assertSame($this->tenant->id, $order->tenant_id);
    }

    // ═══════════════════════════════════════════════════════════
    //  Tenant safety
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_customer_context_belonging_to_a_foreign_tenant_fails_closed(): void
    {
        $foreignTenant = Tenant::create([
            'name' => 'مستأجر ثالث', 'slug' => 'nibras-com6a-foreign',
            'vat_number' => '300000000000005', 'currency' => 'SAR', 'is_active' => true,
        ]);
        $foreignIdentity = CustomerIdentity::create([
            'tenant_id' => $foreignTenant->id,
            'display_name' => 'Foreign',
            'email' => 'foreign@nibras-com6a-foreign.test',
            'password' => 'password123',
            'email_verified_at' => now(),
            'is_active' => true,
        ]);

        // Directly establishes a context whose tenant does not match the
        // active TenantContext — a state EstablishCustomerContext itself
        // would never produce (it always derives from the active
        // TenantContext), but exactly the fail-closed defense-in-depth
        // guard COM-6A adds for a context established elsewhere/earlier.
        app(CustomerContext::class)->set($foreignTenant->id, $foreignIdentity->id, null);

        $this->expectException(RuntimeException::class);
        $this->orders->create(['sales_channel_id' => $this->channel->id], $this->items());
    }

    // ═══════════════════════════════════════════════════════════
    //  Principal separation
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function an_erp_staff_user_principal_is_rejected_by_establish_customer_context(): void
    {
        $staff = $this->staffActor();

        $request = Request::create('/');
        $request->setUserResolver(fn () => $staff);

        $this->expectException(\Symfony\Component\HttpKernel\Exception\HttpException::class);
        app(EstablishCustomerContext::class)->handle($request, fn () => 'unreachable');
    }

    /** @test */
    public function a_staff_principal_can_never_produce_an_established_customer_context_for_commerce(): void
    {
        $staff = $this->staffActor();
        $request = Request::create('/');
        $request->setUserResolver(fn () => $staff);

        try {
            app(EstablishCustomerContext::class)->handle($request, fn () => 'unreachable');
        } catch (\Throwable) {
            // expected — see previous test for the direct assertion
        }

        // Whatever happened inside the middleware, no established context
        // survives it, so Commerce falls back to guest/staff behavior.
        $this->assertFalse(app(CustomerContext::class)->isEstablished());

        $order = $this->orders->create(['sales_channel_id' => $this->channel->id], $this->items());
        $this->assertNull($order->partner_id);
    }

    // ═══════════════════════════════════════════════════════════
    //  Sequential requests — no context leakage
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function customer_context_does_not_leak_between_sequential_order_creations(): void
    {
        $identityA = $this->identity('sequential-a@nibras-com6a.test');
        $partnerA = $this->partner('عميل تسلسلي أ');
        $this->link($identityA, $partnerA);

        $orderA = $this->withEstablishedContext($identityA, fn () => $this->orders->create(
            ['sales_channel_id' => $this->channel->id],
            $this->items(),
        ));
        $this->assertSame($partnerA->id, $orderA->partner_id);

        // Context is cleared by EstablishCustomerContext's own finally block.
        $this->assertFalse(app(CustomerContext::class)->isEstablished());

        // A subsequent guest call must not inherit identity A's link.
        $guestOrder = $this->orders->create(['sales_channel_id' => $this->channel->id], $this->items());
        $this->assertNull($guestOrder->partner_id);

        $identityB = $this->identity('sequential-b@nibras-com6a.test');
        $orderB = $this->withEstablishedContext($identityB, fn () => $this->orders->create(
            ['sales_channel_id' => $this->channel->id],
            $this->items(),
        ));
        $this->assertNull($orderB->partner_id);
    }

    // ═══════════════════════════════════════════════════════════
    //  COM-5A/5B regression sentinel
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function order_creation_and_confirmation_remain_free_of_accounting_and_inventory_side_effects(): void
    {
        $identity = $this->identity('regression@nibras-com6a.test');
        $partner = $this->partner('عميل انحدار');
        $this->link($identity, $partner);

        $order = $this->withEstablishedContext($identity, fn () => $this->orders->create(
            ['sales_channel_id' => $this->channel->id],
            $this->items(),
        ));

        $confirmed = $this->orders->confirm($order);

        $this->assertTrue($confirmed->isConfirmed());
        $this->assertSame(0, \App\Models\JournalEntry::query()->count());
        $this->assertSame(0, \App\Models\InventoryReservation::query()->count());
        $this->assertSame(0, \App\Models\Invoice::query()->count());
        $this->assertSame(0, \App\Models\Payment::query()->count());
        $this->assertSame(0, \App\Models\StockMovement::query()->count());
    }
}
