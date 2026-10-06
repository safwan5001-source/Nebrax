<?php

namespace Tests\Feature;

use App\Models\Account;
use App\Models\DeliveryInvoiceContext;
use App\Models\DeliveryPlatformProfileVersion as Version;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Payment;
use App\Models\StockMovement;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * DLV-POS-1 — اختيار منصة التوصيل يدوياً أثناء بيع POS.
 *
 * السعر يبقى تسعير الكاشير. التحصيل يُشتق من إعداد الفرع. بلا اختيار تبقى
 * السلوك السابق. لا صلاحية جديدة ولا Hub ولا عمولة.
 */
class PosDeliveryPlatformCheckoutTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private int $deviceSequence = 0;

    /** @test */
    public function ordinary_pos_sale_without_a_platform_is_unchanged(): void
    {
        [$auth, $sessionId, $partnerId, $cash] = $this->readyPos('plain');

        $response = $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 11500)])
            ->assertCreated();

        $invoice = Invoice::findOrFail($response['data']['id']);
        $this->assertSame($partnerId, $invoice->partner_id);
        $this->assertSame(0, DeliveryInvoiceContext::count());
        $payment = Payment::where('invoice_id', $invoice->id)->firstOrFail();
        $this->assertNull($payment->delivery_platform_profile_id);
        $this->assertSame($sessionId, $payment->pos_session_id);
        $this->assertSame(11500, $this->balance('1110'));
        $this->assertSame(0, $this->balance('1180'));
    }

    /** @test */
    public function platform_collected_sale_clears_receivable_without_cash_or_bank(): void
    {
        [$auth, $sessionId, $partnerId] = $this->readyPos('collected');
        $profile = $this->platform($auth['token'], 'jahez', Version::COLLECTION_PLATFORM);
        $stocks = StockMovement::count();

        $response = $this->checkout($auth['token'], $partnerId, $sessionId, [], [
            'delivery_platform_profile_id' => $profile['id'],
        ])->assertCreated();

        $invoice = Invoice::with('lines')->findOrFail($response['data']['id']);
        $this->assertSame($partnerId, $invoice->partner_id);
        $this->assertSame('115.00', $response['data']['total']);
        $this->assertSame('paid', $invoice->payment_status);
        $this->assertNotSame($profile['id'], $invoice->partner_id);

        $context = DeliveryInvoiceContext::where('invoice_id', $invoice->id)->firstOrFail();
        $this->assertSame($profile['id'], $context->delivery_platform_profile_id);
        $this->assertSame(Version::COLLECTION_PLATFORM, $context->collection_mode);
        $this->assertSame($invoice->branch_id, $context->branch_id);
        $this->assertNotNull($context->delivery_platform_profile_version_id);
        $this->assertSame($profile['sales_channel']['id'], $context->sales_channel_id);

        $payment = Payment::where('invoice_id', $invoice->id)->firstOrFail();
        $this->assertNull($payment->pos_session_id);
        $this->assertSame($profile['id'], $payment->delivery_platform_profile_id);
        $this->assertSame($invoice->partner_id, $payment->partner_id);

        $entry = JournalEntry::with('lines.account')->findOrFail($payment->journal_entry_id);
        $this->assertSame(11500, $this->line($entry, '1180')?->debit);
        $this->assertSame(11500, $this->line($entry, '1130')?->credit);
        $this->assertNull($this->line($entry, '1110'));
        $this->assertNull($this->line($entry, '1120'));
        $this->assertSame(0, $this->balance('1110'));
        $this->assertSame(0, $this->balance('1120'));
        $this->assertSame(11500, $this->balance('1180'));
        $this->assertSame($stocks, StockMovement::count());

        $preview = $this->withToken($auth['token'])->getJson("/api/pos-sessions/{$sessionId}/closing-preview")->assertOk();
        $this->assertSame('0.00', $preview->json('data.cash_drawer.expected_amount'));
        $this->assertSame([], $preview->json('data.payment_methods'));

        $recent = $this->withToken($auth['token'])->getJson('/api/pos/recent-invoices')->assertOk();
        $this->assertSame(['جاهز'], $recent->json('data.0.payment_methods'));
    }

    /** @test */
    public function merchant_collected_sale_keeps_canonical_tenders_and_multi_tender(): void
    {
        [$auth, $sessionId, $partnerId, $cash, $bank] = $this->readyPos('merchant', true);
        $profile = $this->platform($auth['token'], 'keeta', Version::COLLECTION_MERCHANT, [
            'external_reference_policy' => Version::REFERENCE_OPTIONAL,
        ]);

        $response = $this->checkout($auth['token'], $partnerId, $sessionId, [
            $this->tender($cash, 5000),
            $this->tender($bank, 6500),
        ], [
            'delivery_platform_profile_id' => $profile['id'],
            'external_order_reference' => 'KEETA-9',
        ])->assertCreated();

        $invoice = Invoice::findOrFail($response['data']['id']);
        $this->assertSame($partnerId, $invoice->partner_id);
        $context = DeliveryInvoiceContext::where('invoice_id', $invoice->id)->firstOrFail();
        $this->assertSame(Version::COLLECTION_MERCHANT, $context->collection_mode);
        $this->assertSame('KEETA-9', $context->external_order_reference);

        $payments = Payment::where('invoice_id', $invoice->id)->get();
        $this->assertCount(2, $payments);
        $this->assertTrue($payments->every(fn (Payment $payment) => $payment->pos_session_id === $sessionId));
        $this->assertTrue($payments->every(fn (Payment $payment) => $payment->delivery_platform_profile_id === null));
        $this->assertSame(5000, $this->balance('1110'));
        $this->assertSame(6500, $this->balance('1120'));
        $this->assertSame(0, $this->balance('1180'));
    }

    /** @test */
    public function session_report_separates_delivery_sales_from_physical_tender_expectations_without_double_counting(): void
    {
        [$auth, $sessionId, $partnerId, $cash, $bank] = $this->readyPos('close-report', true);
        $platformCollected = $this->platform($auth['token'], 'jahez', Version::COLLECTION_PLATFORM);
        $merchantCollected = $this->platform($auth['token'], 'keeta', Version::COLLECTION_MERCHANT);

        // النقد/البطاقة الاعتياديان يظلان جزءاً من عهدة الجلسة.
        $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 11500)])->assertCreated();
        $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($bank, 11500)])->assertCreated();
        // سند المقاصة البنكي للمنصة لا يحمل pos_session_id ولا يصير «بطاقة» في الإغلاق.
        $this->checkout($auth['token'], $partnerId, $sessionId, [], [
            'delivery_platform_profile_id' => $platformCollected['id'],
        ])->assertCreated();
        // تحصيل التاجر على قناة التوصيل يتبع وسائل الجلسة القائمة، مرة واحدة فقط.
        $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 11500)], [
            'delivery_platform_profile_id' => $merchantCollected['id'],
        ])->assertCreated();
        $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($bank, 11500)], [
            'delivery_platform_profile_id' => $merchantCollected['id'],
        ])->assertCreated();

        $report = $this->withToken($auth['token'])->getJson("/api/pos-sessions/{$sessionId}/report")
            ->assertOk()
            ->assertJsonPath('report.sales_count', 5)
            ->assertJsonPath('report.gross_sales', '575.00')
            ->assertJsonPath('report.net_sales', '575.00')
            ->assertJsonPath('report.cash_sales', '230.00')
            ->assertJsonPath('report.expected', '230.00')
            ->assertJsonPath('report.delivery_platforms.sales_count', 3)
            ->assertJsonPath('report.delivery_platforms.total', '345.00')
            ->assertJsonPath('report.delivery_platforms.platform_collected_total', '115.00')
            ->assertJsonPath('report.delivery_platforms.merchant_collected_total', '230.00');

        $platformRows = collect($report->json('report.delivery_platforms.platforms'))->keyBy('platform_key');
        $this->assertSame('115.00', $platformRows['jahez']['total']);
        $this->assertSame('115.00', $platformRows['jahez']['platform_collected_total']);
        $this->assertSame('0.00', $platformRows['jahez']['merchant_collected_total']);
        $this->assertSame('230.00', $platformRows['keeta']['total']);
        $this->assertSame('0.00', $platformRows['keeta']['platform_collected_total']);
        $this->assertSame('230.00', $platformRows['keeta']['merchant_collected_total']);

        $preview = $this->withToken($auth['token'])->getJson("/api/pos-sessions/{$sessionId}/closing-preview")
            ->assertOk();
        $this->assertSame('230.00', $preview->json('data.cash_drawer.expected_amount'));
        $this->assertCount(1, $preview->json('data.payment_methods'));
        $this->assertSame($bank['id'], $preview->json('data.payment_methods.0.payment_method_id'));
        $this->assertSame('230.00', $preview->json('data.payment_methods.0.expected_amount'));

        // لا تنشئ المبيعات المحصلة من المنصة فرق صندوق أو بطاقة عند الإغلاق.
        $this->withToken($auth['token'])->postJson("/api/pos-sessions/{$sessionId}/close", [
            'closing_balance' => 23000,
            'payment_counts' => [['payment_method_id' => $bank['id'], 'counted_amount' => 23000]],
        ])->assertOk()
            ->assertJsonPath('data.expected_balance', '230.00')
            ->assertJsonPath('data.difference', '0.00');
    }

    /** @test */
    public function session_report_keeps_sessions_without_delivery_context_backward_compatible_and_scoped(): void
    {
        [$auth, $sessionId, $partnerId, $cash] = $this->readyPos('report-scope');
        $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 11500)])->assertCreated();

        $this->withToken($auth['token'])->getJson("/api/pos-sessions/{$sessionId}/report")
            ->assertOk()
            ->assertJsonPath('report.net_sales', '115.00')
            ->assertJsonPath('report.delivery_platforms.sales_count', 0)
            ->assertJsonPath('report.delivery_platforms.total', '0.00')
            ->assertJsonPath('report.delivery_platforms.platforms', []);

        // جلسة المستأجر/الفرع ليست مرجعاً يمكن استكشافه من نطاق آخر.
        $foreign = $this->registerTenant('dlv-pos-report-foreign', 'owner@dlv-pos-report-foreign.test');
        $this->withToken($foreign['token'])->getJson("/api/pos-sessions/{$sessionId}/report")->assertNotFound();

        $otherBranch = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع تقرير آخر'])->assertCreated()['data']['id'];
        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $otherBranch])
            ->getJson("/api/pos-sessions/{$sessionId}/report")
            ->assertNotFound();
    }

    /** @test */
    public function the_active_branch_not_a_client_branch_id_selects_the_collection_mode(): void
    {
        $auth = $this->registerTenant('dlv-pos-branch', 'owner@dlv-pos-branch.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $main = $this->withToken($auth['token'])->getJson('/api/branches')->assertOk()['data'][0]['id'];
        $other = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع التوصيل'])->assertCreated()['data']['id'];
        $partnerId = $this->customer($auth['token']);
        $profile = $this->platform($auth['token'], 'hungerstation', Version::COLLECTION_PLATFORM, [
            'branch_overrides' => [[
                'branch_id' => $other,
                'collection_mode' => Version::COLLECTION_MERCHANT,
            ]],
        ]);

        $mainSession = $this->openSession($auth, $main);
        $this->checkout($auth['token'], $partnerId, $mainSession, [], [
            'delivery_platform_profile_id' => $profile['id'],
            'branch_id' => $other,
        ], $main)->assertCreated();

        $invoice = Invoice::query()->where('pos_session_id', $mainSession)->firstOrFail();
        $this->assertSame(Version::COLLECTION_PLATFORM, DeliveryInvoiceContext::where('invoice_id', $invoice->id)->firstOrFail()->collection_mode);
        $this->assertSame(11500, $this->balance('1180'));
        $this->assertSame(0, $this->balance('1110'));
    }

    /** @test */
    public function a_branch_override_keeps_merchant_tender_behavior(): void
    {
        $auth = $this->registerTenant('dlv-pos-override', 'owner@dlv-pos-override.test');
        app(TenantContext::class)->set($auth['tenant_id']);
        $other = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع التاجر'])->assertCreated()['data']['id'];
        $partnerId = $this->customer($auth['token']);
        $profile = $this->platform($auth['token'], 'hungerstation', Version::COLLECTION_PLATFORM, [
            'branch_overrides' => [[
                'branch_id' => $other,
                'collection_mode' => Version::COLLECTION_MERCHANT,
            ]],
        ]);
        $cashier = $this->tokenForRole($auth['tenant_id'], 'admin', 'cashier@dlv-pos-override.test');
        $sessionId = $this->openSession(['token' => $cashier], $other);
        $cash = $this->methodBySettlement($this->methods(['token' => $cashier], $other), 'cash');

        $this->checkout($cashier, $partnerId, $sessionId, [$this->tender($cash, 11500)], [
            'delivery_platform_profile_id' => $profile['id'],
        ], $other)->assertCreated();

        $invoice = Invoice::query()->where('pos_session_id', $sessionId)->firstOrFail();
        $this->assertSame(Version::COLLECTION_MERCHANT, DeliveryInvoiceContext::where('invoice_id', $invoice->id)->firstOrFail()->collection_mode);
        $this->assertSame(0, $this->balance('1180'));
        $this->assertSame(11500, $this->balance('1110'));
        $this->assertSame($sessionId, Payment::where('invoice_id', $invoice->id)->firstOrFail()->pos_session_id);
    }

    /** @test */
    public function disabled_inactive_foreign_and_mismatched_platforms_fail_closed(): void
    {
        [$auth, $sessionId, $partnerId] = $this->readyPos('closed');
        $disabled = $this->platform($auth['token'], 'mrsool', Version::COLLECTION_PLATFORM);
        $this->withToken($auth['token'])->putJson("/api/delivery-platforms/{$disabled['id']}", ['is_active' => false])->assertOk();

        $this->checkout($auth['token'], $partnerId, $sessionId, [], [
            'delivery_platform_profile_id' => $disabled['id'],
        ])->assertStatus(422);
        $this->assertSame(0, Invoice::count());

        $listed = $this->withToken($auth['token'])->getJson('/api/pos/delivery-platforms')->assertOk()->json('data');
        $this->assertSame([], array_values(array_filter($listed, fn ($row) => $row['id'] === $disabled['id'])));

        $foreignAuth = $this->registerTenant('dlv-pos-foreign', 'owner@dlv-pos-foreign.test');
        $foreign = $this->platform($foreignAuth['token'], 'ninja', Version::COLLECTION_PLATFORM, [
            'display_name' => 'SECRET-FOREIGN-PLATFORM',
        ]);
        $rejected = $this->checkout($auth['token'], $partnerId, $sessionId, [], [
            'delivery_platform_profile_id' => $foreign['id'],
        ])->assertStatus(422);
        $this->assertStringNotContainsString('SECRET-FOREIGN-PLATFORM', $rejected->getContent());
        $this->assertSame(0, Invoice::count());

        $broken = $this->platform($auth['token'], 'the_chefz', Version::COLLECTION_PLATFORM);
        DB::table('sales_channels')->where('id', $broken['sales_channel']['id'])->update(['slug' => 'not-a-delivery-slug']);
        $this->checkout($auth['token'], $partnerId, $sessionId, [], [
            'delivery_platform_profile_id' => $broken['id'],
        ])->assertStatus(422);
        $this->assertSame(0, Invoice::count());

        $inactiveChannel = $this->platform($auth['token'], 'hungerstation', Version::COLLECTION_PLATFORM);
        DB::table('sales_channels')->where('id', $inactiveChannel['sales_channel']['id'])->update(['is_active' => false]);
        $this->checkout($auth['token'], $partnerId, $sessionId, [], [
            'delivery_platform_profile_id' => $inactiveChannel['id'],
        ])->assertStatus(422);

        $inactiveVersion = $this->platform($auth['token'], 'keeta', Version::COLLECTION_PLATFORM);
        DB::table('delivery_platform_profile_versions')
            ->where('id', $inactiveVersion['current_version']['id'])
            ->update(['is_active' => false]);
        $this->checkout($auth['token'], $partnerId, $sessionId, [], [
            'delivery_platform_profile_id' => $inactiveVersion['id'],
        ])->assertStatus(422);
        $this->assertSame(0, Invoice::count());
        $hidden = $this->withToken($auth['token'])->getJson('/api/pos/delivery-platforms')->assertOk()->json('data');
        $this->assertSame([], array_values(array_filter($hidden, fn ($row) => $row['id'] === $inactiveVersion['id'])));
    }

    /** @test */
    public function external_reference_follows_the_pinned_policy(): void
    {
        [$auth, $sessionId, $partnerId, $cash] = $this->readyPos('ref');
        $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 11500)], [
            'external_order_reference' => 'ORPHAN',
        ])->assertStatus(422);
        $this->assertSame(0, Invoice::count());

        $required = $this->platform($auth['token'], 'jahez', Version::COLLECTION_PLATFORM, [
            'external_reference_policy' => Version::REFERENCE_REQUIRED,
        ]);

        $this->checkout($auth['token'], $partnerId, $sessionId, [], [
            'delivery_platform_profile_id' => $required['id'],
        ])->assertStatus(422);
        $this->assertSame(0, Invoice::count());

        $this->checkout($auth['token'], $partnerId, $sessionId, [], [
            'delivery_platform_profile_id' => $required['id'],
            'external_order_reference' => '  HS-42  ',
        ])->assertCreated();
        $this->assertSame('HS-42', DeliveryInvoiceContext::firstOrFail()->external_order_reference);

        $none = $this->platform($auth['token'], 'keeta', Version::COLLECTION_MERCHANT, [
            'external_reference_policy' => Version::REFERENCE_NONE,
        ]);
        $cash = $this->methodBySettlement($this->methods($auth), 'cash');
        $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 11500)], [
            'delivery_platform_profile_id' => $none['id'],
            'external_order_reference' => 'NO',
        ])->assertStatus(422);
    }

    /** @test */
    public function the_same_checkout_retries_without_duplicating_financial_effects(): void
    {
        [$auth, $sessionId, $partnerId] = $this->readyPos('idem');
        $profile = $this->platform($auth['token'], 'mrsool', Version::COLLECTION_PLATFORM, [
            'external_reference_policy' => Version::REFERENCE_OPTIONAL,
        ]);
        $key = (string) Str::uuid();
        $body = [
            'delivery_platform_profile_id' => $profile['id'],
            'external_order_reference' => 'SAME',
        ];

        $first = $this->checkout($auth['token'], $partnerId, $sessionId, [], $body, null, $key)->assertCreated();
        $journals = JournalEntry::count();
        $stocks = StockMovement::count();

        $second = $this->checkout($auth['token'], $partnerId, $sessionId, [], $body, null, $key)->assertOk();
        $this->assertTrue($second->json('idempotent_replay'));
        $this->assertSame($first['data']['id'], $second['data']['id']);
        $this->assertSame(1, Invoice::count());
        $this->assertSame(1, DeliveryInvoiceContext::count());
        $this->assertSame(1, Payment::count());
        $this->assertSame($journals, JournalEntry::count());
        $this->assertSame($stocks, StockMovement::count());
    }

    /** @test */
    public function a_retry_cannot_swap_the_platform_or_the_external_reference(): void
    {
        [$auth, $sessionId, $partnerId] = $this->readyPos('conflict');
        $first = $this->platform($auth['token'], 'jahez', Version::COLLECTION_PLATFORM);
        $second = $this->platform($auth['token'], 'ninja', Version::COLLECTION_PLATFORM);
        $key = (string) Str::uuid();

        $this->checkout($auth['token'], $partnerId, $sessionId, [], [
            'delivery_platform_profile_id' => $first['id'],
        ], null, $key)->assertCreated();

        $this->checkout($auth['token'], $partnerId, $sessionId, [], [
            'delivery_platform_profile_id' => $second['id'],
        ], null, $key)->assertStatus(409);
        $this->assertSame(1, Invoice::count());
        $this->assertSame(1, DeliveryInvoiceContext::count());

        $otherKey = (string) Str::uuid();
        $optional = $this->platform($auth['token'], 'keeta', Version::COLLECTION_PLATFORM, [
            'external_reference_policy' => Version::REFERENCE_OPTIONAL,
        ]);
        $this->checkout($auth['token'], $partnerId, $sessionId, [], [
            'delivery_platform_profile_id' => $optional['id'],
            'external_order_reference' => 'A',
        ], null, $otherKey)->assertCreated();
        $this->checkout($auth['token'], $partnerId, $sessionId, [], [
            'delivery_platform_profile_id' => $optional['id'],
            'external_order_reference' => 'B',
        ], null, $otherKey)->assertStatus(409);
        $this->assertSame(2, Invoice::count());
        $this->assertSame('A', DeliveryInvoiceContext::where('delivery_platform_profile_id', $optional['id'])->firstOrFail()->external_order_reference);
    }

    /** @test */
    public function selecting_a_platform_does_not_change_the_canonical_pos_price(): void
    {
        [$auth, $sessionId, $partnerId, $cash] = $this->readyPos('price');
        $product = $this->withToken($auth['token'])->postJson('/api/products', [
            'name' => 'وجبة',
            'sku' => 'DLV-PRICE-1',
            'type' => 'good',
            'sale_price' => 10000,
            'track_inventory' => false,
        ])->assertCreated()['data'];
        $item = ['product_id' => $product['id'], 'quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15];
        $profile = $this->platform($auth['token'], 'hungerstation', Version::COLLECTION_PLATFORM);

        $plain = $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 11500)], [
            'items' => [$item],
        ])->assertCreated();
        $delivered = $this->checkout($auth['token'], $partnerId, $sessionId, [], [
            'items' => [$item],
            'delivery_platform_profile_id' => $profile['id'],
        ])->assertCreated();

        $plainInvoice = Invoice::with('lines')->findOrFail($plain['data']['id']);
        $deliveredInvoice = Invoice::with('lines')->findOrFail($delivered['data']['id']);
        $this->assertSame($plainInvoice->total, $deliveredInvoice->total);
        $this->assertSame($plainInvoice->price_list_id, $deliveredInvoice->price_list_id);
        $this->assertSame((int) $plainInvoice->lines[0]->unit_price, (int) $deliveredInvoice->lines[0]->unit_price);
        $this->assertSame($partnerId, $deliveredInvoice->partner_id);
    }

    /** @test */
    public function later_configuration_changes_do_not_rewrite_the_pinned_context(): void
    {
        [$auth, $sessionId, $partnerId] = $this->readyPos('pin');
        $profile = $this->platform($auth['token'], 'jahez', Version::COLLECTION_PLATFORM);
        $this->checkout($auth['token'], $partnerId, $sessionId, [], [
            'delivery_platform_profile_id' => $profile['id'],
        ])->assertCreated();
        $context = DeliveryInvoiceContext::firstOrFail();

        $this->withToken($auth['token'])->putJson("/api/delivery-platforms/{$profile['id']}", [
            'collection_mode' => Version::COLLECTION_MERCHANT,
            'display_name' => 'جاهز بعد البيع',
        ])->assertOk();

        $context->refresh();
        $this->assertSame(Version::COLLECTION_PLATFORM, $context->collection_mode);
        $this->assertSame($profile['current_version']['id'], $context->delivery_platform_profile_version_id);
    }

    /** @test */
    public function the_selector_reuses_checkout_authorization_and_hides_admin_fields(): void
    {
        [$auth, $sessionId, $partnerId] = $this->readyPos('authz');
        $profile = $this->platform($auth['token'], 'keeta', Version::COLLECTION_PLATFORM);
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@dlv-pos-authz.test');

        $this->withToken($staff)->getJson('/api/pos/delivery-platforms')->assertForbidden();
        $this->withToken($staff)->postJson('/api/pos/checkout', [])->assertForbidden();

        $listed = $this->withToken($auth['token'])->getJson('/api/pos/delivery-platforms')->assertOk()->json('data');
        $row = collect($listed)->firstWhere('id', $profile['id']);
        $this->assertNotNull($row);
        $this->assertSame('platform_collected', $row['collection_mode']);
        $this->assertArrayNotHasKey('version_id', $row);
        $this->assertArrayNotHasKey('sales_channel_id', $row);
        $this->assertArrayNotHasKey('branch_overrides', $row);

        $this->checkout($auth['token'], $partnerId, $sessionId, [], [
            'delivery_platform_profile_id' => $profile['id'],
            'version_id' => $profile['current_version']['id'],
        ])->assertStatus(422);
    }

    /** @test */
    public function a_client_cannot_authoritatively_supply_collection_mode(): void
    {
        [$auth, $sessionId, $partnerId, $cash] = $this->readyPos('untrusted');
        $profile = $this->platform($auth['token'], 'ninja', Version::COLLECTION_MERCHANT);

        $this->checkout($auth['token'], $partnerId, $sessionId, [$this->tender($cash, 11500)], [
            'delivery_platform_profile_id' => $profile['id'],
            'collection_mode' => Version::COLLECTION_PLATFORM,
        ])->assertStatus(422);
        $this->assertSame(0, Invoice::count());
        $this->assertSame(0, $this->balance('1180'));
    }

    private function balance(string $code): int
    {
        $account = Account::where('code', $code)->first();

        return (int) ($account?->balance?->balance ?? 0);
    }

    private function line(JournalEntry $entry, string $code): ?JournalLine
    {
        return $entry->lines->first(fn (JournalLine $line) => $line->account->code === $code);
    }

    /** @return array{0: array, 1: string, 2: string, 3?: array, 4?: array} */
    private function readyPos(string $slug, bool $withBank = false): array
    {
        $auth = $this->registerTenant('dlv-pos-'.$slug, "owner@dlv-pos-{$slug}.test");
        app(TenantContext::class)->set($auth['tenant_id']);
        $sessionId = $this->openSession($auth);
        $partnerId = $this->customer($auth['token']);
        $cash = $this->methodBySettlement($this->methods($auth), 'cash');
        if (! $withBank) {
            return [$auth, $sessionId, $partnerId, $cash];
        }

        return [$auth, $sessionId, $partnerId, $cash, $this->methodBySettlement($this->methods($auth), 'bank')];
    }

    private function customer(string $token): string
    {
        return $this->withToken($token)->postJson('/api/partners', [
            'name' => 'عميل الكاشير',
            'type' => 'customer',
        ])->assertCreated()['data']['id'];
    }

    /** @param  array<string, mixed>  $extra */
    private function platform(string $token, string $key, string $mode, array $extra = []): array
    {
        return $this->withToken($token)->postJson('/api/delivery-platforms', array_merge([
            'platform_key' => $key,
            'collection_mode' => $mode,
        ], $extra))->assertCreated()['data'];
    }

    private function openSession(array $auth, ?string $branchId = null): string
    {
        $headers = $branchId ? ['X-Branch-Id' => $branchId] : [];
        $n = ++$this->deviceSequence;
        $warehouseId = $this->withToken($auth['token'])->withHeaders($headers)->postJson('/api/warehouses', [
            'name' => "مخزن {$n}",
            'code' => "DLV-W-{$n}",
            'is_active' => true,
        ])->assertCreated()['data']['id'];
        $deviceId = $this->withToken($auth['token'])->withHeaders($headers)->postJson('/api/pos-devices', [
            'name' => "كاشير {$n}",
            'code' => "DLV-D-{$n}",
            'warehouse_id' => $warehouseId,
            'is_active' => true,
        ])->assertCreated()['data']['id'];

        return $this->withToken($auth['token'])->withHeaders($headers)->postJson('/api/pos-sessions/open', [
            'opening_balance' => 0,
            'pos_device_id' => $deviceId,
        ])->assertCreated()['data']['id'];
    }

    /** @return array<int, array<string, mixed>> */
    private function methods(array $auth, ?string $branchId = null): array
    {
        $headers = $branchId ? ['X-Branch-Id' => $branchId] : [];

        return $this->withToken($auth['token'])->withHeaders($headers)->getJson('/api/payment-methods')->assertOk()['data'];
    }

    /** @param  array<string, mixed>  $method */
    private function methodBySettlement(array $methods, string $settlementType): array
    {
        foreach ($methods as $method) {
            if ($method['settlement_type'] === $settlementType) {
                return $method;
            }
        }

        $this->fail("لا توجد وسيلة {$settlementType}");
    }

    /** @param  array<string, mixed>  $method */
    private function tender(array $method, int $amount): array
    {
        return ['payment_method_id' => $method['id'], 'amount' => $amount];
    }

    /**
     * @param  list<array<string, mixed>>  $tenders
     * @param  array<string, mixed>  $extra
     */
    private function checkout(string $token, string $partnerId, string $sessionId, array $tenders, array $extra = [], ?string $branchId = null, ?string $key = null): \Illuminate\Testing\TestResponse
    {
        $headers = $branchId ? ['X-Branch-Id' => $branchId] : [];
        $items = $extra['items'] ?? [['quantity' => 1, 'unit_price' => 10000, 'tax_rate' => 15]];
        unset($extra['items']);

        return $this->withToken($token)->withHeaders($headers)->postJson('/api/pos/checkout', array_merge([
            'idempotency_key' => $key ?? (string) Str::uuid(),
            'partner_id' => $partnerId,
            'pos_session_id' => $sessionId,
            'items' => $items,
            'tenders' => $tenders,
        ], $extra));
    }
}
