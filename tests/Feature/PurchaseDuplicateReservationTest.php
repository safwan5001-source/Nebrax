<?php

namespace Tests\Feature;

use App\Models\ImportDocumentReservation;
use App\Models\Purchase;
use App\Services\Accounting\PurchaseService;
use App\Services\DocumentDuplicateReservationService as Dup;
use App\Support\DuplicateDocumentException;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * IMP-H5-S3a — ربط حجز هوية فاتورة المورّد (مورّد ‖ رقم فاتورته المطبَّع) بخدمة المشتريات: الإنشاء/التعديل/الحذف، وسياسة
 * `purchases.duplicate_reference_policy` (allow الافتراضي = السلوك القديم حرفياً). لا قيد ولا مخزون: المسودات فقط.
 */
class PurchaseDuplicateReservationTest extends TestCase
{
    use CapturesThrowable;
    use InteractsWithApi;
    use RefreshDatabase;

    private array $auth;

    private string $supplierId;

    private string $productId;

    private int $seq = 0;

    protected function setUp(): void
    {
        parent::setUp();
        $this->auth = $this->registerTenant();
        app(TenantContext::class)->set($this->auth['tenant_id']);
        $this->supplierId = $this->withToken($this->auth['token'])->postJson('/api/partners', ['name' => 'مورّد', 'type' => 'supplier'])->assertCreated()['data']['id'];
        $this->productId = $this->withToken($this->auth['token'])->postJson('/api/products', [
            'name' => 'إسمنت', 'sku' => 'S-'.uniqid(), 'type' => 'good', 'sale_price' => 2000, 'purchase_price' => 1000, 'track_inventory' => true,
        ])->assertCreated()['data']['id'];
    }

    private function items(): array
    {
        return [['product_id' => $this->productId, 'quantity' => 10, 'unit_price' => 1000, 'tax_rate' => 0]];
    }

    private function body(array $over = []): array
    {
        return $over + ['partner_id' => $this->supplierId, 'payment_type' => 'credit', 'items' => $this->items()];
    }

    private function postPurchase(array $over = []): \Illuminate\Testing\TestResponse
    {
        return $this->withToken($this->auth['token'])->postJson('/api/purchases', $this->body($over));
    }

    private function policy(string $value): void
    {
        $this->withToken($this->auth['token'])->putJson('/api/purchase-settings', ['duplicate_reference_policy' => $value])->assertOk();
    }

    private function service(): PurchaseService
    {
        return app(PurchaseService::class);
    }

    /** إنشاء كما يفعل المستورد: رقم صريح لأن الترقيم تابع لسياق الفرع الذي يخلطه الاختبار مع طلبات API. */
    private function import(string $reference, array $over = [], string $source = Dup::SOURCE_STANDARD): Purchase
    {
        return $this->service()->create(['partner_id' => $this->supplierId, 'payment_type' => 'credit', 'number' => 'BILL-T-'.(++$this->seq), 'supplier_invoice_no' => $reference] + $over, $this->items(), ['source' => $source]);
    }

    private function reservations(): int
    {
        return ImportDocumentReservation::query()->count();
    }

    private function otherSupplier(): string
    {
        return $this->withToken($this->auth['token'])->postJson('/api/partners', ['name' => 'مورّد آخر', 'type' => 'supplier'])->assertCreated()['data']['id'];
    }

    /** @test */
    public function the_policy_defaults_to_allow_and_rejects_unknown_values(): void
    {
        $this->withToken($this->auth['token'])->getJson('/api/purchase-settings')->assertOk()->assertJsonPath('data.duplicate_reference_policy', 'allow');
        $this->withToken($this->auth['token'])->putJson('/api/purchase-settings', ['duplicate_reference_policy' => 'warn'])->assertUnprocessable();
        $this->policy('block');
        $this->withToken($this->auth['token'])->getJson('/api/purchase-settings')->assertJsonPath('data.duplicate_reference_policy', 'block');
    }

    /** @test */
    public function under_allow_direct_creation_is_unchanged_and_reserves_nothing(): void
    {
        $this->postPurchase(['supplier_invoice_no' => 'S-1'])->assertCreated();
        $this->postPurchase(['supplier_invoice_no' => 'S-1'])->assertCreated();

        $this->assertSame(2, Purchase::query()->count());
        $this->assertSame(0, $this->reservations());
    }

    /** @test */
    public function under_block_a_second_direct_purchase_with_the_same_supplier_reference_is_refused(): void
    {
        $this->policy('block');
        $first = $this->postPurchase(['supplier_invoice_no' => 'INV/55'])->assertCreated()->json('data.id');

        $res = $this->postPurchase(['supplier_invoice_no' => 'inv 55'])->assertUnprocessable()->assertJsonPath('reason', 'duplicate_document');
        $this->assertStringContainsString('مستند بالهوية نفسها', (string) $res->json('message'));
        // رقم آخر أو مورّد آخر يمرّان
        $this->postPurchase(['supplier_invoice_no' => 'INV/56'])->assertCreated();
        $this->postPurchase(['supplier_invoice_no' => 'INV/55', 'partner_id' => $this->otherSupplier()])->assertCreated();

        $this->assertSame(3, Purchase::query()->count());
        $row = ImportDocumentReservation::query()->where('document_id', $first)->firstOrFail();
        $this->assertSame(Dup::SOURCE_MANUAL, $row->source);
        $this->assertSame('purchase', $row->domain);
        $this->assertSame(3, $this->reservations());
    }

    /** @test */
    public function under_block_a_purchase_without_a_supplier_reference_is_never_blocked_or_reserved(): void
    {
        $this->policy('block');
        $this->postPurchase()->assertCreated();
        $this->postPurchase()->assertCreated();
        $this->postPurchase(['supplier_invoice_no' => '---'])->assertCreated();   // رموز فقط: لا هوية بعد التطبيع

        $this->assertSame(3, Purchase::query()->count());
        $this->assertSame(0, $this->reservations());
    }

    /** @test */
    public function under_block_it_also_refuses_a_legacy_unreserved_duplicate(): void
    {
        $this->postPurchase(['supplier_invoice_no' => 'L-1'])->assertCreated();   // allow: بلا حجز
        $this->assertSame(0, $this->reservations());

        $this->policy('block');
        $this->postPurchase(['supplier_invoice_no' => 'l1'])->assertUnprocessable();
        $this->assertSame(1, Purchase::query()->count());
    }

    /** @test */
    public function an_import_reserves_under_allow_and_refuses_a_duplicate_of_a_reserved_or_existing_invoice(): void
    {
        $a = $this->import('INV-77');
        $this->assertSame(1, $this->reservations());
        $this->assertSame('inv77', ImportDocumentReservation::query()->firstOrFail()->predicate['reference']);

        $e = $this->thrown(fn () => $this->import('inv 77', [], Dup::SOURCE_AI_ACTION), 'مكرر', DuplicateDocumentException::class);
        $this->assertSame($a->id, $e->existingId);

        // فاتورة يدوية سابقة (بلا حجز) تمنع الاستيراد أيضاً
        $manual = $this->postPurchase(['supplier_invoice_no' => 'M-9'])->assertCreated()->json('data.id');
        $e2 = $this->thrown(fn () => $this->import('M9'), 'مكرر', DuplicateDocumentException::class);
        $this->assertSame($manual, $e2->existingId);
        $this->assertSame(1, $this->reservations());
    }

    /** @test */
    public function an_import_without_a_supplier_reference_is_refused(): void
    {
        $this->thrown(fn () => $this->service()->create(['partner_id' => $this->supplierId, 'number' => 'BILL-T-0'], $this->items(), ['source' => Dup::SOURCE_STANDARD]), 'رقم فاتورة المورّد', \RuntimeException::class);
        $this->thrown(fn () => $this->service()->create(['partner_id' => $this->supplierId, 'number' => 'BILL-T-0', 'supplier_invoice_no' => '###'], $this->items(), ['source' => Dup::SOURCE_STANDARD]), 'رقم فاتورة المورّد', \RuntimeException::class);
        $this->assertSame(0, Purchase::query()->count());
    }

    /** @test */
    public function a_failed_import_leaves_no_purchase_lines_or_reservation(): void
    {
        $this->import('F-1');
        $before = [Purchase::query()->count(), \App\Models\PurchaseLine::query()->count(), $this->reservations()];

        $this->thrown(fn () => $this->import('F-1'), 'مكرر', DuplicateDocumentException::class);

        $this->assertSame($before, [Purchase::query()->count(), \App\Models\PurchaseLine::query()->count(), $this->reservations()]);
    }

    /** @test */
    public function editing_the_reference_of_a_reserved_draft_rekeys_it_and_frees_the_old_identity(): void
    {
        $a = $this->import('OLD-1');

        $this->withToken($this->auth['token'])->putJson("/api/purchases/{$a->id}", $this->body(['supplier_invoice_no' => 'NEW-1']))->assertOk();

        $this->assertSame('new1', ImportDocumentReservation::query()->firstOrFail()->predicate['reference']);
        $this->import('OLD-1');   // الهوية القديمة حرّة
        $this->thrown(fn () => $this->import('NEW-1'), 'مكرر', DuplicateDocumentException::class);
    }

    /** @test */
    public function changing_the_supplier_of_a_reserved_draft_rekeys_and_records_the_new_counterparty(): void
    {
        $a = $this->import('SUP-1');
        $other = $this->otherSupplier();

        $this->withToken($this->auth['token'])->putJson("/api/purchases/{$a->id}", $this->body(['partner_id' => $other, 'supplier_invoice_no' => 'SUP-1']))->assertOk();

        $row = ImportDocumentReservation::query()->firstOrFail();
        $this->assertSame($other, $row->counterparty_id);
        $this->assertSame($other, $row->predicate['supplier']);
        $this->import('SUP-1');   // المورّد الأول حرّ
    }

    /** @test */
    public function editing_into_a_taken_identity_is_422_and_changes_nothing(): void
    {
        $a = $this->import('A-1');
        $this->import('B-1');

        $this->withToken($this->auth['token'])->putJson("/api/purchases/{$a->id}", $this->body(['supplier_invoice_no' => 'B-1', 'notes' => 'تغيير']))->assertUnprocessable();

        $this->assertSame('A-1', $a->fresh()->supplier_invoice_no);
        $this->assertNull($a->fresh()->notes);
        $this->assertSame('a1', ImportDocumentReservation::query()->where('document_id', $a->id)->firstOrFail()->predicate['reference']);
        $this->assertSame(1, $a->fresh()->lines()->count());
    }

    /** @test */
    public function editing_a_reserved_draft_into_the_reference_of_an_unreserved_legacy_purchase_is_refused(): void
    {
        $this->postPurchase(['supplier_invoice_no' => 'LEG-1'])->assertCreated();
        $b = $this->import('B-2');

        $this->withToken($this->auth['token'])->putJson("/api/purchases/{$b->id}", $this->body(['supplier_invoice_no' => 'LEG-1']))->assertUnprocessable();

        $this->assertSame('B-2', $b->fresh()->supplier_invoice_no);
        $this->assertSame('b2', ImportDocumentReservation::query()->where('document_id', $b->id)->firstOrFail()->predicate['reference']);
    }

    /** @test */
    public function an_edit_that_keeps_the_identity_is_not_refused_by_itself(): void
    {
        $a = $this->import('K-1');
        $this->withToken($this->auth['token'])->putJson("/api/purchases/{$a->id}", $this->body(['supplier_invoice_no' => 'k 1', 'notes' => 'تحديث']))->assertOk();
        $this->assertSame(1, $this->reservations());
    }

    /** @test */
    public function clearing_the_reference_of_a_reserved_draft_releases_its_reservation(): void
    {
        $a = $this->import('C-1');

        $this->withToken($this->auth['token'])->putJson("/api/purchases/{$a->id}", $this->body(['supplier_invoice_no' => null]))->assertOk();

        $this->assertSame(0, $this->reservations());
        $this->import('C-1');
    }

    /** @test */
    public function editing_an_unreserved_manual_purchase_never_creates_a_reservation_under_allow(): void
    {
        $id = $this->postPurchase(['supplier_invoice_no' => 'U-1'])->assertCreated()->json('data.id');
        $this->withToken($this->auth['token'])->putJson("/api/purchases/{$id}", $this->body(['supplier_invoice_no' => 'U-2']))->assertOk();
        $this->assertSame(0, $this->reservations());
    }

    /** @test */
    public function under_block_editing_an_unreserved_draft_into_a_taken_identity_is_refused_but_an_unchanged_legacy_duplicate_can_still_be_edited(): void
    {
        $this->postPurchase(['supplier_invoice_no' => 'D-1'])->assertCreated();
        $y = $this->postPurchase(['supplier_invoice_no' => 'D-1'])->assertCreated()->json('data.id');   // مكرَّر قديم تحت allow
        $z = $this->postPurchase(['supplier_invoice_no' => 'D-2'])->assertCreated()->json('data.id');
        $this->policy('block');

        // الهوية لم تتغيّر ⇒ تعديل ملاحظة مسودة قديمة مكرَّرة لا يُحجب ولا يحجز
        $this->withToken($this->auth['token'])->putJson("/api/purchases/{$y}", $this->body(['supplier_invoice_no' => 'D-1', 'notes' => 'x']))->assertOk();
        $this->assertSame(0, $this->reservations());

        // تغيّرت إلى هوية قائمة ⇒ مرفوض؛ إلى هوية حرة ⇒ يمرّ ويحجز
        $this->withToken($this->auth['token'])->putJson("/api/purchases/{$z}", $this->body(['supplier_invoice_no' => 'D-1']))->assertUnprocessable();
        $this->withToken($this->auth['token'])->putJson("/api/purchases/{$z}", $this->body(['supplier_invoice_no' => 'D-3']))->assertOk();
        $this->assertSame(1, $this->reservations());
    }

    /** @test */
    public function deleting_a_draft_releases_its_reservation_so_a_corrected_reimport_succeeds(): void
    {
        $a = $this->import('X-1');

        $this->withToken($this->auth['token'])->deleteJson("/api/purchases/{$a->id}")->assertOk();

        $this->assertSame(0, $this->reservations());
        $this->import('X-1');
        $this->assertSame(1, $this->reservations());
    }

    /** @test */
    public function a_posted_purchase_keeps_its_reservation_and_cannot_be_deleted_or_reimported(): void
    {
        $a = $this->import('P-1');
        $this->withToken($this->auth['token'])->postJson("/api/purchases/{$a->id}/post")->assertOk();

        $this->withToken($this->auth['token'])->deleteJson("/api/purchases/{$a->id}")->assertUnprocessable();

        $this->assertSame(1, $this->reservations());
        $this->thrown(fn () => $this->import('P-1'), 'مكرر', DuplicateDocumentException::class);
    }

    /** @test */
    public function the_copy_action_never_inherits_the_supplier_number_so_it_never_collides_or_reserves(): void
    {
        $this->policy('block');
        $a = $this->import('CP-1');   // محجوزة
        $res = $this->withToken($this->auth['token'])->postJson("/api/purchases/{$a->id}/duplicate")->assertCreated();

        $this->assertNull($res->json('data.supplier_invoice_no'));
        $this->assertSame(1, $this->reservations());
        $this->assertSame(2, Purchase::query()->count());
    }

    /** @test */
    public function a_held_draft_keeps_its_identity_protection_after_the_policy_returns_to_allow(): void
    {
        $this->policy('block');
        $a = $this->postPurchase(['supplier_invoice_no' => 'H-1'])->assertCreated()->json('data.id');
        $this->postPurchase(['supplier_invoice_no' => 'H-2'])->assertCreated();
        $this->policy('allow');

        // المستند المحجوز يحتفظ بحجزه؛ تعديله إلى هوية قائمة مرفوض حتى تحت allow (السلوك المعلن لا يُسقط الحجز بتبدّل السياسة)
        $this->withToken($this->auth['token'])->putJson("/api/purchases/{$a}", $this->body(['supplier_invoice_no' => 'H-2']))->assertUnprocessable();
        // ومستند غير محجوز تحت allow يتصرف كالقديم تماماً
        $free = $this->postPurchase(['supplier_invoice_no' => 'H-3'])->assertCreated()->json('data.id');
        $this->withToken($this->auth['token'])->putJson("/api/purchases/{$free}", $this->body(['supplier_invoice_no' => 'H-2']))->assertOk();
    }

    /** @test */
    public function the_same_supplier_number_in_another_tenant_is_not_a_duplicate(): void
    {
        $this->policy('block');
        $this->postPurchase(['supplier_invoice_no' => 'T-1'])->assertCreated();

        $other = $this->registerTenant('beta-co', 'owner@beta.test');
        $supplier = $this->withToken($other['token'])->postJson('/api/partners', ['name' => 'مورّد', 'type' => 'supplier'])->assertCreated()['data']['id'];
        $product = $this->withToken($other['token'])->postJson('/api/products', ['name' => 'س', 'sku' => 'B-'.uniqid(), 'type' => 'good', 'sale_price' => 2000, 'purchase_price' => 1000, 'track_inventory' => true])->assertCreated()['data']['id'];
        $this->withToken($other['token'])->putJson('/api/purchase-settings', ['duplicate_reference_policy' => 'block'])->assertOk();
        $body = ['partner_id' => $supplier, 'payment_type' => 'credit', 'supplier_invoice_no' => 'T-1', 'items' => [['product_id' => $product, 'quantity' => 1, 'unit_price' => 1000, 'tax_rate' => 0]]];

        $this->withToken($other['token'])->postJson('/api/purchases', $body)->assertCreated();
        $this->withToken($other['token'])->postJson('/api/purchases', $body)->assertUnprocessable();
    }

    /** @test */
    public function an_uppercase_supplier_id_in_an_edit_is_not_treated_as_a_supplier_change(): void
    {
        $this->policy('block');
        $a = $this->postPurchase(['supplier_invoice_no' => 'U-9'])->assertCreated()->json('data.id');
        $this->postPurchase(['supplier_invoice_no' => 'U-9', 'partner_id' => $this->otherSupplier()])->assertCreated();

        // نفس المورّد بحروف كبيرة والرقم نفسه: لا هوية جديدة ⇒ لا فحص ذاتي ولا تعارض
        $this->withToken($this->auth['token'])->putJson("/api/purchases/{$a}", $this->body(['partner_id' => strtoupper($this->supplierId), 'supplier_invoice_no' => 'U-9', 'notes' => 'ok']))->assertOk();
    }

    /** @test */
    public function posting_an_imported_draft_produces_the_same_entry_shape_as_a_manual_one(): void
    {
        $imported = $this->import('E-1');
        $manual = $this->service()->create(['partner_id' => $this->supplierId, 'payment_type' => 'credit', 'number' => 'BILL-T-M', 'supplier_invoice_no' => 'E-2'], $this->items());

        $this->withToken($this->auth['token'])->postJson("/api/purchases/{$imported->id}/post")->assertOk();
        $this->withToken($this->auth['token'])->postJson("/api/purchases/{$manual->id}/post")->assertOk();

        $shape = fn (Purchase $p) => $p->fresh()->journalEntry->lines->map(fn ($l) => [$l->account->code, (int) $l->debit, (int) $l->credit])->sortBy(0)->values()->all();
        $this->assertSame($shape($manual), $shape($imported));
    }
}
