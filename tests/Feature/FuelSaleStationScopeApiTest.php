<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\FuelNozzle;
use App\Models\FuelOperationalLedger;
use App\Models\FuelProduct;
use App\Models\FuelPump;
use App\Models\FuelSale;
use App\Models\FuelSalePaymentReceipt;
use App\Models\FuelShift;
use App\Models\FuelShiftEvent;
use App\Models\FuelStation;
use App\Models\FuelStationProductPrice;
use App\Models\FuelTank;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\PaymentMethod;
use App\Models\Product;
use App\Models\Role;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Accounting\CashBankAccountService;
use App\Services\Accounting\InventoryService;
use App\Services\EntitlementGrantService;
use App\Services\FuelCostBasisService;
use App\Services\FuelSaleService;
use App\Services\FuelStationProductPriceService;
use App\Services\FuelStationSettingsService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Carbon\CarbonImmutable;
use Illuminate\Foundation\Testing\RefreshDatabase;
use RuntimeException;
use Tests\TestCase;

/**
 * #2016 — تفويض المحطة/المخزن لمسارات مبيعات الوقود والتحصيل وطرق الدفع والأسعار على الخادم.
 *
 * `FuelStation` مصنَّفة CompanyWide و`FuelSale` BranchScoped (فرع فقط). كان `FuelSaleController` يكتفي بتصفية الفرع
 * النشط، فمستخدم مقيَّد بمخزن/محطة داخل الفرع نفسه يقرأ مبيعات محطة أخرى وينشئ عليها مسودة ويُنهيها (فاتورة + قيد COGS +
 * حركة مخزون) ويحصّل عليها (سند قبض) بمجرد معرفة المعرّف. يثبّت هذا الاختبار العقد: خارج النطاق = 404 موحّد **قبل أي أثر**،
 * وحارس ثانٍ داخل `FuelSaleService` تحت القفل (دفاع في العمق)، دون تغيير ما هو داخل النطاق ودون تغيير صيغ أو قيود مالية.
 *
 * بيانات اصطناعية معزولة بالكامل على قاعدة اختبار؛ لا بيانات محطات حقيقية.
 */
class FuelSaleStationScopeApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const BASE = '/api/fuel-stations';

    /** @test */
    public function sales_list_and_show_hide_sales_of_stations_outside_the_users_warehouse_or_branch(): void
    {
        $f = $this->fixture();
        $seller = $f['wh_seller_token'];
        $a = $this->draftAs($f['owner_token'], $f, 'a', 'owner-a')['id'];
        $a2 = $this->draftAs($f['owner_token'], $f, 'a2', 'owner-a2')['id'];
        $b = $f['sale_b']->id;

        $this->withToken($seller)->getJson(self::BASE . '/sales')->assertOk()
            ->assertJsonCount(1, 'data')->assertJsonPath('data.0.id', $a);
        $this->withToken($seller)->getJson(self::BASE . '/sales?branch=all')->assertOk()->assertJsonCount(1, 'data');
        $this->withToken($seller)->getJson(self::BASE . '/sales?station_id=' . $f['a2']['station']->id)->assertOk()->assertJsonCount(0, 'data');
        $this->withToken($seller)->getJson(self::BASE . '/sales?shift_id=' . $f['a2']['shift']->id)->assertOk()->assertJsonCount(0, 'data');
        $this->withToken($seller)->getJson(self::BASE . '/sales?status=draft')->assertOk()->assertJsonCount(1, 'data');

        $this->withToken($seller)->getJson(self::BASE . "/sales/{$a}")->assertOk();
        $this->withToken($seller)->getJson(self::BASE . "/sales/{$a2}")->assertNotFound();
        $this->withToken($seller)->getJson(self::BASE . "/sales/{$b}")->assertNotFound();

        // مقيَّد بالفرع أ: لا يرى بيع الفرع ب ولو بـ branch=all أو ترويسة فرع لا يملكه.
        $br = $f['br_seller_token'];
        $this->withToken($br)->getJson(self::BASE . '/sales?branch=all')->assertOk()->assertJsonCount(2, 'data');
        $this->withToken($br)->getJson(self::BASE . "/sales/{$b}")->assertNotFound();
        $this->withToken($br)->withHeaders(['X-Branch-Id' => $f['branch_b']->id])->getJson(self::BASE . "/sales/{$b}")->assertNotFound();
        $this->resetBranch($f); 

        // غير المقيَّد يرى الكل ضمن الفرع النشط (لا تغيير له).
        $this->withToken($f['owner_token'])->getJson(self::BASE . '/sales')->assertOk()->assertJsonCount(2, 'data');
        $this->withToken($f['owner_token'])->getJson(self::BASE . "/sales/{$a2}")->assertOk();
    }

    /** @test */
    public function creating_a_draft_on_a_station_outside_scope_is_hidden_and_leaves_no_trace(): void
    {
        $f = $this->fixture();
        $before = $this->counts();

        $payload = $this->draftPayload($f['a2'], 'seller-out');
        $this->withToken($f['wh_seller_token'])->postJson(self::BASE . '/sales', $payload)->assertNotFound();
        $this->withToken($f['br_seller_token'])->postJson(self::BASE . '/sales', $this->draftPayload($f['b'], 'br-out'))->assertNotFound();
        $this->withToken($f['br_seller_token'])->withHeaders(['X-Branch-Id' => $f['branch_b']->id])
            ->postJson(self::BASE . '/sales', $this->draftPayload($f['b'], 'br-out-header'))->assertNotFound();
        $this->resetBranch($f);
        $this->assertSame($before, $this->counts());

        // داخل نطاقه يعمل كالمعتاد (لا حجب زائد)، والنزول إلى فوهة/وردية محطة أخرى بمحطة مسموحة لا يمرّ.
        $this->withToken($f['wh_seller_token'])->postJson(self::BASE . '/sales', $this->draftPayload($f['a'], 'seller-in'))
            ->assertCreated()->assertJsonPath('data.status', 'draft');
        $mixed = $this->draftPayload($f['a'], 'seller-mixed-nozzle');
        $mixed['fuel_nozzle_id'] = $f['a2']['nozzle']->id;
        $this->withToken($f['wh_seller_token'])->postJson(self::BASE . '/sales', $mixed)->assertStatus(422);
        $mixedShift = $this->draftPayload($f['a'], 'seller-mixed-shift');
        $mixedShift['fuel_shift_id'] = $f['a2']['shift']->id;
        $this->withToken($f['wh_seller_token'])->postJson(self::BASE . '/sales', $mixedShift)->assertStatus(422);
        $this->assertSame($before['sales'] + 1, $this->counts()['sales']);
    }

    /** @test */
    public function finalizing_a_sale_outside_scope_is_hidden_and_creates_no_invoice_journal_or_stock_movement(): void
    {
        $f = $this->fixture();
        $a2 = $this->draftAs($f['owner_token'], $f, 'a2', 'fin-a2')['id'];
        $before = $this->counts();

        $this->withToken($f['wh_seller_token'])->postJson(self::BASE . "/sales/{$a2}/finalize")->assertNotFound();
        $this->withToken($f['br_seller_token'])->postJson(self::BASE . "/sales/{$f['sale_b']->id}/finalize")->assertNotFound();

        $this->assertSame($before, $this->counts());
        $this->assertSame('draft', FuelSale::withoutGlobalScopes()->findOrFail($a2)->status);

        // داخل النطاق: دورة كاملة تعمل وتنتج فاتورة وحركة مخزون كالمعتاد.
        $own = $this->draftAs($f['wh_seller_token'], $f, 'a', 'fin-own')['id'];
        $this->withToken($f['wh_seller_token'])->postJson(self::BASE . "/sales/{$own}/finalize")
            ->assertOk()->assertJsonPath('data.status', 'finalized');
        $this->assertSame($before['invoices'] + 1, $this->counts()['invoices']);
        $this->assertSame($before['stock'] + 1, $this->counts()['stock']);
    }

    /** @test */
    public function collecting_payment_and_listing_payment_methods_outside_scope_are_hidden_and_create_no_receipt(): void
    {
        $f = $this->fixture();
        $a2 = $this->draftAs($f['owner_token'], $f, 'a2', 'col-a2')['id'];
        $this->withToken($f['owner_token'])->postJson(self::BASE . "/sales/{$a2}/finalize")->assertOk();
        $before = $this->counts();
        $pay = $this->payPayload($f, 'seller-col');

        $this->withToken($f['wh_seller_token'])->getJson(self::BASE . "/stations/{$f['a2']['station']->id}/sale-payment-methods")->assertNotFound();
        $this->withToken($f['br_seller_token'])->getJson(self::BASE . "/stations/{$f['b']['station']->id}/sale-payment-methods")->assertNotFound();
        $this->withToken($f['wh_seller_token'])->getJson(self::BASE . "/stations/{$f['a']['station']->id}/sale-payment-methods")
            ->assertOk()->assertJsonCount(1, 'data');

        $this->withToken($f['wh_seller_token'])->postJson(self::BASE . "/sales/{$a2}/payments", $pay)->assertNotFound();
        $this->withToken($f['br_seller_token'])->postJson(self::BASE . "/sales/{$f['sale_b']->id}/payments", $pay)->assertNotFound();
        $this->assertSame($before, $this->counts());
        $this->assertSame(0, $this->n(FuelSalePaymentReceipt::class));

        // إعادة إرسال مفتاح التحصيل نفسه لا يُرجع السند لمن خرج من النطاق (حتى بعد أن حصّل المالك فعلاً).
        $ownerPay = $this->payPayload($f, 'owner-col');
        $this->withToken($f['owner_token'])->postJson(self::BASE . "/sales/{$a2}/payments", $ownerPay)->assertCreated();
        $this->withToken($f['wh_seller_token'])->postJson(self::BASE . "/sales/{$a2}/payments", $ownerPay)->assertNotFound();
        $this->assertSame(1, $this->n(FuelSalePaymentReceipt::class));
        $this->assertSame(1, $this->n(Payment::class));
    }

    /** @test */
    public function an_in_scope_user_keeps_the_full_sale_lifecycle_and_idempotent_replays_create_one_record(): void
    {
        $f = $this->fixture();
        $seller = $f['wh_seller_token'];
        $payload = $this->draftPayload($f['a'], 'life-draft');
        $id = $this->withToken($seller)->postJson(self::BASE . '/sales', $payload)->assertCreated()->json('data.id');
        $this->withToken($seller)->postJson(self::BASE . '/sales', $payload)->assertCreated()->assertJsonPath('data.id', $id);
        $this->assertSame(1, FuelSale::withoutGlobalScopes()->where('idempotency_key', 'life-draft')->count());

        $this->withToken($seller)->postJson(self::BASE . "/sales/{$id}/finalize")->assertOk();
        $this->withToken($seller)->postJson(self::BASE . "/sales/{$id}/finalize")->assertOk();
        $this->assertSame(1, $this->n(Invoice::class));

        $pay = $this->payPayload($f, 'life-pay');
        $this->withToken($seller)->postJson(self::BASE . "/sales/{$id}/payments", $pay)->assertCreated();
        $this->withToken($seller)->postJson(self::BASE . "/sales/{$id}/payments", $pay)->assertCreated();
        $this->assertSame(1, $this->n(Payment::class));
        $this->assertSame(1, $this->n(FuelSalePaymentReceipt::class));
        $this->withToken($seller)->getJson(self::BASE . "/sales/{$id}")->assertOk()->assertJsonPath('data.payment_status', 'paid');
    }

    /** @test */
    public function revoking_scope_after_the_screen_was_opened_blocks_finalize_collect_and_replays(): void
    {
        $f = $this->fixture();
        $seller = $f['wh_seller_token'];
        $id = $this->draftAs($seller, $f, 'a', 'rev-draft')['id'];
        $this->withToken($seller)->postJson(self::BASE . "/sales/{$id}/finalize")->assertOk();
        $this->withToken($seller)->postJson(self::BASE . "/sales/{$id}/payments", $this->payPayload($f, 'rev-pay-1', 100))->assertCreated();
        $before = $this->counts();

        // يُنقل المستخدم إلى مخزن محطة أخرى بعد فتح الشاشة (تغيّر الصلاحيات).
        $f['wh_seller']->warehouses()->sync([$f['a2']['warehouse']->id]);

        $this->withToken($seller)->getJson(self::BASE . "/sales/{$id}")->assertNotFound();
        $this->withToken($seller)->postJson(self::BASE . "/sales/{$id}/payments", $this->payPayload($f, 'rev-pay-2', 100))->assertNotFound();
        $this->withToken($seller)->postJson(self::BASE . "/sales/{$id}/payments", $this->payPayload($f, 'rev-pay-1', 100))->assertNotFound();
        $this->withToken($seller)->postJson(self::BASE . '/sales', $this->draftPayload($f['a'], 'rev-draft'))->assertNotFound();
        $this->assertSame($before, $this->counts());
    }

    /** @test */
    public function removing_the_permission_after_the_screen_was_opened_is_enforced_per_request(): void
    {
        $f = $this->fixture();
        $seller = $f['wh_seller_token'];
        $id = $this->draftAs($seller, $f, 'a', 'perm-draft')['id'];

        Role::where('slug', 'fuel-sale-seller')->update(['permissions' => ['fuel.sale.view']]);

        $this->withToken($seller)->postJson(self::BASE . "/sales/{$id}/finalize")->assertForbidden();
        $this->withToken($seller)->postJson(self::BASE . "/sales/{$id}/payments", $this->payPayload($f, 'perm-pay'))->assertForbidden();
        $this->withToken($seller)->postJson(self::BASE . '/sales', $this->draftPayload($f['a'], 'perm-draft-2'))->assertForbidden();
        $this->assertSame('draft', FuelSale::withoutGlobalScopes()->findOrFail($id)->status);
    }

    /** @test */
    public function another_tenant_can_reach_none_of_the_sale_routes(): void
    {
        $f = $this->fixture();
        $a = $this->draftAs($f['owner_token'], $f, 'a', 'ten-draft')['id'];
        $this->withToken($f['owner_token'])->postJson(self::BASE . "/sales/{$a}/finalize")->assertOk();
        $before = $this->counts();
        $other = $f['other_tenant_token'];

        $this->withToken($other)->getJson(self::BASE . '/sales')->assertOk()->assertJsonCount(0, 'data');
        $this->withToken($other)->getJson(self::BASE . "/sales/{$a}")->assertNotFound();
        $this->withToken($other)->postJson(self::BASE . "/sales/{$a}/finalize")->assertNotFound();
        $this->withToken($other)->postJson(self::BASE . "/sales/{$a}/payments", $this->payPayload($f, 'ten-pay'))->assertNotFound();
        $this->withToken($other)->getJson(self::BASE . "/stations/{$f['a']['station']->id}/sale-payment-methods")->assertNotFound();
        $this->withToken($other)->postJson(self::BASE . '/sales', $this->draftPayload($f['a'], 'ten-draft-x'))->assertNotFound();
        $this->withToken($other)->getJson(self::BASE . '/prices/effective?station_id=' . $f['a']['station']->id)->assertNotFound();
        $this->withToken($other)->getJson(self::BASE . '/prices?station_id=' . $f['a']['station']->id)->assertNotFound();
        $this->assertSame($before, $this->counts());
    }

    /** @test */
    public function price_reads_and_writes_are_scoped_to_the_users_stations_and_never_regress(): void
    {
        $f = $this->fixture();
        $pm = $f['wh_price_manager_token'];
        $fuelProduct = $f['fuel_product'];
        $servicePrices = app(FuelStationProductPriceService::class);
        $servicePrices->create([
            'fuel_station_id' => $f['a2']['station']->id, 'fuel_product_id' => $fuelProduct->id, 'price_per_liter_minor' => 333,
            'effective_from' => now()->subMinute()->toIso8601String(),
        ], $f['owner']);

        // قراءة: محطة خارج النطاق = 404 موحّد في السجل والفعّال والاقتراحات.
        $a2 = $f['a2']['station']->id;
        $this->withToken($pm)->getJson(self::BASE . "/prices?station_id={$a2}")->assertNotFound();
        $this->withToken($pm)->getJson(self::BASE . "/prices/effective?station_id={$a2}")->assertNotFound();
        $this->withToken($pm)->getJson(self::BASE . "/prices/suggestions?station_id={$a2}")->assertNotFound();
        $this->withToken($pm)->getJson(self::BASE . "/prices?station_id={$f['b']['station']->id}")->assertNotFound();
        // بلا station_id: لا تظهر صفوف المحطة خارج النطاق، ويبقى سعر المؤسسة الافتراضي مرئياً (#1998).
        $rows = collect($this->withToken($pm)->getJson(self::BASE . '/prices')->assertOk()->json('data'));
        $this->assertFalse($rows->contains(fn ($r) => $r['fuel_station_id'] === $a2), 'سعر محطة خارج النطاق ظاهر.');
        $this->assertTrue($rows->contains(fn ($r) => $r['fuel_station_id'] === null), 'سعر المؤسسة الافتراضي يجب أن يبقى مرئياً.');

        // كتابة: محطة خارج النطاق = 404 بلا صف؛ سعر المؤسسة لمقيَّد = 403؛ داخل النطاق = 201 (#2010/#2019 سليمان).
        $count = FuelStationProductPrice::withoutGlobalScopes()->count();
        $body = fn (?string $station, string $key) => [
            'fuel_station_id' => $station, 'fuel_product_id' => $fuelProduct->id, 'price_per_liter_minor' => 250,
            'effective_from' => now()->addDay()->toIso8601String(), 'reason' => 'اختبار نطاق #2016', 'idempotency_key' => $key,
            'supersede' => true,
        ];
        $this->withToken($pm)->postJson(self::BASE . '/prices', $body($a2, 'pm-a2-key'))->assertNotFound();
        $this->withToken($pm)->postJson(self::BASE . '/prices', $body(null, 'pm-org-key'))->assertForbidden();
        $this->assertSame($count, FuelStationProductPrice::withoutGlobalScopes()->count());
        $this->withToken($pm)->postJson(self::BASE . '/prices', $body($f['a']['station']->id, 'pm-a-key'))->assertCreated();
        $this->assertSame($count + 1, FuelStationProductPrice::withoutGlobalScopes()->count());
        $this->withToken($pm)->getJson(self::BASE . "/prices/effective?station_id={$f['a']['station']->id}")
            ->assertOk()->assertJsonPath('data.0.fuel_product_id', $fuelProduct->id);

        // المسؤول غير المقيَّد يقرأ ويكتب الجميع كما كان.
        $this->withToken($f['owner_token'])->getJson(self::BASE . "/prices/effective?station_id={$a2}")->assertOk();
        $this->withToken($f['owner_token'])->postJson(self::BASE . '/prices', $body(null, 'owner-org-key'))->assertCreated();
    }

    /** @test */
    public function the_service_re_checks_the_actor_scope_under_the_lock_even_if_the_http_guard_is_bypassed(): void
    {
        $f = $this->fixture();
        $service = app(FuelSaleService::class);
        $outsider = $f['wh_seller']; // مقيَّد بمخزن أ فقط
        $before = $this->counts();

        // مسودة على محطة خارج النطاق.
        $this->assertServiceRejects(fn () => $service->createDraft($this->draftPayload($f['a2'], 'svc-draft'), $outsider));

        // إنهاء مسودة خارج النطاق.
        $a2 = $service->createDraft($this->draftPayload($f['a2'], 'svc-owner-draft'), $f['owner']);
        $before = $this->counts();
        $this->assertServiceRejects(fn () => $service->finalize($a2, $outsider));
        $this->assertSame($before, $this->counts());
        $this->assertSame('draft', $a2->fresh()->status);

        // تحصيل وإعادة تحصيل بالمفتاح نفسه لبيع خارج النطاق.
        $finalized = $service->finalize($a2, $f['owner']);
        $pay = $this->payPayload($f, 'svc-pay');
        $service->collectPayment($finalized, $pay, $f['owner']);
        $before = $this->counts();
        $this->assertServiceRejects(fn () => $service->collectPayment($finalized, $this->payPayload($f, 'svc-pay-2'), $outsider));
        $this->assertServiceRejects(fn () => $service->collectPayment($finalized, $pay, $outsider)); // replay لا يُرجع السند
        $this->assertSame($before, $this->counts());

        // فاعل داخل النطاق يعمل في الخدمة كما كان.
        $own = $service->createDraft($this->draftPayload($f['a'], 'svc-own'), $outsider);
        $this->assertSame('draft', $own->status);
    }

    /** @test */
    public function users_without_sale_view_never_see_sale_amounts_through_the_shift_resource(): void
    {
        $f = $this->fixture();
        $id = $this->draftAs($f['owner_token'], $f, 'a', 'd8-draft')['id'];
        $this->withToken($f['owner_token'])->postJson(self::BASE . "/sales/{$id}/finalize")->assertOk();
        $this->withToken($f['owner_token'])->postJson(self::BASE . "/sales/{$id}/payments", $this->payPayload($f, 'd8-pay'))->assertCreated();
        $this->assertSame(1, FuelShiftEvent::withoutGlobalScopes()->where('type', FuelShiftEvent::TYPE_OFFICIAL_CASH_PAYMENT_RECORDED)->count());
        $shiftId = $f['a']['shift']->id;
        $paid = (int) Payment::withoutGlobalScopes()->sole()->amount;
        $this->assertGreaterThan(0, $paid);

        // صاحب fuel.shift.view فقط: لا حدث تحصيل نقدي رسمي (مبلغ/سند/بيع) في الخط الزمني.
        $viewer = $f['shift_viewer_token'];
        $show = $this->withToken($viewer)->getJson(self::BASE . "/shifts/{$shiftId}")->assertOk();
        $types = collect($show->json('data.events'))->pluck('type');
        $this->assertFalse($types->contains(FuelShiftEvent::TYPE_OFFICIAL_CASH_PAYMENT_RECORDED), 'حدث تحصيل المبيعات ظاهر بلا fuel.sale.view.');
        $this->assertStringNotContainsString((string) $id, $show->getContent(), 'معرّف البيع ظاهر بلا fuel.sale.view.');

        // صاحب fuel.sale.view يرى الحدث كما كان (لا حجب زائد على صاحب الصلاحية).
        $seller = $this->withToken($f['wh_seller_token'])->getJson(self::BASE . "/shifts/{$shiftId}")->assertOk();
        $this->assertTrue(collect($seller->json('data.events'))->pluck('type')->contains(FuelShiftEvent::TYPE_OFFICIAL_CASH_PAYMENT_RECORDED));

        // الحقول المالية القديمة تبقى تشغيلية بحتة (بلا نقد مبيعات): float + حركات الوردية فقط، قبل الإغلاق وبعده.
        $this->withToken($f['owner_token'])->postJson(self::BASE . "/shifts/{$shiftId}/cash-movements", [
            'type' => 'cash_in', 'amount_minor' => 700, 'reason' => 'فكة', 'idempotency_key' => 'd8-cash',
        ])->assertCreated();
        $closed = $this->withToken($f['owner_token'])->postJson(self::BASE . "/shifts/{$shiftId}/close", ['counted_cash_minor' => 1700])
            ->assertOk()->json('data');
        $this->assertSame(1000 + 700, $closed['expected_operational_cash_minor'], 'نقد المبيعات دخل الحقل القديم.');
        $this->assertSame(0, $closed['cash_variance_minor']);
        $viewerShow = $this->withToken($viewer)->getJson(self::BASE . "/shifts/{$shiftId}")->assertOk();
        $this->assertSame(1700, $viewerShow->json('data.expected_operational_cash_minor'));
    }

    /**
     * بوابة #2021 (`FUEL_SHIFT_CASH_RECEIPTS_ENABLED`) تُدخل نقد المبيعات في الحقول القديمة نفسها؛ D8: لا يراه إلا `fuel.sale.view`.
     * البوابة مغلقة افتراضياً (والتغيير لا يحدث قبل دمج #2021)؛ هذا الحارس يمنع أن يفتحها أحد فتتسرّب المبالغ.
     *
     * @test
     */
    public function when_shift_cash_receipts_are_enabled_the_legacy_financial_fields_need_sale_view(): void
    {
        $f = $this->fixture();
        $shiftId = $f['a']['shift']->id;
        $this->withToken($f['owner_token'])->postJson(self::BASE . "/shifts/{$shiftId}/close", ['counted_cash_minor' => 1000])->assertOk();

        $viewer = $f['shift_viewer_token'];
        $hidden = ['expected_operational_cash_minor', 'cash_variance_minor'];
        // البوابة مغلقة (الافتراضي): الحقول القديمة كما هي لصاحب fuel.shift.view.
        $off = $this->withToken($viewer)->getJson(self::BASE . "/shifts/{$shiftId}")->assertOk()->json('data');
        $this->assertSame(1000, $off['expected_operational_cash_minor']);
        $this->assertSame(1000, $off['cash_variance']['expected_operational_cash_minor']);

        config(['fuel_stations.shift_cash_receipts_enabled' => true]);
        $on = $this->withToken($viewer)->getJson(self::BASE . "/shifts/{$shiftId}")->assertOk()->json('data');
        foreach ($hidden as $key) {
            $this->assertNull($on[$key], "{$key} ظاهر بلا fuel.sale.view والبوابة مفتوحة.");
        }
        foreach (['expected_operational_cash_minor', 'variance_minor', 'variance_direction'] as $key) {
            $this->assertNull($on['cash_variance'][$key], "cash_variance.{$key} ظاهر بلا fuel.sale.view والبوابة مفتوحة.");
        }
        $list = $this->withToken($viewer)->getJson(self::BASE . '/shifts')->assertOk()->json('data.0');
        $this->assertNull($list['expected_operational_cash_minor']);

        // صاحب fuel.sale.view يرى القيم نفسها دائماً.
        $with = $this->withToken($f['wh_seller_token'])->getJson(self::BASE . "/shifts/{$shiftId}")->assertOk()->json('data');
        $this->assertSame(1000, $with['expected_operational_cash_minor']);
        $this->assertSame(1000, $with['cash_variance']['expected_operational_cash_minor']);
    }

    // ───────────────────────────── helpers ─────────────────────────────

    /** `withHeaders` يُبقي الترويسة لكل طلبات الاختبار اللاحقة؛ تُصفَّر صراحةً كي لا تتسرّب X-Branch-Id إلى مستخدم آخر. */
    private function resetBranch(array $f): void
    {
        $this->flushHeaders();
        app(BranchContext::class)->set($f['branch_a']->id);
    }

    private function assertServiceRejects(callable $call): void
    {
        $thrown = null;
        try {
            $call();
        } catch (\Throwable $e) {
            $thrown = $e;
        }
        $this->assertInstanceOf(RuntimeException::class, $thrown, 'كان يجب أن يرفض حارس الخدمة فاعلاً خارج النطاق.');
    }

    /** @param class-string<\Illuminate\Database\Eloquent\Model> $model عدّ بلا نطاق فرع/مستأجر: الاختبار يراقب كل ما كُتب. */
    private function n(string $model): int
    {
        return $model::withoutGlobalScopes()->count();
    }

    /** @return array<string,int> */
    private function counts(): array
    {
        return [
            'sales' => $this->n(FuelSale::class), 'invoices' => $this->n(Invoice::class), 'payments' => $this->n(Payment::class),
            'receipts' => $this->n(FuelSalePaymentReceipt::class), 'journals' => JournalEntry::withoutGlobalScopes()->count(),
            'stock' => StockMovement::withoutGlobalScopes()->count(), 'ledger' => $this->n(FuelOperationalLedger::class),
            'shift_events' => $this->n(FuelShiftEvent::class),
        ];
    }

    /** @param array<string,mixed> $slot */
    private function draftPayload(array $slot, string $key): array
    {
        return [
            'fuel_station_id' => $slot['station']->id, 'fuel_nozzle_id' => $slot['nozzle']->id, 'fuel_shift_id' => $slot['shift']->id,
            'partner_id' => $slot['customer']->id, 'quantity_milliliters' => 1000, 'idempotency_key' => $key,
        ];
    }

    /** @param array<string,mixed> $f */
    private function payPayload(array $f, string $key, ?int $amount = null): array
    {
        return ['payment_method_id' => $f['cash_method']->id, 'amount_minor' => $amount ?? 230, 'idempotency_key' => $key];
    }

    /** @param array<string,mixed> $f @return array<string,mixed> */
    private function draftAs(string $token, array $f, string $slot, string $key): array
    {
        return $this->withToken($token)->postJson(self::BASE . '/sales', $this->draftPayload($f[$slot], $key))->assertCreated()->json('data');
    }

    /** @return array<string,mixed> */
    private function fixture(): array
    {
        // مستأجر آخر أولاً (يبقى سياق المستأجر للثاني بعد تسجيله).
        $other = $this->registerTenant('fuel-sale-scope-other', 'owner@fuel-sale-scope-other.test', autoEnableApplications: true);
        app(TenantContext::class)->set($other['tenant_id']);
        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($other['tenant_id']), 'fuel_stations.core', EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL,
            CarbonImmutable::now('UTC'), grantReasonCode: 'test_2016_scope_other', reason: 'مستأجر آخر لاختبار العزل.',
        );

        $auth = $this->registerTenant('fuel-sale-scope', 'owner@fuel-sale-scope.test', autoEnableApplications: true);
        $tenantId = $auth['tenant_id'];
        app(TenantContext::class)->set($tenantId);
        Tenant::findOrFail($tenantId)->update(['country' => 'SA']);
        app(EntitlementGrantService::class)->grant(
            Tenant::findOrFail($tenantId), 'fuel_stations.core', EntitlementAccessMode::FULL, EntitlementSourceType::MANUAL,
            CarbonImmutable::now('UTC'), grantReasonCode: 'test_2016_scope', reason: 'اختبار نطاق مبيعات الوقود.',
        );
        $owner = User::where('tenant_id', $tenantId)->where('role', 'owner')->sole();

        $branchA = Branch::where('is_main', true)->firstOrFail();
        $branchB = Branch::create(['code' => 'BR-B', 'name' => 'فرع ب']);
        $warehouseA = Warehouse::where('is_default', true)->firstOrFail();
        $warehouseA2 = Warehouse::create(['name' => 'مخزن أ2', 'code' => 'WH-A2', 'branch_id' => $branchA->id]);
        $warehouseB = Warehouse::create(['name' => 'مخزن ب', 'code' => 'WH-B', 'branch_id' => $branchB->id]);

        app(BranchContext::class)->set($branchA->id);
        // منتج/عميل بلا فرع: مرئيان في كل الفروع (BranchScoped يُبقي الفرع الفارغ مرئياً).
        $product = Product::create([
            'tenant_id' => $tenantId, 'branch_id' => null, 'sku' => 'FUEL-SALE-SCOPE', 'name' => 'منتج وقود بيع نطاق',
            'unit' => 'mL', 'track_inventory' => true,
        ]);
        $fuel = FuelProduct::create(['tenant_id' => $tenantId, 'product_id' => $product->id, 'code' => 'FUEL-SS', 'name' => 'بنزين بيع نطاق']);
        $customer = Partner::create(['tenant_id' => $tenantId, 'branch_id' => null, 'name' => 'عميل نطاق', 'type' => 'customer']);

        app(CashBankAccountService::class)->bootstrapDefaults();
        $cash = PaymentMethod::where('settlement_type', 'cash')->where('is_active', true)->sole();
        app(FuelStationProductPriceService::class)->create([
            'fuel_station_id' => null, 'fuel_product_id' => $fuel->id, 'price_per_liter_minor' => 230,
            'effective_from' => now()->subHour()->toIso8601String(),
        ], $owner);

        $mk = function (Branch $branch, Warehouse $warehouse, string $code) use ($tenantId, $fuel, $owner, $cash, $customer, $product) {
            app(BranchContext::class)->set($branch->id);
            $station = FuelStation::create([
                'tenant_id' => $tenantId, 'branch_id' => $branch->id, 'warehouse_id' => $warehouse->id, 'code' => 'FS-' . $code, 'name' => 'محطة ' . $code,
            ]);
            $tank = FuelTank::create([
                'tenant_id' => $tenantId, 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_product_id' => $fuel->id,
                'code' => 'T-' . $code, 'name' => 'خزان ' . $code, 'capacity_milliliters' => 1000000, 'safe_capacity_milliliters' => 900000,
            ]);
            $pump = FuelPump::create(['tenant_id' => $tenantId, 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'pump_number' => 'P-' . $code]);
            $nozzle = FuelNozzle::create([
                'tenant_id' => $tenantId, 'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'fuel_pump_id' => $pump->id,
                'fuel_tank_id' => $tank->id, 'fuel_product_id' => $fuel->id, 'nozzle_number' => 'N-' . $code,
            ]);
            app(FuelStationSettingsService::class)->putStationValues($station, [
                'shift_opening_meter_reading_required' => false, 'shift_closing_meter_reading_required' => false,
                'shift_opening_tank_reading_required' => false, 'shift_closing_tank_reading_required' => false,
                'shift_mandatory_staff_assignment' => false, 'shift_supervisor_approval_required' => false,
                'fuel_sales_allowed_payment_method_ids' => [$cash->id], 'fuel_sales_allow_deferred_payment' => true,
            ], $owner, 'تهيئة اختبار نطاق المبيعات');
            app(FuelCostBasisService::class)->assertReady($fuel, $warehouse);
            $movement = app(InventoryService::class)->applyReceipt($product, 10000, 100, [
                'warehouse_id' => $warehouse->id, 'branch_id' => $branch->id, 'source_type' => FuelProduct::class, 'source_id' => $fuel->id,
                InventoryService::FUEL_POOL_META => true,
            ], 1000000);
            app(FuelCostBasisService::class)->recordReceipt($fuel, $warehouse, $movement, 10000, 1000000);
            $shift = FuelShift::create([
                'branch_id' => $branch->id, 'fuel_station_id' => $station->id, 'number' => 'FSH-T-' . $code, 'status' => FuelShift::STATUS_OPEN,
                'opening_float_minor' => 1000, 'idempotency_key' => 'fx-shift-' . $code, 'opened_by' => $owner->id, 'opened_at' => now(),
            ]);

            return compact('station', 'tank', 'pump', 'nozzle', 'warehouse', 'shift', 'customer');
        };
        $a = $mk($branchA, $warehouseA, 'A');
        $a2 = $mk($branchA, $warehouseA2, 'A2');
        $b = $mk($branchB, $warehouseB, 'B');
        app(BranchContext::class)->set($branchA->id);

        // بيع مسودة على محطة الفرع ب أنشأه مالك مباشرة (الاختبار يثبت الإخفاء لا إنشاءه).
        app(BranchContext::class)->set($branchB->id);
        $saleB = FuelSale::create([
            'branch_id' => $branchB->id, 'number' => 'FSL-T-B', 'status' => FuelSale::STATUS_DRAFT, 'fuel_station_id' => $b['station']->id,
            'warehouse_id' => $warehouseB->id, 'fuel_shift_id' => $b['shift']->id, 'fuel_pump_id' => $b['pump']->id, 'fuel_nozzle_id' => $b['nozzle']->id,
            'fuel_tank_id' => $b['tank']->id, 'fuel_product_id' => $fuel->id, 'product_id' => $product->id, 'partner_id' => $customer->id,
            'quantity_milliliters' => 1000, 'payment_status' => FuelSale::PAYMENT_UNPAID, 'paid_minor' => 0, 'idempotency_key' => 'fx-sale-b',
            'created_by' => $owner->id,
        ]);
        app(BranchContext::class)->set($branchA->id);

        $sellerRole = Role::create([
            'tenant_id' => $tenantId, 'slug' => 'fuel-sale-seller', 'name' => 'بائع وقود',
            'permissions' => ['fuel.sale.view', 'fuel.sale.create', 'fuel.sale.finalize', 'fuel.sale.collect', 'fuel.shift.view'], 'is_system' => false,
        ]);
        $priceRole = Role::create([
            'tenant_id' => $tenantId, 'slug' => 'fuel-sale-price-manager', 'name' => 'مدير أسعار وقود',
            'permissions' => ['fuel.sale.view', 'fuel.sale.price.manage'], 'is_system' => false,
        ]);
        $viewerRole = Role::create([
            'tenant_id' => $tenantId, 'slug' => 'fuel-shift-only-viewer', 'name' => 'عارض ورديات فقط',
            'permissions' => ['fuel.shift.view'], 'is_system' => false,
        ]);
        $mkUser = fn (string $name, string $email, Role $role) => User::create([
            'tenant_id' => $tenantId, 'name' => $name, 'email' => $email, 'password' => 'password123', 'role' => $role->slug,
        ]);
        // مقيَّد بمخزن أ فقط (الفرع غير مقيَّد): محطة أ2 من الفرع نفسه خارج نطاقه.
        $whSeller = $mkUser('بائع مخزن أ', 'wh-seller@fuel-sale-scope.test', $sellerRole);
        $whSeller->warehouses()->attach($warehouseA->id);
        $whPrice = $mkUser('مدير أسعار مخزن أ', 'wh-price@fuel-sale-scope.test', $priceRole);
        $whPrice->warehouses()->attach($warehouseA->id);
        $brSeller = $mkUser('بائع فرع أ', 'br-seller@fuel-sale-scope.test', $sellerRole);
        $brSeller->branches()->attach($branchA->id);
        $viewer = $mkUser('عارض ورديات', 'viewer@fuel-sale-scope.test', $viewerRole);

        return [
            'owner' => $owner, 'owner_token' => $auth['token'], 'tenant_id' => $tenantId,
            'wh_seller' => $whSeller, 'wh_seller_token' => $whSeller->createToken('api')->plainTextToken,
            'wh_price_manager_token' => $whPrice->createToken('api')->plainTextToken,
            'br_seller_token' => $brSeller->createToken('api')->plainTextToken,
            'shift_viewer_token' => $viewer->createToken('api')->plainTextToken,
            'other_tenant_token' => $other['token'],
            'branch_a' => $branchA, 'branch_b' => $branchB, 'fuel_product' => $fuel, 'cash_method' => $cash,
            'a' => $a, 'a2' => $a2, 'b' => $b, 'sale_b' => $saleB,
        ];
    }
}
