<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\DeliveryNote;
use App\Models\DeliveryNoteEvent;
use App\Models\Invoice;
use App\Models\InvoiceLine;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\Product;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\User;
use App\Models\UnitTemplate;
use App\Models\Warehouse;
use App\Services\Accounting\DeliveryNoteService;
use App\Services\EntitlementGrantService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use LogicException;
use PHPUnit\Framework\Attributes\Test;
use RuntimeException;
use Tests\TestCase;

/**
 * سند التسليم دليل تشغيلي فقط: الاختبارات تقفل حدوده قبل أن يصبح مصدراً لفاتورة
 * في PR-10. لا يحق له أبداً خلق فاتورة أو حركة مخزون أو قيد أو دفعة.
 */
class DeliveryNoteTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private Tenant $tenant;
    private Branch $branch;
    private User $owner;
    private Partner $customer;
    private Warehouse $warehouse;
    private Product $product;
    private DeliveryNoteService $deliveryNotes;
    private string $token;

    protected function setUp(): void
    {
        parent::setUp();

        $auth = $this->registerTenant('delivery-notes', 'owner@delivery-notes.test');
        $this->token = $auth['token'];
        $this->tenant = Tenant::findOrFail($auth['tenant_id']);
        app(TenantContext::class)->set($this->tenant->id);
        $this->branch = Branch::query()->firstOrFail();
        app(BranchContext::class)->set($this->branch->id);
        $this->grantSalesInvoicing($this->tenant);

        $this->owner = User::query()->where('email', 'owner@delivery-notes.test')->firstOrFail();
        [$this->customer, $this->warehouse, $this->product] = $this->createMasterData();
        $this->deliveryNotes = app(DeliveryNoteService::class);
    }

    #[Test]
    public function creating_confirming_and_cancelling_a_delivery_note_only_write_operational_evidence(): void
    {
        $before = $this->sideEffects();
        $note = $this->note();

        $this->assertSame(DeliveryNote::STATUS_DRAFT, $note->status);
        $this->assertSame(1, $note->version);
        $this->assertSame($this->branch->id, $note->branch_id);
        $this->assertSame($this->tenant->id, $note->tenant_id);
        $this->assertCount(1, $note->lines);
        $this->assertSame('إسمنت', $note->lines->first()->product_name_snapshot);
        $this->assertSame(1, $note->events->count());
        $this->assertSame('created', $note->events->first()->event);
        $this->assertNoFinancialOrInventoryEffects($before);

        $confirmed = $this->deliveryNotes->confirm($note, 1, $this->owner->id, 'تم التسليم للعميل.');
        $this->assertSame(DeliveryNote::STATUS_CONFIRMED, $confirmed->status);
        $this->assertSame(2, $confirmed->version);
        $this->assertSame($this->owner->id, $confirmed->confirmed_by);
        $this->assertNotNull($confirmed->confirmed_at);
        $this->assertSame(['created', 'confirmed'], $confirmed->events->pluck('event')->all());
        $this->assertNoFinancialOrInventoryEffects($before);

        $cancelled = $this->deliveryNotes->cancel($confirmed, 2, $this->owner->id, 'عاد العميل عن الاستلام.');
        $this->assertSame(DeliveryNote::STATUS_CANCELLED, $cancelled->status);
        $this->assertSame(3, $cancelled->version);
        $this->assertSame('عاد العميل عن الاستلام.', $cancelled->cancellation_reason);
        $this->assertSame(['created', 'confirmed', 'cancelled'], $cancelled->events->pluck('event')->all());
        $this->assertNoFinancialOrInventoryEffects($before);
    }

    #[Test]
    public function drafts_are_updated_under_an_expected_version_and_confirm_is_never_replayed(): void
    {
        $note = $this->note();
        $updated = $this->deliveryNotes->update($note, [
            'customer_id' => $this->customer->id,
            'warehouse_id' => $this->warehouse->id,
            'delivery_date' => '2026-08-20',
            'external_reference' => 'DO-42',
            'notes' => 'تم تعديل المسودة.',
            'actor_id' => $this->owner->id,
        ], [[
            'product_id' => $this->product->id,
            'quantity' => 7,
            'description' => 'كمية معدلة',
        ]], 1);

        $this->assertSame(2, $updated->version);
        $this->assertSame('DO-42', $updated->external_reference);
        $this->assertSame(7, $updated->lines->sole()->quantity);
        $this->assertSame(['created', 'updated'], $updated->events->pluck('event')->all());

        try {
            $this->deliveryNotes->confirm($updated, 1, $this->owner->id);
            $this->fail('يجب رفض النسخة القديمة.');
        } catch (RuntimeException $exception) {
            $this->assertStringContainsString('مستخدم آخر', $exception->getMessage());
        }

        $confirmed = $this->deliveryNotes->confirm($updated, 2, $this->owner->id);
        $this->assertCount(3, $confirmed->events);
        try {
            $this->deliveryNotes->confirm($confirmed, 3, $this->owner->id);
            $this->fail('يجب رفض إعادة التأكيد ولا يجوز تكرار حدث التأكيد.');
        } catch (RuntimeException $exception) {
            $this->assertStringContainsString('غير مسودة', $exception->getMessage());
        }
        $this->assertSame(3, DeliveryNote::findOrFail($note->id)->events()->count());
    }

    #[Test]
    public function exact_fractional_quantity_is_preserved_as_a_rational_value_without_float(): void
    {
        $template = UnitTemplate::create(['name' => 'قالب القطعة', 'base_unit' => 'piece']);
        $this->product->update(['unit_template_id' => $template->id]);
        $this->product->refresh();

        $note = $this->deliveryNotes->create($this->header(), [[
            'product_id' => $this->product->id,
            'unit' => 'piece',
            'quantity' => 1,
            'quantity_numerator' => 3,
            'quantity_denominator' => 4,
        ]]);
        $line = $note->lines->sole();

        $this->assertSame(1, $line->quantity);
        $this->assertSame(3, $line->quantity_numerator);
        $this->assertSame(4, $line->quantity_denominator);

        $this->expectException(RuntimeException::class);
        $this->deliveryNotes->create($this->header(), [[
            'product_id' => $this->product->id,
            'quantity' => 2,
            'quantity_numerator' => 3,
            'quantity_denominator' => 4,
        ]]);
    }

    #[Test]
    public function service_rejects_ineligible_customer_warehouse_product_and_unit(): void
    {
        $supplier = Partner::create(['type' => 'supplier', 'name' => 'مورد فقط', 'is_active' => true]);
        $inactive = Product::create(['name' => 'منتج موقوف', 'sku' => 'OFF-1', 'unit' => 'piece', 'is_active' => false]);
        $otherBranch = Branch::create(['name' => 'فرع آخر', 'code' => 'DEL-OTHER']);
        $otherWarehouse = Warehouse::create([
            'name' => 'مخزن الفرع الآخر', 'code' => 'DN-OTHER', 'branch_id' => $otherBranch->id, 'is_active' => true,
        ]);

        foreach ([
            [$supplier->id, $this->warehouse->id, $this->product->id, null],
            [$this->customer->id, $otherWarehouse->id, $this->product->id, null],
            [$this->customer->id, $this->warehouse->id, $inactive->id, null],
            [$this->customer->id, $this->warehouse->id, $this->product->id, 'unknown-unit'],
        ] as [$customerId, $warehouseId, $productId, $unit]) {
            try {
                $this->deliveryNotes->create($this->header([
                    'customer_id' => $customerId,
                    'warehouse_id' => $warehouseId,
                ]), [[
                    'product_id' => $productId,
                    'quantity' => 1,
                    'unit' => $unit,
                ]]);
                $this->fail('مرجع غير صالح قُبل في سند التسليم.');
            } catch (RuntimeException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    #[Test]
    public function service_rejects_inactive_customer_warehouse_empty_lines_and_invalid_quantities(): void
    {
        $inactiveCustomer = Partner::create(['type' => 'both', 'name' => 'عميل موقوف', 'is_active' => false]);
        $inactiveWarehouse = Warehouse::create([
            'name' => 'مستودع موقوف', 'code' => 'DN-OFF', 'branch_id' => $this->branch->id, 'is_active' => false,
        ]);

        $cases = [
            [$this->header(['customer_id' => $inactiveCustomer->id]), [['product_id' => $this->product->id, 'quantity' => 1]]],
            [$this->header(['warehouse_id' => $inactiveWarehouse->id]), [['product_id' => $this->product->id, 'quantity' => 1]]],
            [$this->header(), []],
            [$this->header(), [['product_id' => $this->product->id, 'quantity' => 0]]],
            [$this->header(), [['product_id' => $this->product->id, 'quantity' => -1]]],
            [$this->header(), [['product_id' => $this->product->id, 'quantity' => 1000001]]],
        ];
        foreach ($cases as [$header, $items]) {
            try {
                $this->deliveryNotes->create($header, $items);
                $this->fail('قيمة مجال غير صالحة قُبلت في سند التسليم.');
            } catch (RuntimeException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    #[Test]
    public function references_from_another_tenant_are_not_visible_to_the_service(): void
    {
        $foreign = $this->registerTenant('delivery-notes-foreign', 'owner@delivery-notes-foreign.test');
        app(TenantContext::class)->set($foreign['tenant_id']);
        $foreignBranch = Branch::query()->firstOrFail();
        app(BranchContext::class)->set($foreignBranch->id);
        [$foreignCustomer, $foreignWarehouse, $foreignProduct] = $this->createMasterData('أجنبي');

        app(TenantContext::class)->set($this->tenant->id);
        app(BranchContext::class)->set($this->branch->id);
        foreach ([
            [$foreignCustomer->id, $this->warehouse->id, $this->product->id],
            [$this->customer->id, $foreignWarehouse->id, $this->product->id],
            [$this->customer->id, $this->warehouse->id, $foreignProduct->id],
        ] as [$customerId, $warehouseId, $productId]) {
            try {
                $this->deliveryNotes->create($this->header([
                    'customer_id' => $customerId,
                    'warehouse_id' => $warehouseId,
                ]), [['product_id' => $productId, 'quantity' => 1]]);
                $this->fail('مرجع مستأجر آخر قُبل في سند التسليم.');
            } catch (RuntimeException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    #[Test]
    public function lifecycle_fields_and_events_cannot_be_mutated_or_deleted_directly(): void
    {
        $note = $this->note();
        try {
            $note->update(['status' => DeliveryNote::STATUS_CONFIRMED]);
            $this->fail('تعديل الحالة المباشر يجب أن يرفض.');
        } catch (LogicException) {
            $this->addToAssertionCount(1);
        }
        try {
            $note->update(['version' => 99]);
            $this->fail('تعديل النسخة المباشر يجب أن يرفض.');
        } catch (LogicException) {
            $this->addToAssertionCount(1);
        }

        $event = $note->events->sole();
        try {
            DeliveryNoteEvent::create([
                'delivery_note_id' => $note->id,
                'event' => 'injected',
                'from_status' => DeliveryNote::STATUS_DRAFT,
                'to_status' => DeliveryNote::STATUS_DRAFT,
                'occurred_at' => now(),
            ]);
            $this->fail('حدث التدقيق لا يضاف خارج الخدمة.');
        } catch (LogicException) {
            $this->addToAssertionCount(1);
        }
        try {
            $event->update(['reason' => 'تغيير غير مسموح']);
            $this->fail('حدث التدقيق لا يعدّل.');
        } catch (LogicException) {
            $this->addToAssertionCount(1);
        }
        $this->expectException(LogicException::class);
        $event->delete();
    }

    #[Test]
    public function notes_and_their_numbers_are_isolated_by_branch(): void
    {
        $first = $this->note();
        $this->assertStringContainsString('DN-' . now()->format('Y') . '-00001', $first->number);

        $other = Branch::create(['name' => 'فرع الخبر', 'code' => 'DN-KHB']);
        app(BranchContext::class)->set($other->id);
        [$customer, $warehouse, $product] = $this->createMasterData('الخبر');
        $second = $this->deliveryNotes->create([
            'customer_id' => $customer->id,
            'warehouse_id' => $warehouse->id,
            'delivery_date' => '2026-08-20',
            'created_by' => $this->owner->id,
        ], [['product_id' => $product->id, 'quantity' => 1]]);

        $this->assertStringContainsString('DN-' . now()->format('Y') . '-00001', $second->number);
        $this->assertNull(DeliveryNote::find($first->id));
        app(BranchContext::class)->set($this->branch->id);
        $this->assertNull(DeliveryNote::find($second->id));
        $this->assertNotNull(DeliveryNote::find($first->id));
    }

    #[Test]
    public function delivery_note_prefix_from_the_central_numbering_catalog_reaches_created_notes(): void
    {
        $this->withToken($this->token)
            ->putJson('/api/numbering-settings', [
                'entity' => 'delivery_note',
                'series_key' => 'default',
                'prefix' => 'SLIP',
            ])
            ->assertOk()
            ->assertJsonPath('data.prefix', 'SLIP');

        $note = $this->note();
        $this->assertSame('SLIP-' . now()->year . '-00001', $note->number);
    }

    #[Test]
    public function api_rejects_spoofed_workflow_fields_and_separates_rbac_from_entitlement(): void
    {
        $payload = $this->apiPayload();
        $this->withToken($this->token)->postJson('/api/delivery-notes', $payload + ['status' => 'confirmed'])
            ->assertUnprocessable();

        $staffToken = $this->tokenForRole($this->tenant->id, 'staff', 'staff@delivery-notes.test');
        $this->withToken($staffToken)->getJson('/api/delivery-notes')->assertOk();
        $this->withToken($staffToken)->postJson('/api/delivery-notes', $payload)->assertForbidden();

        $withoutGrant = $this->registerTenant('delivery-notes-no-grant', 'owner@delivery-notes-no-grant.test');
        $this->withToken($withoutGrant['token'])->getJson('/api/delivery-notes')->assertForbidden();
    }

    #[Test]
    public function api_executes_the_full_lifecycle_and_exposes_only_operational_fields(): void
    {
        $created = $this->withToken($this->token)
            ->postJson('/api/delivery-notes', $this->apiPayload() + ['external_reference' => 'CLIENT-DN-1'])
            ->assertCreated()
            ->assertJsonPath('data.status', DeliveryNote::STATUS_DRAFT)
            ->json('data');

        $updatedPayload = array_replace($this->apiPayload(), [
            'expected_version' => $created['version'],
            'notes' => 'تم تعديلها عبر API.',
            'items' => [['product_id' => $this->product->id, 'quantity' => 8]],
        ]);
        $updated = $this->withToken($this->token)
            ->putJson("/api/delivery-notes/{$created['id']}", $updatedPayload)
            ->assertOk()
            ->assertJsonPath('data.version', 2)
            ->assertJsonPath('data.lines.0.quantity', 8)
            ->json('data');

        $confirmed = $this->withToken($this->token)
            ->postJson("/api/delivery-notes/{$created['id']}/confirm", ['expected_version' => $updated['version']])
            ->assertOk()
            ->assertJsonPath('data.status', DeliveryNote::STATUS_CONFIRMED)
            ->json('data');

        $this->withToken($this->token)
            ->putJson("/api/delivery-notes/{$created['id']}", array_replace($this->apiPayload(), [
                'expected_version' => $confirmed['version'],
            ]))
            ->assertUnprocessable();
        $this->withToken($this->token)
            ->postJson("/api/delivery-notes/{$created['id']}/cancel", [
                'expected_version' => $confirmed['version'],
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors('reason');

        $this->withToken($this->token)
            ->postJson("/api/delivery-notes/{$created['id']}/cancel", [
                'expected_version' => $confirmed['version'],
                'reason' => 'إلغاء اختباري من API.',
            ])
            ->assertOk()
            ->assertJsonPath('data.status', DeliveryNote::STATUS_CANCELLED)
            ->assertJsonMissingPath('data.invoice_id')
            ->assertJsonMissingPath('data.stock_movement_id')
            ->assertJsonMissingPath('data.journal_entry_id');

        $this->withToken($this->token)
            ->getJson('/api/delivery-notes?status=cancelled&search=' . urlencode($created['number']))
            ->assertOk()
            ->assertJsonCount(1, 'data')
            ->assertJsonPath('data.0.id', $created['id']);
        $this->withToken($this->token)
            ->getJson("/api/delivery-notes/{$created['id']}")
            ->assertOk()
            ->assertJsonCount(4, 'data.events');
    }

    /** @return array{0:Partner,1:Warehouse,2:Product} */
    private function createMasterData(string $suffix = ''): array
    {
        $customer = Partner::create([
            'type' => 'customer', 'name' => 'عميل ' . $suffix, 'is_active' => true,
        ]);
        $warehouse = Warehouse::create([
            'name' => 'المستودع ' . $suffix, 'code' => 'DN-' . ($suffix === '' ? 'MAIN' : 'BR'),
            'branch_id' => app(BranchContext::class)->id(), 'is_active' => true,
        ]);
        $product = Product::create([
            'name' => 'إسمنت' . $suffix, 'sku' => 'CEMENT-' . ($suffix === '' ? 'MAIN' : 'BR'),
            'unit' => 'piece', 'is_active' => true,
        ]);

        return [$customer, $warehouse, $product];
    }

    private function note(): DeliveryNote
    {
        return $this->deliveryNotes->create($this->header(), [[
            'product_id' => $this->product->id,
            'quantity' => 5,
            'description' => 'تسليم اختباري',
        ]]);
    }

    /** @param array<string,mixed> $override @return array<string,mixed> */
    private function header(array $override = []): array
    {
        return $override + [
            'customer_id' => $this->customer->id,
            'warehouse_id' => $this->warehouse->id,
            'delivery_date' => '2026-08-20',
            'created_by' => $this->owner->id,
        ];
    }

    /** @return array<string,mixed> */
    private function apiPayload(): array
    {
        return [
            'customer_id' => $this->customer->id,
            'warehouse_id' => $this->warehouse->id,
            'delivery_date' => '2026-08-20',
            'items' => [['product_id' => $this->product->id, 'quantity' => 3]],
        ];
    }

    /** @return array<string,int> */
    private function sideEffects(): array
    {
        return [
            'invoices' => Invoice::count(),
            'invoice_lines' => InvoiceLine::count(),
            'journal_entries' => JournalEntry::count(),
            'journal_lines' => JournalLine::count(),
            'payments' => Payment::count(),
            'stock_movements' => StockMovement::count(),
        ];
    }

    /** @param array<string,int> $before */
    private function assertNoFinancialOrInventoryEffects(array $before): void
    {
        $this->assertSame($before, $this->sideEffects());
    }

    private function grantSalesInvoicing(Tenant $tenant): void
    {
        app(EntitlementGrantService::class)->grant(
            $tenant,
            'sales.invoicing',
            EntitlementAccessMode::FULL,
            EntitlementSourceType::LEGACY_GRANDFATHER,
            now()->subMinute(),
            null,
            'delivery-note-test',
            $tenant->id,
        );
    }
}
