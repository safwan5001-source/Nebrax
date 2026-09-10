<?php

namespace Tests\Feature;

use App\Http\Middleware\EstablishCustomerContext;
use App\Models\CommerceOrder;
use App\Models\CommerceOrderSnapshot;
use App\Models\CustomerIdentity;
use App\Models\Partner;
use App\Models\Product;
use App\Models\SalesChannel;
use App\Models\Tenant;
use App\Models\User;
use App\Services\Commerce\CommerceOrderService;
use App\Services\CustomerPartnerLinkService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\Request;
use LogicException;
use RuntimeException;
use Tests\TestCase;

/**
 * ═══════════════════════════════════════════════════════════════
 *  PR-COM-6C — Immutable Commerce Order Customer/Contact/Address Snapshots
 * ═══════════════════════════════════════════════════════════════
 *
 * Covers the exact three things this PR adds on top of COM-6A/6B:
 * (1) an optional, purely descriptive `CommerceOrderSnapshot` row captured
 * through `CommerceOrderService::create()`'s new `customer_snapshot`/
 * `shipping_snapshot`/`billing_snapshot` keys; (2) `updateSnapshot()` as the
 * only mutation channel, allowed only while the order is `draft`; (3) the
 * central immutability guard (`CommerceOrderSnapshot::booted()`) that
 * rejects any update once the order is `confirmed`, independent of the
 * service layer. Drives the real `EstablishCustomerContext` middleware,
 * exactly like `CommerceOrderOwnershipTest` (COM-6B) and
 * `CommerceCustomerContextIntegrationTest` (COM-6A) — never a
 * re-implementation.
 *
 * Run: php artisan test --filter=CommerceOrderSnapshotTest
 */
class CommerceOrderSnapshotTest extends TestCase
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
            'name' => 'نبراس الطموح', 'slug' => 'nibras-com6c',
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

    private function identity(Tenant $tenant, string $email): CustomerIdentity
    {
        return CustomerIdentity::create([
            'tenant_id' => $tenant->id,
            'display_name' => 'Customer',
            'email' => $email,
            'password' => 'password123',
            'email_verified_at' => now(),
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
            'email' => 'owner-com6c-' . $tenant->slug . '@nibras-com6c.test',
            'password' => 'password123',
            'role' => 'owner',
            'is_active' => true,
        ]);
    }

    private function link(CustomerIdentity $identity, Partner $partner): void
    {
        app(CustomerPartnerLinkService::class)->link($identity, $partner, $this->staffActor($identity->tenant));
    }

    /** Mirrors CommerceOrderOwnershipTest's helper — drives the real middleware. */
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

    private function customerSnapshot(array $overrides = []): array
    {
        return array_merge([
            'customer_name' => 'أحمد المطيري',
            'email' => 'ahmed@example.com',
            'phone' => '0550000000',
        ], $overrides);
    }

    private function shippingSnapshot(array $overrides = []): array
    {
        return array_merge([
            'recipient_name' => 'أحمد المطيري',
            'phone' => '0550000000',
            'country' => 'SA',
            'city' => 'الدمام',
            'district' => 'الفيصلية',
            'street' => 'شارع الملك فهد',
            'building_no' => '1234',
            'postal_code' => '31411',
            'notes' => 'اترك الطرد عند الاستقبال',
        ], $overrides);
    }

    private function billingSnapshot(array $overrides = []): array
    {
        return array_merge([
            'recipient_name' => 'شركة الطموح',
            'country' => 'SA',
            'city' => 'الخبر',
            'street' => 'شارع آخر',
        ], $overrides);
    }

    // ═══════════════════════════════════════════════════════════
    //  Capture
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function guest_order_creation_can_capture_a_customer_and_shipping_snapshot(): void
    {
        $order = $this->orders->create([
            'sales_channel_id' => $this->channel->id,
            'customer_snapshot' => $this->customerSnapshot(),
            'shipping_snapshot' => $this->shippingSnapshot(),
        ], $this->items());

        $snapshot = $order->snapshot;
        $this->assertNotNull($snapshot);
        $this->assertSame('أحمد المطيري', $snapshot->customer_name);
        $this->assertSame('الدمام', $snapshot->shipping_city);
        $this->assertNull($snapshot->billing_city);
        $this->assertNull($order->customer_identity_id);
        $this->assertNull($order->partner_id);
    }

    /** @test */
    public function authenticated_unlinked_customer_can_capture_a_snapshot(): void
    {
        $identity = $this->identity($this->tenant, 'unlinked-snap@nibras-com6c.test');

        $order = $this->withEstablishedContext($identity, fn () => $this->orders->create([
            'sales_channel_id' => $this->channel->id,
            'customer_snapshot' => $this->customerSnapshot(),
        ], $this->items()));

        $this->assertSame($identity->id, $order->customer_identity_id);
        $this->assertNull($order->partner_id);
        $this->assertNotNull($order->snapshot);
    }

    /** @test */
    public function authenticated_linked_customer_can_capture_a_snapshot(): void
    {
        $identity = $this->identity($this->tenant, 'linked-snap@nibras-com6c.test');
        $partner = $this->partner($this->tenant, 'عميل مرتبط بلقطة');
        $this->link($identity, $partner);

        $order = $this->withEstablishedContext($identity, fn () => $this->orders->create([
            'sales_channel_id' => $this->channel->id,
            'customer_snapshot' => $this->customerSnapshot(),
            'billing_snapshot' => $this->billingSnapshot(),
        ], $this->items()));

        $this->assertSame($identity->id, $order->customer_identity_id);
        $this->assertSame($partner->id, $order->partner_id);
        $this->assertSame('الخبر', $order->snapshot->billing_city);
    }

    // ═══════════════════════════════════════════════════════════
    //  Separation — snapshot input is never ownership authority
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function extraneous_ownership_shaped_keys_inside_a_snapshot_block_are_never_copied(): void
    {
        $order = $this->orders->create([
            'sales_channel_id' => $this->channel->id,
            'customer_snapshot' => [
                'customer_name' => 'زائر',
                'partner_id' => 'not-a-real-uuid-should-be-ignored',
                'customer_identity_id' => 'also-ignored',
                'tenant_id' => 'ignored-too',
            ],
        ], $this->items());

        $this->assertNull($order->customer_identity_id);
        $this->assertNull($order->partner_id);
        $this->assertSame($this->tenant->id, $order->tenant_id);

        $snapshot = $order->snapshot;
        $this->assertSame('زائر', $snapshot->customer_name);
        $this->assertArrayNotHasKey('partner_id', $snapshot->getAttributes());
        $this->assertArrayNotHasKey('customer_identity_id', $snapshot->getAttributes());
    }

    /** @test */
    public function a_contextless_untrusted_caller_supplying_a_full_snapshot_still_resolves_no_ownership(): void
    {
        $partner = $this->partner($this->tenant, 'شريك حقيقي');

        $order = $this->orders->create([
            'sales_channel_id' => $this->channel->id,
            'partner_id' => $partner->id,
            'customer_snapshot' => $this->customerSnapshot(),
            'shipping_snapshot' => $this->shippingSnapshot(),
            'billing_snapshot' => $this->billingSnapshot(),
        ], $this->items());

        $this->assertNull($order->customer_identity_id);
        $this->assertNull($order->partner_id);
        $this->assertNotNull($order->snapshot, 'Snapshot data is still descriptive evidence, captured regardless of ownership.');
    }

    /** @test */
    public function an_established_customer_context_remains_authoritative_over_ownership_even_with_a_full_snapshot(): void
    {
        $identity = $this->identity($this->tenant, 'context-wins@nibras-com6c.test');
        $foreignPartner = $this->partner($this->tenant, 'شريك أجنبي');

        $order = $this->withEstablishedContext($identity, fn () => $this->orders->create(
            [
                'sales_channel_id' => $this->channel->id,
                'partner_id' => $foreignPartner->id,
                'customer_snapshot' => $this->customerSnapshot(),
            ],
            $this->items(),
            trustedPartnerSelection: true,
        ));

        $this->assertSame($identity->id, $order->customer_identity_id);
        $this->assertNull($order->partner_id, 'Unlinked identity — CustomerContext wins regardless of the trust flag or snapshot payload.');
    }

    /** @test */
    public function snapshot_contact_details_can_never_be_used_to_claim_a_foreign_order(): void
    {
        $identityA = $this->identity($this->tenant, 'claim-a@nibras-com6c.test');
        $identityB = $this->identity($this->tenant, 'claim-b@nibras-com6c.test');

        // Identity B's snapshot happens to carry identity A's own email —
        // must never grant A access to B's order.
        $orderB = $this->withEstablishedContext($identityB, fn () => $this->orders->create([
            'sales_channel_id' => $this->channel->id,
            'customer_snapshot' => $this->customerSnapshot(['email' => 'claim-a@nibras-com6c.test']),
        ], $this->items()));

        $found = $this->withEstablishedContext($identityA, fn () => $this->orders->findOwnedOrder($orderB->id));

        $this->assertNull($found, 'Snapshot email is descriptive data, never ownership authority.');
    }

    // ═══════════════════════════════════════════════════════════
    //  Historical integrity
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_later_partner_edit_does_not_mutate_the_captured_snapshot(): void
    {
        $identity = $this->identity($this->tenant, 'partner-edit@nibras-com6c.test');
        $partner = $this->partner($this->tenant, 'اسم قديم');
        $this->link($identity, $partner);

        $order = $this->withEstablishedContext($identity, fn () => $this->orders->create([
            'sales_channel_id' => $this->channel->id,
            'customer_snapshot' => $this->customerSnapshot(['customer_name' => 'اسم وقت الطلب']),
        ], $this->items()));

        $partner->update(['name' => 'اسم جديد بعد الطلب', 'city' => 'مدينة جديدة تماماً']);

        $order->refresh();
        $this->assertSame('اسم وقت الطلب', $order->snapshot->customer_name);
    }

    /** @test */
    public function a_later_customer_identity_edit_does_not_mutate_the_captured_snapshot(): void
    {
        $identity = $this->identity($this->tenant, 'identity-edit@nibras-com6c.test');

        $order = $this->withEstablishedContext($identity, fn () => $this->orders->create([
            'sales_channel_id' => $this->channel->id,
            'customer_snapshot' => $this->customerSnapshot(['email' => 'snapshot-time@example.com']),
        ], $this->items()));

        $identity->update(['display_name' => 'اسم جديد', 'email' => 'changed-later@example.com']);

        $order->refresh();
        $this->assertSame('snapshot-time@example.com', $order->snapshot->email);
    }

    /** @test */
    public function an_order_without_requested_snapshot_data_never_falls_back_to_live_partner_data(): void
    {
        $partner = $this->partner($this->tenant, 'طرف بعنوان كامل');
        $partner->update(['city' => 'جدة', 'email' => 'partner@example.com']);

        $order = $this->orders->create(
            ['sales_channel_id' => $this->channel->id, 'partner_id' => $partner->id],
            $this->items(),
            trustedPartnerSelection: true,
        );

        $this->assertSame($partner->id, $order->partner_id);
        $this->assertNull($order->snapshot, 'No snapshot was requested — none may be fabricated from the live Partner.');
    }

    // ═══════════════════════════════════════════════════════════
    //  Immutability
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function a_draft_orders_snapshot_can_be_updated(): void
    {
        $order = $this->orders->create([
            'sales_channel_id' => $this->channel->id,
            'customer_snapshot' => $this->customerSnapshot(['customer_name' => 'اسم أول']),
        ], $this->items());

        $updated = $this->orders->updateSnapshot($order, [
            'customer_snapshot' => ['customer_name' => 'اسم مُحدَّث'],
            'shipping_snapshot' => $this->shippingSnapshot(),
        ]);

        $this->assertSame('اسم مُحدَّث', $updated->snapshot->customer_name);
        $this->assertSame('SA', $updated->snapshot->shipping_country);
    }

    /** @test */
    public function a_snapshot_can_be_attached_for_the_first_time_while_still_draft(): void
    {
        $order = $this->orders->create(['sales_channel_id' => $this->channel->id], $this->items());
        $this->assertNull($order->snapshot);

        $updated = $this->orders->updateSnapshot($order, ['customer_snapshot' => $this->customerSnapshot()]);

        $this->assertNotNull($updated->snapshot);
    }

    /** @test */
    public function attaching_a_first_time_snapshot_still_requires_a_customer_name(): void
    {
        $order = $this->orders->create(['sales_channel_id' => $this->channel->id], $this->items());

        $this->expectException(RuntimeException::class);
        $this->orders->updateSnapshot($order, ['shipping_snapshot' => $this->shippingSnapshot()]);
    }

    /** @test */
    public function updating_a_snapshot_is_rejected_once_the_order_is_confirmed_service_level(): void
    {
        $order = $this->orders->create([
            'sales_channel_id' => $this->channel->id,
            'customer_snapshot' => $this->customerSnapshot(),
        ], $this->items());
        $this->orders->confirm($order);

        $this->expectException(RuntimeException::class);
        $this->orders->updateSnapshot($order, ['customer_snapshot' => ['customer_name' => 'محاولة تعديل بعد التأكيد']]);
    }

    /** @test */
    public function a_direct_model_update_on_a_confirmed_orders_snapshot_is_rejected_centrally(): void
    {
        $order = $this->orders->create([
            'sales_channel_id' => $this->channel->id,
            'customer_snapshot' => $this->customerSnapshot(),
        ], $this->items());
        $this->orders->confirm($order);

        $snapshot = $order->snapshot()->firstOrFail();

        $this->expectException(LogicException::class);
        $snapshot->update(['customer_name' => 'تجاوز طبقة الخدمة مباشرة']);
    }

    /**
     * P1 hardening — the P0 guard only covered `updating`. A confirmed
     * order's snapshot must also survive a direct model-level delete.
     */
    /** @test */
    public function a_direct_model_delete_on_a_confirmed_orders_snapshot_is_rejected_centrally(): void
    {
        $order = $this->orders->create([
            'sales_channel_id' => $this->channel->id,
            'customer_snapshot' => $this->customerSnapshot(),
        ], $this->items());
        $this->orders->confirm($order);

        $snapshot = $order->snapshot()->firstOrFail();

        $this->expectException(LogicException::class);
        $snapshot->delete();
    }

    /**
     * P1 hardening — a snapshot must never be creatable at all for an order
     * that is already confirmed, independent of the service layer (which
     * never attempts this itself, but the guard must not depend on that).
     */
    /** @test */
    public function creating_a_snapshot_for_an_already_confirmed_order_is_rejected_centrally(): void
    {
        $order = $this->orders->create(['sales_channel_id' => $this->channel->id], $this->items());
        $this->orders->confirm($order);

        $this->expectException(LogicException::class);
        $order->snapshot()->create($this->customerSnapshot());
    }

    /**
     * P1 hardening — the exact finding: `commerce_order_id` reassignment
     * must not be a bypass. A confirmed order's snapshot can never be
     * re-pointed at a different (draft) order to escape the freeze.
     */
    /** @test */
    public function reassigning_a_confirmed_snapshot_to_a_draft_order_is_rejected(): void
    {
        $confirmedOrder = $this->orders->create([
            'sales_channel_id' => $this->channel->id,
            'customer_snapshot' => $this->customerSnapshot(),
        ], $this->items());
        $this->orders->confirm($confirmedOrder);
        $snapshot = $confirmedOrder->snapshot()->firstOrFail();

        $draftOrder = $this->orders->create(['sales_channel_id' => $this->channel->id], $this->items());

        $this->expectException(LogicException::class);
        $snapshot->update(['commerce_order_id' => $draftOrder->id]);
    }

    /**
     * P1 hardening — reassignment is rejected structurally
     * (`commerce_order_id` is immutable after creation), not only when the
     * target happens to be confirmed. A draft-owned snapshot re-pointed at
     * another draft order must be rejected exactly the same way — there is
     * no state combination that makes reassignment acceptable.
     */
    /** @test */
    public function reassigning_a_draft_snapshot_to_another_draft_order_is_also_rejected(): void
    {
        $orderA = $this->orders->create([
            'sales_channel_id' => $this->channel->id,
            'customer_snapshot' => $this->customerSnapshot(),
        ], $this->items());
        $orderB = $this->orders->create(['sales_channel_id' => $this->channel->id], $this->items());
        $snapshot = $orderA->snapshot()->firstOrFail();

        $this->expectException(LogicException::class);
        $snapshot->update(['commerce_order_id' => $orderB->id]);
    }

    /**
     * P1 hardening — confirmation must freeze whatever snapshot already
     * exists at that moment across every mutation path in one pass (update,
     * delete, reassignment), not merely the specific path exercised by the
     * other individual tests above.
     */
    /** @test */
    public function confirmation_freezes_the_existing_snapshot_against_every_mutation_path(): void
    {
        $order = $this->orders->create([
            'sales_channel_id' => $this->channel->id,
            'customer_snapshot' => $this->customerSnapshot(),
        ], $this->items());
        $snapshot = $order->snapshot()->firstOrFail();

        $this->orders->confirm($order);
        $otherDraft = $this->orders->create(['sales_channel_id' => $this->channel->id], $this->items());

        $this->assertThrows(fn () => $snapshot->fresh()->update(['customer_name' => 'محاولة بعد التأكيد']), LogicException::class);
        $this->assertThrows(fn () => $snapshot->fresh()->delete(), LogicException::class);
        $this->assertThrows(fn () => $snapshot->fresh()->update(['commerce_order_id' => $otherDraft->id]), LogicException::class);
    }

    /**
     * Backward compatibility (unaffected by the P1 hardening): a historical
     * confirmed order that never had a snapshot captured remains completely
     * valid — no snapshot is fabricated, and confirming it (already
     * confirmed here) raises nothing.
     */
    /** @test */
    public function an_existing_confirmed_order_with_no_snapshot_remains_valid(): void
    {
        $order = $this->orders->create(['sales_channel_id' => $this->channel->id], $this->items());
        $confirmed = $this->orders->confirm($order);

        $this->assertTrue($confirmed->isConfirmed());
        $this->assertNull($confirmed->snapshot);
    }

    // ═══════════════════════════════════════════════════════════
    //  Shipping / billing
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function shipping_and_billing_snapshots_are_independent(): void
    {
        $order = $this->orders->create([
            'sales_channel_id' => $this->channel->id,
            'customer_snapshot' => $this->customerSnapshot(),
            'shipping_snapshot' => $this->shippingSnapshot(['city' => 'الدمام']),
            'billing_snapshot' => $this->billingSnapshot(['city' => 'الرياض']),
        ], $this->items());

        $this->assertSame('الدمام', $order->snapshot->shipping_city);
        $this->assertSame('الرياض', $order->snapshot->billing_city);
    }

    /** @test */
    public function a_missing_snapshot_is_backward_compatible_for_orders_created_without_one(): void
    {
        $order = $this->orders->create(['sales_channel_id' => $this->channel->id], $this->items());

        $order->refresh();
        $this->assertNull($order->snapshot);
    }

    /** @test */
    public function a_malformed_snapshot_block_is_rejected(): void
    {
        $this->expectException(RuntimeException::class);
        $this->orders->create([
            'sales_channel_id' => $this->channel->id,
            'customer_snapshot' => 'not-an-array',
        ], $this->items());
    }

    /** @test */
    public function a_non_scalar_snapshot_field_value_is_rejected(): void
    {
        $this->expectException(RuntimeException::class);
        $this->orders->create([
            'sales_channel_id' => $this->channel->id,
            'customer_snapshot' => ['customer_name' => ['not' => 'a string']],
        ], $this->items());
    }

    /** @test */
    public function a_missing_customer_name_is_rejected_when_any_snapshot_block_is_requested(): void
    {
        $this->expectException(RuntimeException::class);
        $this->orders->create([
            'sales_channel_id' => $this->channel->id,
            'shipping_snapshot' => $this->shippingSnapshot(),
        ], $this->items());
    }

    // ═══════════════════════════════════════════════════════════
    //  Guest
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function guest_order_snapshot_capture_invents_no_customer_identity_or_partner(): void
    {
        $beforeIdentities = CustomerIdentity::query()->count();
        $beforePartners = Partner::query()->count();

        $order = $this->orders->create([
            'sales_channel_id' => $this->channel->id,
            'customer_snapshot' => $this->customerSnapshot(),
            'shipping_snapshot' => $this->shippingSnapshot(),
        ], $this->items());

        $this->assertSame($beforeIdentities, CustomerIdentity::query()->count());
        $this->assertSame($beforePartners, Partner::query()->count());
        $this->assertNull($order->customer_identity_id);
        $this->assertNull($order->partner_id);
        $this->assertNotNull($order->snapshot);
    }

    // ═══════════════════════════════════════════════════════════
    //  COM-6B regression — ownership boundary reused as-is
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function owned_orders_and_find_owned_order_remain_unaffected_by_snapshot_presence(): void
    {
        $identity = $this->identity($this->tenant, 'ownership-with-snapshot@nibras-com6c.test');

        $order = $this->withEstablishedContext($identity, fn () => $this->orders->create([
            'sales_channel_id' => $this->channel->id,
            'customer_snapshot' => $this->customerSnapshot(),
        ], $this->items()));

        $found = $this->withEstablishedContext($identity, fn () => $this->orders->findOwnedOrder($order->id));

        $this->assertNotNull($found);
        $this->assertSame($order->id, $found->id);
    }

    // ═══════════════════════════════════════════════════════════
    //  Tenant isolation
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function commerce_order_snapshot_rows_are_tenant_scoped(): void
    {
        $order = $this->orders->create([
            'sales_channel_id' => $this->channel->id,
            'customer_snapshot' => $this->customerSnapshot(),
        ], $this->items());
        $snapshotId = $order->snapshot->id;

        $tenantB = Tenant::create([
            'name' => 'مستأجر لقطة آخر', 'slug' => 'nibras-com6c-tenant-b',
            'vat_number' => '300000000000009', 'currency' => 'SAR', 'is_active' => true,
        ]);
        app(TenantContext::class)->set($tenantB->id);

        $this->assertNull(CommerceOrderSnapshot::query()->find($snapshotId));

        app(TenantContext::class)->set($this->tenant->id);
    }

    // ═══════════════════════════════════════════════════════════
    //  Accounting/inventory safety sentinel
    // ═══════════════════════════════════════════════════════════

    /** @test */
    public function capturing_and_updating_a_snapshot_creates_no_accounting_or_inventory_side_effect(): void
    {
        $order = $this->orders->create([
            'sales_channel_id' => $this->channel->id,
            'customer_snapshot' => $this->customerSnapshot(),
        ], $this->items());
        $this->orders->updateSnapshot($order, ['shipping_snapshot' => $this->shippingSnapshot()]);
        $confirmed = $this->orders->confirm($order);

        $this->assertTrue($confirmed->isConfirmed());
        $this->assertSame(0, \App\Models\JournalEntry::query()->count());
        $this->assertSame(0, \App\Models\InventoryReservation::query()->count());
        $this->assertSame(0, \App\Models\Invoice::query()->count());
        $this->assertSame(0, \App\Models\Payment::query()->count());
        $this->assertSame(0, \App\Models\StockMovement::query()->count());
    }
}
