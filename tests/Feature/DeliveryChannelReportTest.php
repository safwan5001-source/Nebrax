<?php

namespace Tests\Feature;

use App\Models\CreditNote;
use App\Models\DeliveryInvoiceContext;
use App\Models\DeliveryPlatformProfileVersion as Version;
use App\Models\Invoice;
use App\Models\InvoiceLine;
use App\Models\JournalEntry;
use App\Models\ReturnDocument;
use App\Models\User;
use App\Support\Money;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * DLV-CHANNEL-REPORT-API-1 — قراءة فقط.
 * الصفوف المرحّلة تُزرع كما هي مخزّنة. الاختبار لا يستدعي ترحيلاً جديداً
 * ولا يغيّر قاعدة الضريبة. ZATCA C14N ليس جزءاً من عقد التقرير.
 */
class DeliveryChannelReportTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private int $sequence = 0;

    /** @test */
    public function an_empty_population_returns_zero_metrics_without_writing(): void
    {
        $world = $this->boot('empty');
        $entries = JournalEntry::count();

        $report = $this->report($world['token'], 'from=2026-03-01&to=2026-03-31');

        $this->assertSame(0, $report['summary']['invoice_count']);
        $this->assertSame('0.00', $report['summary']['total']);
        $this->assertSame('0.00', $report['summary']['net_after_pos_returns']);
        $this->assertSame(0, $report['credit_notes']['count']);
        $this->assertSame(0, $report['exceptions']['context_branch_mismatch']);
        $this->assertSame(0, $report['exceptions']['credit_note_partner_mismatch']);
        $this->assertSame([], $report['platforms']);
        $this->assertSame([], $report['invoices']);
        $this->assertSame([], $report['returns']);
        $this->assertSame([1, 2, 3, 4, 5, 6, 7, 8, 9], array_column($report['metrics'], 'number'));
        $this->assertArrayNotHasKey('hub_orders', $report);
        $this->assertSame($entries, JournalEntry::count());
    }

    /** @test */
    public function a_posted_pos_delivery_invoice_keeps_the_stored_identity(): void
    {
        $world = $this->boot('identity');
        $invoice = $this->deliver($world, [
            'subtotal' => 9000,
            'discount' => 200,
            'shipping' => 500,
            'adjustment' => -25,
            'tax_amount' => 1350,
            'total' => 10625,
        ], [[
            'line_subtotal' => 10000,
            'line_discount' => 1000,
            'line_tax' => 1350,
            'line_total' => 10350,
        ]]);

        $gross = 10000;
        $discounts = 1200;
        $net = 9000 - 200 + 500 - 25;
        $this->assertSame($gross - $discounts + 500 - 25, $net);
        $this->assertSame($net + 1350, 10625);

        $report = $this->report($world['token'], 'from=2026-03-01&to=2026-03-31');
        $this->assertSame(Money::toRiyal($gross), $report['summary']['gross_sales']);
        $this->assertSame(Money::toRiyal($discounts), $report['summary']['discounts']);
        $this->assertSame(Money::toRiyal($net), $report['summary']['net_sales']);
        $this->assertSame(Money::toRiyal(1350), $report['summary']['vat']);
        $this->assertSame(Money::toRiyal(10625), $report['summary']['total']);
        $this->assertSame(Money::toRiyal(500), $report['summary']['shipping']);
        $this->assertSame(Money::toRiyal(-25), $report['summary']['adjustment']);
        $this->assertSame(1, $report['summary']['invoice_count']);
        $this->assertSame(1350, (int) $invoice->fresh()->tax_amount);
        $this->assertSame($report['summary']['total'], $report['metrics'][4]['amount']);
        $this->assertSame($report['summary']['net_sales'], $report['metrics'][2]['amount']);
    }

    /** @test */
    public function drafts_cancelled_invoices_and_sales_without_context_are_excluded(): void
    {
        $world = $this->boot('status');
        $posted = $this->deliver($world, $this->plainHeader(10000), $this->plainLines(10000));
        $this->deliver($world, $this->plainHeader(50000), $this->plainLines(50000), withContext: false);
        DB::table('invoices')->where('id', $posted->id)->update(['status' => 'draft']);

        $hidden = $this->report($world['token'], 'from=2026-03-01&to=2026-03-31');
        $this->assertSame(0, $hidden['summary']['invoice_count']);

        DB::table('invoices')->where('id', $posted->id)->update(['status' => 'posted']);
        $visible = $this->report($world['token'], 'from=2026-03-01&to=2026-03-31');
        $this->assertSame(1, $visible['summary']['invoice_count']);
        $this->assertSame('100.00', $visible['summary']['total']);

        DB::table('invoices')->where('id', $posted->id)->update(['status' => 'cancelled']);
        $cancelled = $this->report($world['token'], 'from=2026-03-01&to=2026-03-31');
        $this->assertSame(0, $cancelled['summary']['invoice_count']);
        $this->assertSame('0.00', $cancelled['summary']['total']);
    }

    /** @test */
    public function platforms_group_by_profile_and_collection_mode_does_not_increase_the_total(): void
    {
        $world = $this->boot('group');
        $merchant = $this->platform($world['token'], 'keeta', Version::COLLECTION_MERCHANT);
        $this->deliver($world, $this->plainHeader(11500, 1500), $this->plainLines(10000, 1500));
        $this->deliver($world, $this->plainHeader(11500, 1500), $this->plainLines(10000, 1500), profile: $merchant);

        $report = $this->report($world['token'], 'from=2026-03-01&to=2026-03-31');
        $this->assertSame(2, $report['summary']['invoice_count']);
        $this->assertSame('230.00', $report['summary']['total']);
        $this->assertSame('115.00', $report['collection']['platform_collected_total']);
        $this->assertSame('115.00', $report['collection']['merchant_collected_total']);
        $this->assertSame('0.00', $report['collection']['unclassified_total']);
        $this->assertSame($report['summary']['total'], $this->sumRiyal(
            $report['collection']['platform_collected_total'],
            $report['collection']['merchant_collected_total'],
            $report['collection']['unclassified_total'],
        ));

        $rows = collect($report['platforms'])->keyBy('platform_key');
        $this->assertSame('115.00', $rows['jahez']['total']);
        $this->assertSame('115.00', $rows['jahez']['platform_collected_total']);
        $this->assertSame('0.00', $rows['jahez']['merchant_collected_total']);
        $this->assertSame(1, $rows['jahez']['invoice_count']);
        $this->assertSame('keeta', $rows['keeta']['platform_key']);
        $this->assertSame('115.00', $rows['keeta']['merchant_collected_total']);
        $this->assertSame($world['profile']['id'], $rows['jahez']['delivery_platform_profile_id']);
        $this->assertSame(
            $report['summary']['total'],
            $this->sumRiyal($rows['jahez']['total'], $rows['keeta']['total']),
        );

        $onlyJahez = $this->report($world['token'], 'from=2026-03-01&to=2026-03-31&delivery_platform_profile_id='.$world['profile']['id']);
        $this->assertSame(1, $onlyJahez['summary']['invoice_count']);
        $this->assertSame('115.00', $onlyJahez['summary']['total']);
    }

    /** @test */
    public function two_lines_do_not_double_count_the_invoice_header(): void
    {
        $world = $this->boot('lines');
        $invoice = $this->deliver($world, $this->plainHeader(12500), [
            ['line_subtotal' => 10000, 'line_discount' => 0, 'line_tax' => 0, 'line_total' => 10000],
            ['line_subtotal' => 2500, 'line_discount' => 0, 'line_tax' => 0, 'line_total' => 2500],
        ]);
        $this->assertCount(2, $invoice->lines);

        $report = $this->report($world['token'], 'from=2026-03-01&to=2026-03-31');
        $this->assertSame(1, $report['summary']['invoice_count']);
        $this->assertSame(1, $report['metrics'][5]['count']);
        $this->assertSame('125.00', $report['summary']['gross_sales']);
        $this->assertSame('125.00', $report['summary']['total']);
        $this->assertCount(1, $report['invoices']);
        $this->assertSame('125.00', $report['invoices'][0]['total']);
        $this->assertSame($world['profile']['current_version']['display_name'], $report['invoices'][0]['display_name']);
    }

    /** @test */
    public function pos_returns_follow_return_date_and_do_not_reduce_the_invoice_count(): void
    {
        $world = $this->boot('returns');
        $inside = $this->deliver($world, $this->plainHeader(11500, 1500), $this->plainLines(10000, 1500));
        $outside = $this->deliver($world, $this->plainHeader(11500, 1500), $this->plainLines(10000, 1500));
        $insideReturn = $this->saleReturn($world, $inside, '2026-03-18', 4000, 600, 4600);
        $this->saleReturn($world, $outside, '2026-05-02', 11500, 0, 11500);

        $march = $this->report($world['token'], 'from=2026-03-01&to=2026-03-31');
        $this->assertSame(2, $march['summary']['invoice_count']);
        $this->assertSame(2, $march['metrics'][5]['count']);
        $this->assertSame(1, $march['summary']['returns_count']);
        $this->assertSame('46.00', $march['summary']['returns_total']);
        $this->assertSame('40.00', $march['summary']['returns_subtotal']);
        $this->assertSame('6.00', $march['summary']['returns_vat']);
        $this->assertSame('184.00', $march['summary']['net_after_pos_returns']);
        $this->assertSame($insideReturn->id, $march['returns'][0]['id']);
        $this->assertSame('2026-03-18', $march['returns'][0]['return_date']);
        $this->assertSame($inside->number, $march['returns'][0]['source_invoice_number']);
        $this->assertSame('jahez', $march['returns'][0]['platform_key']);

        $may = $this->report($world['token'], 'from=2026-05-01&to=2026-05-31');
        $this->assertSame(0, $may['summary']['invoice_count']);
        $this->assertSame(1, $may['summary']['returns_count']);
        $this->assertSame('115.00', $may['summary']['returns_total']);
        $this->assertSame('-115.00', $may['summary']['net_after_pos_returns']);
        $this->assertSame([], $may['invoices']);
        $this->assertSame('jahez', $may['platforms'][0]['platform_key']);
        $this->assertSame(0, $may['platforms'][0]['invoice_count']);
        $this->assertSame('-115.00', $may['platforms'][0]['net_after_pos_returns']);
    }

    /** @test */
    public function a_return_of_a_non_delivery_invoice_is_excluded(): void
    {
        $world = $this->boot('plain-return');
        $plain = $this->deliver($world, $this->plainHeader(10000), $this->plainLines(10000), withContext: false);
        $this->saleReturn($world, $plain, '2026-03-18', 10000, 0, 10000);

        $report = $this->report($world['token'], 'from=2026-03-01&to=2026-03-31');
        $this->assertSame(0, $report['summary']['invoice_count']);
        $this->assertSame(0, $report['summary']['returns_count']);
        $this->assertSame('0.00', $report['summary']['net_after_pos_returns']);
    }

    /** @test */
    public function credit_notes_use_note_date_and_are_not_subtracted_from_net_sales(): void
    {
        $world = $this->boot('notes');
        $invoice = $this->deliver($world, $this->plainHeader(10000), $this->plainLines(10000));
        $this->note($world, $invoice, '2026-04-10', 4000);
        $same = $this->note($world, $invoice, '2026-03-20', 1500);
        $this->note($world, $invoice, '2026-03-21', 9000, posted: false);

        $march = $this->report($world['token'], 'from=2026-03-01&to=2026-03-31');
        $this->assertSame(1, $march['summary']['invoice_count']);
        $this->assertSame(1, $march['credit_notes']['count']);
        $this->assertSame('15.00', $march['credit_notes']['total']);
        $this->assertSame($march['summary']['total'], $march['summary']['net_after_pos_returns']);
        $this->assertSame($march['metrics'][4]['amount'], $march['metrics'][8]['amount']);
        $this->assertSame($same->id, $march['credit_notes']['rows'][0]['id']);
        $this->assertSame('2026-03-20', $march['credit_notes']['rows'][0]['note_date']);
        $this->assertSame('jahez', $march['credit_notes']['rows'][0]['platform_key']);
        $this->assertCount(1, $march['credit_notes']['by_platform']);

        $april = $this->report($world['token'], 'from=2026-04-01&to=2026-04-30');
        $this->assertSame(0, $april['summary']['invoice_count']);
        $this->assertSame(1, $april['credit_notes']['count']);
        $this->assertSame('40.00', $april['credit_notes']['total']);
        $this->assertSame('0.00', $april['summary']['net_after_pos_returns']);
        $this->assertSame('0.00', $april['summary']['total']);
    }

    /** @test */
    public function mismatched_unlinked_and_out_of_range_credit_notes_stay_out_of_metric_seven(): void
    {
        $world = $this->boot('note-exceptions');
        $invoice = $this->deliver($world, $this->plainHeader(10000), $this->plainLines(10000));
        $other = $this->customer($world['token'], 'عميل آخر');
        $mismatch = $this->note($world, $invoice, '2026-03-18', 2500, partnerId: $other);
        $unlinked = $this->note($world, null, '2026-03-18', 2500);
        $early = $this->note($world, $invoice, '2026-02-01', 2500);
        $this->note($world, $invoice, '2026-03-18', 8000, type: 'purchase');

        $report = $this->report($world['token'], 'from=2026-03-01&to=2026-03-31');
        $this->assertSame(0, $report['credit_notes']['count']);
        $this->assertSame('0.00', $report['credit_notes']['total']);
        $this->assertSame(1, $report['exceptions']['credit_note_partner_mismatch']);
        $this->assertSame($report['summary']['total'], $report['summary']['net_after_pos_returns']);
        $ids = array_column($report['credit_notes']['rows'], 'id');
        $this->assertNotContains($mismatch->id, $ids);
        $this->assertNotContains($unlinked->id, $ids);
        $this->assertNotContains($early->id, $ids);
    }

    /** @test */
    public function a_context_whose_branch_differs_from_the_invoice_is_an_exception_not_a_sale(): void
    {
        $world = $this->boot('mismatch');
        $other = $this->withToken($world['token'])->postJson('/api/branches', ['name' => 'فرع السياق'])->assertCreated()['data']['id'];
        $invoice = $this->deliver($world, $this->plainHeader(10000), $this->plainLines(10000));
        DB::table('delivery_invoice_contexts')->where('invoice_id', $invoice->id)->update(['branch_id' => $other]);

        $report = $this->report($world['token'], 'from=2026-03-01&to=2026-03-31');
        $this->assertSame(0, $report['summary']['invoice_count']);
        $this->assertSame('0.00', $report['summary']['total']);
        $this->assertSame(1, $report['exceptions']['context_branch_mismatch']);
        $this->assertSame([], $report['invoices']);
    }

    /** @test */
    public function a_hub_row_sharing_the_external_reference_does_not_change_money_or_the_count(): void
    {
        $world = $this->boot('hub', Version::REFERENCE_OPTIONAL);
        $invoice = $this->deliver(
            $world,
            $this->plainHeader(11500, 1500),
            $this->plainLines(10000, 1500),
            reference: '=1+1',
        );
        DB::table('delivery_hub_orders')->insert([
            'id' => (string) Str::uuid(),
            'tenant_id' => $world['tenant_id'],
            'branch_id' => $world['branch_id'],
            'delivery_platform_profile_id' => $world['profile']['id'],
            'state' => 'cancelled',
            'provider_order_id' => 'HUB-1',
            'external_order_reference' => '=1+1',
            'request_checksum' => str_repeat('a', 64),
            'intake_payload_hash' => str_repeat('b', 64),
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        $report = $this->report($world['token'], 'from=2026-03-01&to=2026-03-31');
        $this->assertSame(1, $report['summary']['invoice_count']);
        $this->assertSame('115.00', $report['summary']['total']);
        $this->assertSame('=1+1', $report['invoices'][0]['external_order_reference']);
        $this->assertSame('=1+1', DeliveryInvoiceContext::where('invoice_id', $invoice->id)->firstOrFail()->external_order_reference);
        $this->assertArrayNotHasKey('hub_orders', $report);
    }

    /** @test */
    public function another_tenant_is_invisible(): void
    {
        $world = $this->boot('tenant');
        $this->deliver($world, $this->plainHeader(10000), $this->plainLines(10000));
        $other = $this->registerTenant('dlv-rpt-foreign', 'owner@dlv-rpt-foreign.test');

        $report = $this->report($other['token'], 'from=2026-03-01&to=2026-03-31');
        $this->assertSame(0, $report['summary']['invoice_count']);
        $this->assertSame('0.00', $report['summary']['total']);
        $this->assertSame([], $report['invoices']);
        $this->assertSame(0, $report['exceptions']['context_branch_mismatch']);
    }

    /** @test */
    public function branch_scope_limits_sales_returns_and_credit_notes(): void
    {
        $world = $this->boot('branch');
        $other = $this->withToken($world['token'])->postJson('/api/branches', [
            'name' => 'فرع محظور',
            'code' => 'DLV-RPT-B2',
        ])->assertCreated()['data']['id'];
        $main = $this->deliver($world, $this->plainHeader(10000), $this->plainLines(10000));
        $otherInvoice = $this->deliver($world, $this->plainHeader(50000), $this->plainLines(50000), branchId: $other);
        $this->saleReturn($world, $main, '2026-03-18', 1000, 0, 1000, branchId: $other);
        $this->note($world, $main, '2026-03-18', 1000, branchId: $other);

        app(TenantContext::class)->set($world['tenant_id']);
        $restricted = User::create([
            'tenant_id' => $world['tenant_id'],
            'name' => 'محاسب فرع',
            'email' => 'branch@dlv-rpt-branch.test',
            'password' => 'password123',
            'role' => 'accountant',
        ]);
        $restricted->branches()->sync([$world['branch_id']]);
        $token = $restricted->createToken('api')->plainTextToken;

        $omitted = $this->report($token, 'from=2026-03-01&to=2026-03-31');
        $this->assertSame(1, $omitted['summary']['invoice_count']);
        $this->assertSame('100.00', $omitted['summary']['total']);
        $this->assertSame($main->id, $omitted['invoices'][0]['id']);
        $this->assertSame(0, $omitted['summary']['returns_count']);
        $this->assertSame(0, $omitted['credit_notes']['count']);
        $this->assertSame([$world['branch_id']], $omitted['scope']['branch_ids']);

        $requested = $this->report($token, 'from=2026-03-01&to=2026-03-31&branch_id[]='.$other);
        $this->assertSame(1, $requested['summary']['invoice_count']);
        $this->assertSame($main->id, $requested['invoices'][0]['id']);
        $this->assertNotContains($otherInvoice->id, array_column($requested['invoices'], 'id'));
    }

    /** @test */
    public function missing_reports_view_is_forbidden_and_bad_filters_are_rejected(): void
    {
        $world = $this->boot('auth');
        $denied = $this->tokenForRole($world['tenant_id'], 'self_service', 'self@dlv-rpt-auth.test');
        $this->withToken($denied)->getJson('/api/reports/delivery-channel?from=2026-03-01&to=2026-03-31')->assertForbidden();

        $this->withToken($world['token'])->getJson('/api/reports/delivery-channel?from=2026-03-31&to=2026-03-01')->assertStatus(422);
        $this->withToken($world['token'])->getJson('/api/reports/delivery-channel?from=not-a-date')->assertStatus(422);
        $this->withToken($world['token'])->getJson('/api/reports/delivery-channel?delivery_platform_profile_id=not-a-uuid')->assertStatus(422);
        $this->withToken($world['token'])->getJson('/api/reports/delivery-channel?branch_id=main')->assertStatus(422);

        $accountant = $this->tokenForRole($world['tenant_id'], 'accountant', 'accountant@dlv-rpt-auth.test');
        $this->withToken($accountant)->getJson('/api/reports/delivery-channel?from=2026-03-01&to=2026-03-31')->assertOk();
    }

    /** @test */
    public function halala_amounts_stay_exact_at_the_display_edge(): void
    {
        $world = $this->boot('halala');
        $this->deliver($world, $this->plainHeader(3), [
            ['line_subtotal' => 1, 'line_discount' => 0, 'line_tax' => 0, 'line_total' => 1],
            ['line_subtotal' => 2, 'line_discount' => 0, 'line_tax' => 0, 'line_total' => 2],
        ]);

        $report = $this->report($world['token'], 'from=2026-03-01&to=2026-03-31');
        $this->assertSame('0.03', $report['summary']['gross_sales']);
        $this->assertSame('0.03', $report['summary']['net_sales']);
        $this->assertSame('0.00', $report['summary']['vat']);
        $this->assertSame('0.03', $report['summary']['total']);
        $this->assertSame(1, $report['summary']['invoice_count']);
    }

    /** @return array{token:string,tenant_id:string,branch_id:string,session_id:string,partner_id:string,profile:array<string,mixed>} */
    private function boot(string $slug, string $referencePolicy = Version::REFERENCE_NONE): array
    {
        $auth = $this->registerTenant('dlv-rpt-'.$slug, "owner@dlv-rpt-{$slug}.test");
        app(TenantContext::class)->set($auth['tenant_id']);
        $branchId = $this->withToken($auth['token'])->getJson('/api/branches')->assertOk()['data'][0]['id'];
        $sessionId = $this->openSession($auth['token']);
        $partnerId = $this->customer($auth['token'], 'عميل التقرير');
        $profile = $this->platform($auth['token'], 'jahez', Version::COLLECTION_PLATFORM, [
            'external_reference_policy' => $referencePolicy,
            'display_name' => 'جاهز المثبت',
        ]);

        return [
            'token' => $auth['token'],
            'tenant_id' => $auth['tenant_id'],
            'branch_id' => $branchId,
            'session_id' => $sessionId,
            'partner_id' => $partnerId,
            'profile' => $profile,
        ];
    }

    /** @param  array<string,int>  $header
     * @param  list<array<string,int>>  $lines
     * @param  array<string,mixed>|null  $profile
     */
    private function deliver(
        array $world,
        array $header,
        array $lines,
        ?array $profile = null,
        bool $withContext = true,
        ?string $reference = null,
        ?string $branchId = null,
        string $date = '2026-03-08',
        ?string $sessionId = null,
    ): Invoice {
        app(TenantContext::class)->set($world['tenant_id']);
        $profile ??= $world['profile'];
        $branchId ??= $world['branch_id'];
        $invoice = Invoice::create([
            'branch_id' => $branchId,
            'pos_session_id' => $sessionId ?? $world['session_id'],
            'number' => 'DLV-RPT-'.(++$this->sequence),
            'partner_id' => $world['partner_id'],
            'type' => 'sale',
            'payment_type' => 'credit',
            'invoice_date' => $date,
            'status' => 'posted',
            'subtotal' => $header['subtotal'],
            'discount' => $header['discount'] ?? 0,
            'shipping' => $header['shipping'] ?? 0,
            'adjustment' => $header['adjustment'] ?? 0,
            'tax_amount' => $header['tax_amount'] ?? 0,
            'total' => $header['total'],
            'tax_inclusive' => false,
        ]);
        foreach ($lines as $line) {
            InvoiceLine::create([
                'invoice_id' => $invoice->id,
                'quantity' => 1,
                'unit_price' => $line['line_subtotal'],
                'tax_rate' => 0,
                'line_subtotal' => $line['line_subtotal'],
                'line_discount' => $line['line_discount'],
                'line_tax' => $line['line_tax'],
                'line_total' => $line['line_total'],
            ]);
        }
        if ($withContext) {
            DeliveryInvoiceContext::create([
                'invoice_id' => $invoice->id,
                'branch_id' => $invoice->branch_id,
                'sales_channel_id' => $profile['sales_channel']['id'],
                'delivery_platform_profile_id' => $profile['id'],
                'delivery_platform_profile_version_id' => $profile['current_version']['id'],
                'external_order_reference' => $reference,
            ]);
        }

        return $invoice->fresh('lines');
    }

    private function saleReturn(
        array $world,
        Invoice $invoice,
        string $date,
        int $subtotal,
        int $tax,
        int $total,
        ?string $branchId = null,
    ): ReturnDocument {
        app(TenantContext::class)->set($world['tenant_id']);

        return ReturnDocument::create([
            'branch_id' => $branchId ?? $invoice->branch_id,
            'pos_session_id' => $world['session_id'],
            'number' => 'DLV-RET-'.(++$this->sequence),
            'type' => 'sales',
            'partner_id' => $invoice->partner_id,
            'payment_type' => 'credit',
            'return_date' => $date,
            'status' => 'posted',
            'subtotal' => $subtotal,
            'tax_amount' => $tax,
            'total' => $total,
            'original_type' => Invoice::class,
            'original_id' => $invoice->id,
        ]);
    }

    private function note(
        array $world,
        ?Invoice $invoice,
        string $date,
        int $total,
        ?string $partnerId = null,
        bool $posted = true,
        string $type = 'sales',
        ?string $branchId = null,
    ): CreditNote {
        app(TenantContext::class)->set($world['tenant_id']);

        return CreditNote::create([
            'branch_id' => $branchId ?? ($invoice?->branch_id ?? $world['branch_id']),
            'number' => 'DLV-CN-'.(++$this->sequence),
            'type' => $type,
            'partner_id' => $partnerId ?? $world['partner_id'],
            'refund_type' => 'credit',
            'note_date' => $date,
            'status' => $posted ? 'posted' : 'draft',
            'subtotal' => $total,
            'tax_amount' => 0,
            'total' => $total,
            'original_invoice_id' => $invoice?->id,
        ]);
    }

    /** @return array{subtotal:int,discount:int,shipping:int,adjustment:int,tax_amount:int,total:int} */
    private function plainHeader(int $total, int $tax = 0): array
    {
        return [
            'subtotal' => $total - $tax,
            'discount' => 0,
            'shipping' => 0,
            'adjustment' => 0,
            'tax_amount' => $tax,
            'total' => $total,
        ];
    }

    /** @return list<array<string,int>> */
    private function plainLines(int $net, int $tax = 0): array
    {
        return [[
            'line_subtotal' => $net,
            'line_discount' => 0,
            'line_tax' => $tax,
            'line_total' => $net + $tax,
        ]];
    }

    private function report(string $token, string $query): array
    {
        return $this->withToken($token)->getJson('/api/reports/delivery-channel?'.$query)->assertOk()->json();
    }

    private function customer(string $token, string $name): string
    {
        return $this->withToken($token)->postJson('/api/partners', [
            'name' => $name,
            'type' => 'customer',
        ])->assertCreated()['data']['id'];
    }

    /** @param  array<string,mixed>  $extra */
    private function platform(string $token, string $key, string $mode, array $extra = []): array
    {
        return $this->withToken($token)->postJson('/api/delivery-platforms', array_merge([
            'platform_key' => $key,
            'collection_mode' => $mode,
        ], $extra))->assertCreated()['data'];
    }

    private function openSession(string $token, ?string $branchId = null): string
    {
        $headers = $branchId ? ['X-Branch-Id' => $branchId] : [];
        $n = ++$this->sequence;
        $warehouseId = $this->withToken($token)->withHeaders($headers)->postJson('/api/warehouses', [
            'name' => "مخزن {$n}",
            'code' => "DLV-RPT-W-{$n}",
            'is_active' => true,
        ])->assertCreated()['data']['id'];
        $deviceId = $this->withToken($token)->withHeaders($headers)->postJson('/api/pos-devices', [
            'name' => "كاشير {$n}",
            'code' => "DLV-RPT-D-{$n}",
            'warehouse_id' => $warehouseId,
            'is_active' => true,
        ])->assertCreated()['data']['id'];

        return $this->withToken($token)->withHeaders($headers)->postJson('/api/pos-sessions/open', [
            'opening_balance' => 0,
            'pos_device_id' => $deviceId,
        ])->assertCreated()['data']['id'];
    }

    private function halalas(string $riyal): int
    {
        $negative = str_starts_with($riyal, '-');
        [$whole, $fraction] = array_pad(explode('.', ltrim($riyal, '-')), 2, '00');
        $value = ((int) $whole) * 100 + (int) substr(str_pad($fraction, 2, '0'), 0, 2);

        return $negative ? -$value : $value;
    }

    private function sumRiyal(string ...$values): string
    {
        $total = 0;
        foreach ($values as $value) {
            $total += $this->halalas($value);
        }

        return Money::toRiyal($total);
    }
}
