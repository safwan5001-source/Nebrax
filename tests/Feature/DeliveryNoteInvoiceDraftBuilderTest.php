<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\DeliveryNote;
use App\Models\DeliveryNoteEvent;
use App\Models\DeliveryNoteInvoiceAllocation;
use App\Models\DeliveryNoteInvoiceDraftBuild;
use App\Models\DeliveryNoteLineInvoiceLink;
use App\Models\Invoice;
use App\Models\InvoiceLine;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\Product;
use App\Models\PriceList;
use App\Models\Role;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\UnitTemplate;
use App\Models\User;
use App\Models\Warehouse;
use App\Services\Accounting\DeliveryNoteInvoiceConflictException;
use App\Services\Accounting\DeliveryNoteSalesInvoiceDraftBuilder;
use App\Services\Accounting\DeliveryNoteService;
use App\Services\Accounting\InvoiceService;
use App\Services\EntitlementGrantService;
use App\Services\PriceListService;
use App\Support\EntitlementAccessMode;
use App\Support\EntitlementSourceType;
use App\Tenancy\BranchContext;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Carbon;
use LogicException;
use PHPUnit\Framework\Attributes\Test;
use RuntimeException;
use Tests\TestCase;

/**
 * PR-10: تخصيص كامل لعدة سندات تسليم مؤكدة إلى مسودة فاتورة واحدة فقط.
 * يثبت أن الإنشاء لا يرحّل ولا يخصم مخزوناً ولا ينشئ دفعة أو قيداً.
 */
class DeliveryNoteInvoiceDraftBuilderTest extends TestCase
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
    private DeliveryNoteSalesInvoiceDraftBuilder $builder;
    private InvoiceService $invoices;
    private string $token;

    protected function setUp(): void
    {
        parent::setUp();

        $auth = $this->registerTenant('delivery-note-invoice-draft', 'owner@delivery-note-invoice-draft.test');
        $this->token = $auth['token'];
        $this->tenant = Tenant::findOrFail($auth['tenant_id']);
        app(TenantContext::class)->set($this->tenant->id);
        $this->branch = Branch::query()->firstOrFail();
        app(BranchContext::class)->set($this->branch->id);
        $this->grantSalesInvoicing($this->tenant);

        $this->owner = User::query()->where('email', 'owner@delivery-note-invoice-draft.test')->firstOrFail();
        $this->customer = Partner::create(['type' => 'customer', 'name' => 'عميل سندات التسليم', 'is_active' => true]);
        $this->warehouse = Warehouse::create([
            'name' => 'مستودع سندات التسليم', 'code' => 'DN-INV-MAIN', 'branch_id' => $this->branch->id, 'is_active' => true,
        ]);
        $this->product = Product::create([
            'name' => 'منتج تسليم', 'sku' => 'DN-INV-ONE', 'unit' => 'piece', 'sale_price' => 12500, 'tax_rate' => 15, 'is_active' => true,
        ]);
        $this->deliveryNotes = app(DeliveryNoteService::class);
        $this->builder = app(DeliveryNoteSalesInvoiceDraftBuilder::class);
        $this->invoices = app(InvoiceService::class);
    }

    #[Test]
    public function it_builds_one_draft_invoice_from_multiple_confirmed_notes_with_exact_audit_links_and_no_posting_effect(): void
    {
        $first = $this->confirmedNote([['product_id' => $this->product->id, 'quantity' => 2]]);
        $second = $this->confirmedNote([['product_id' => $this->product->id, 'quantity' => 3]]);
        $before = $this->effects();

        $result = $this->builder->build($this->command([$first, $second]));
        $invoice = $result->invoice;

        $this->assertFalse($result->idempotentReplay);
        $this->assertTrue($invoice->isDraft());
        $this->assertSame($this->customer->id, $invoice->partner_id);
        $this->assertSame($this->warehouse->id, $invoice->warehouse_id);
        $this->assertCount(1, $invoice->lines);
        $this->assertSame(5, (int) $invoice->lines->sole()->quantity);
        $this->assertSame(62500, (int) $invoice->subtotal);
        $this->assertSame(9375, (int) $invoice->tax_amount);
        $this->assertSame(71875, (int) $invoice->total);

        $this->assertSame(1, DeliveryNoteInvoiceDraftBuild::count());
        $this->assertSame(2, DeliveryNoteInvoiceAllocation::count());
        $this->assertSame(2, DeliveryNoteLineInvoiceLink::count());
        $this->assertSame(2, $invoice->deliveryNoteAllocations()->count());
        $this->assertSame(2, $invoice->deliveryNoteAllocations()->with('lineLinks')->get()->sum(fn ($allocation) => $allocation->lineLinks->count()));
        $this->assertSame(0, $before['journal_entries']);
        $this->assertSame(0, $before['journal_lines']);
        $this->assertSame(0, $before['payments']);
        $this->assertSame(0, $before['stock_movements']);
        $this->assertSame($before['journal_entries'], JournalEntry::count());
        $this->assertSame($before['journal_lines'], JournalLine::count());
        $this->assertSame($before['payments'], Payment::count());
        $this->assertSame($before['stock_movements'], StockMovement::count());

        foreach ([$first, $second] as $note) {
            $event = DeliveryNoteEvent::query()->where('delivery_note_id', $note->id)
                ->where('event', 'sales_invoice_draft_created')->sole();
            $this->assertSame($invoice->id, $event->metadata['invoice_id']);
            $this->assertSame($invoice->number, $event->metadata['invoice_number']);
        }
    }

    #[Test]
    public function it_preserves_and_aggregates_rational_delivery_quantities_without_float(): void
    {
        $template = UnitTemplate::create(['name' => 'قالب كسر التسليم', 'base_unit' => 'piece']);
        $this->product->update(['unit_template_id' => $template->id]);
        $this->product->refresh();

        $half = $this->confirmedNote([[
            'product_id' => $this->product->id,
            'unit' => 'piece',
            'quantity' => 1,
            'quantity_numerator' => 1,
            'quantity_denominator' => 2,
        ]]);
        $quarter = $this->confirmedNote([[
            'product_id' => $this->product->id,
            'unit' => 'piece',
            'quantity' => 1,
            'quantity_numerator' => 1,
            'quantity_denominator' => 4,
        ]]);

        $result = $this->builder->build($this->command([$half, $quarter], unitPrice: 20000));
        $line = $result->invoice->lines->sole();

        $this->assertSame(1, (int) $line->quantity);
        $this->assertSame(3, (int) $line->quantity_numerator);
        $this->assertSame(4, (int) $line->quantity_denominator);
        $this->assertSame(15000, (int) $line->rounded_gross_minor);
        $this->assertSame(17250, (int) $result->invoice->total);
        $this->assertSame(2, DeliveryNoteLineInvoiceLink::count());
    }

    #[Test]
    public function matching_idempotency_key_and_payload_replays_the_same_invoice_but_changed_payload_conflicts(): void
    {
        $note = $this->confirmedNote([['product_id' => $this->product->id, 'quantity' => 2]]);
        $command = $this->command([$note], idempotencyKey: 'build-replay-0001');

        $first = $this->builder->build($command);
        $second = $this->builder->build($command);

        $this->assertFalse($first->idempotentReplay);
        $this->assertTrue($second->idempotentReplay);
        $this->assertSame($first->invoice->id, $second->invoice->id);
        $this->assertSame(1, Invoice::count());
        $this->assertSame(1, DeliveryNoteInvoiceAllocation::count());
        $this->assertSame(1, DeliveryNoteLineInvoiceLink::count());
        $this->assertSame(1, DeliveryNoteEvent::where('event', 'sales_invoice_draft_created')->count());

        $changed = $command;
        $changed['line_pricing'][0]['unit_price'] = 13000;
        $this->expectException(DeliveryNoteInvoiceConflictException::class);
        $this->builder->build($changed);
    }

    #[Test]
    public function an_omitted_invoice_date_replays_across_a_day_change_but_a_changed_payload_conflicts(): void
    {
        Carbon::setTestNow('2026-08-20 09:00:00');
        try {
            $note = $this->confirmedNote([['product_id' => $this->product->id, 'quantity' => 1]]);
            $command = $this->command([$note], idempotencyKey: 'omitted-date-replay-0001');
            unset($command['invoice_date']);

            $first = $this->builder->build($command);
            $this->assertSame('2026-08-20', $first->invoice->invoice_date->toDateString());

            Carbon::setTestNow('2026-08-21 09:00:00');
            $replay = $this->builder->build($command);
            $this->assertTrue($replay->idempotentReplay);
            $this->assertSame($first->invoice->id, $replay->invoice->id);
            $this->assertSame(1, Invoice::count());

            $changed = $command;
            $changed['reason'] = 'سبب مختلف لا يجوز أن يعيد المسودة الأصلية.';
            $this->expectException(DeliveryNoteInvoiceConflictException::class);
            $this->builder->build($changed);
        } finally {
            Carbon::setTestNow();
        }
    }

    #[Test]
    public function preview_and_build_share_the_source_line_limit_contract_at_499_500_and_501(): void
    {
        foreach ([499, 500] as $lineCount) {
            $notes = $this->confirmedNotesWithSourceLineCount($lineCount);
            $preview = $this->builder->preview(['delivery_note_ids' => array_map(fn (DeliveryNote $note) => $note->id, $notes)]);
            $this->assertTrue($preview['compatible']);
            $this->assertSame($lineCount, $preview['source_line_count']);
            $this->assertSame(DeliveryNoteSalesInvoiceDraftBuilder::MAX_SOURCE_LINES, $preview['source_line_limit']);

            $result = $this->builder->build($this->command($notes, idempotencyKey: "source-line-limit-{$lineCount}"));
            $this->assertFalse($result->idempotentReplay);
        }

        $overflowNotes = $this->confirmedNotesWithSourceLineCount(501);
        $overflowPreview = $this->builder->preview(['delivery_note_ids' => array_map(fn (DeliveryNote $note) => $note->id, $overflowNotes)]);
        $this->assertFalse($overflowPreview['compatible']);
        $this->assertSame(['source_line_limit_exceeded'], $overflowPreview['compatibility_issues']);
        $this->assertSame(501, $overflowPreview['source_line_count']);
        $this->assertSame(DeliveryNoteSalesInvoiceDraftBuilder::MAX_SOURCE_LINES, $overflowPreview['source_line_limit']);

        $this->expectException(RuntimeException::class);
        $this->expectExceptionMessage('أكثر من '.DeliveryNoteSalesInvoiceDraftBuilder::MAX_SOURCE_LINES.' سطر مصدر');
        $this->builder->build($this->command($overflowNotes, idempotencyKey: 'source-line-limit-501'));
    }

    #[Test]
    public function api_replays_a_matching_idempotency_key_after_the_invoice_plan_limit_but_rejects_new_or_changed_requests(): void
    {
        $this->tenant->update(['plan_limits' => ['invoices_per_month' => 1]]);
        $first = $this->confirmedNote([['product_id' => $this->product->id, 'quantity' => 1]]);
        $payload = $this->command([$first], idempotencyKey: 'api-plan-replay-0001');
        unset($payload['actor_id']);

        $created = $this->withToken($this->token)
            ->postJson('/api/delivery-notes/invoice-draft', $payload)
            ->assertCreated()
            ->assertJsonPath('meta.idempotent_replay', false)
            ->json('data.id');

        $this->withToken($this->token)
            ->postJson('/api/delivery-notes/invoice-draft', $payload)
            ->assertOk()
            ->assertJsonPath('data.id', $created)
            ->assertJsonPath('meta.idempotent_replay', true);

        $changed = $payload;
        $changed['reason'] = 'سبب مختلف لا يجوز أن يعيد نفس الطلب.';
        $this->withToken($this->token)
            ->postJson('/api/delivery-notes/invoice-draft', $changed)
            ->assertConflict();

        $second = $this->confirmedNote([['product_id' => $this->product->id, 'quantity' => 1]]);
        $new = $this->command([$second], idempotencyKey: 'api-plan-new-0001');
        unset($new['actor_id']);
        $this->withToken($this->token)
            ->postJson('/api/delivery-notes/invoice-draft', $new)
            ->assertUnprocessable()
            ->assertJsonPath('message', fn (string $message) => str_contains($message, 'حدّ خطتك'));

        $this->assertSame(1, Invoice::count());
    }

    #[Test]
    public function delivery_note_index_projects_linked_and_unlinked_draft_availability_without_extra_requests(): void
    {
        $linked = $this->confirmedNote([['product_id' => $this->product->id, 'quantity' => 1]]);
        $available = $this->confirmedNote([['product_id' => $this->product->id, 'quantity' => 1]]);
        $invoice = $this->builder->build($this->command([$linked], idempotencyKey: 'index-link-0001'))->invoice;

        $rows = $this->withToken($this->token)
            ->getJson('/api/delivery-notes?status=confirmed&per_page=100')
            ->assertOk()
            ->json('data');
        $byId = collect($rows)->keyBy('id');

        $this->assertSame($invoice->id, $byId[$linked->id]['invoice_draft']['invoice_id']);
        $this->assertSame($invoice->number, $byId[$linked->id]['invoice_draft']['number']);
        $this->assertNull($byId[$available->id]['invoice_draft']);
    }

    #[Test]
    public function it_sums_identical_source_line_discounts_when_they_are_aggregated_into_one_invoice_line(): void
    {
        $first = $this->confirmedNote([['product_id' => $this->product->id, 'quantity' => 2]]);
        $second = $this->confirmedNote([['product_id' => $this->product->id, 'quantity' => 3]]);
        $command = $this->command([$first, $second], idempotencyKey: 'aggregate-discounts-0001');
        foreach ($command['line_pricing'] as &$decision) {
            $decision['discount'] = 1000;
        }
        unset($decision);

        $invoice = $this->builder->build($command)->invoice;
        $line = $invoice->lines->sole();

        $this->assertSame(5, (int) $line->quantity);
        $this->assertSame(2000, (int) $line->line_discount);
        $this->assertSame(60500, (int) $invoice->subtotal);
        $this->assertSame(9075, (int) $invoice->tax_amount);
        $this->assertSame(69575, (int) $invoice->total);
    }

    #[Test]
    public function an_explicit_price_list_is_rechecked_server_side_for_every_imported_line(): void
    {
        $priceList = PriceList::create(['name' => 'قائمة تسعير سندات', 'is_active' => true]);
        app(PriceListService::class)->upsertItem($priceList, $this->product, ['unit_name' => null, 'price' => 17500]);
        $note = $this->confirmedNote([['product_id' => $this->product->id, 'quantity' => 1]]);

        $wrong = $this->command([$note], unitPrice: 12500, idempotencyKey: 'listed-price-wrong-0001');
        $wrong['price_list_id'] = $priceList->id;
        try {
            $this->builder->build($wrong);
            $this->fail('قُبل سعر لا يطابق القائمة المحددة.');
        } catch (RuntimeException) {
            $this->addToAssertionCount(1);
        }
        $this->assertSame(0, Invoice::count());

        $right = $this->command([$note], unitPrice: 17500, idempotencyKey: 'listed-price-right-0001');
        $right['price_list_id'] = $priceList->id;
        $invoice = $this->builder->build($right)->invoice;
        $this->assertSame($priceList->id, $invoice->price_list_id);
        $this->assertSame(17500, (int) $invoice->lines->sole()->unit_price);
    }

    #[Test]
    public function an_active_customer_default_price_list_is_used_for_preview_and_rechecked_during_build(): void
    {
        $priceList = PriceList::create(['name' => 'القائمة الافتراضية للعميل', 'is_active' => true]);
        app(PriceListService::class)->upsertItem($priceList, $this->product, ['unit_name' => null, 'price' => 17500]);
        $this->customer->update(['default_price_list_id' => $priceList->id]);
        $note = $this->confirmedNote([['product_id' => $this->product->id, 'quantity' => 1]]);

        $preview = $this->builder->preview(['delivery_note_ids' => [$note->id]]);
        $this->assertSame($priceList->id, $preview['delivery_notes'][0]['lines'][0]['recommended_price_list_id']);
        $this->assertSame(17500, $preview['delivery_notes'][0]['lines'][0]['suggested_unit_price']);

        $wrong = $this->command([$note], unitPrice: 12500, idempotencyKey: 'default-list-wrong-0001');
        try {
            $this->builder->build($wrong);
            $this->fail('قُبل سعر مخالف لقائمة العميل الافتراضية.');
        } catch (RuntimeException) {
            $this->addToAssertionCount(1);
        }

        $right = $this->command([$note], unitPrice: 17500, idempotencyKey: 'default-list-right-0001');
        $invoice = $this->builder->build($right)->invoice;
        $this->assertSame($priceList->id, $invoice->price_list_id);
        $this->assertSame(17500, (int) $invoice->lines->sole()->unit_price);
    }

    #[Test]
    public function it_rejects_drafts_cancelled_or_stale_notes_and_rolls_back_without_an_invoice(): void
    {
        $draft = $this->deliveryNotes->create($this->header(), [['product_id' => $this->product->id, 'quantity' => 1]]);
        $cancelled = $this->confirmedNote([['product_id' => $this->product->id, 'quantity' => 1]]);
        $this->deliveryNotes->cancel($cancelled, $cancelled->version, $this->owner->id, 'إلغاء قبل الفوترة.');
        $confirmed = $this->confirmedNote([['product_id' => $this->product->id, 'quantity' => 1]]);

        foreach ([$draft, $cancelled] as $ineligible) {
            try {
                $this->builder->build($this->command([$ineligible]));
                $this->fail('قُبل سند غير مؤكد أو ملغى لبناء فاتورة.');
            } catch (RuntimeException) {
                $this->addToAssertionCount(1);
            }
        }

        $stale = $this->command([$confirmed]);
        $stale['expected_versions'][$confirmed->id] = 1;
        try {
            $this->builder->build($stale);
            $this->fail('قُبلت نسخة قديمة لسند تسليم.');
        } catch (DeliveryNoteInvoiceConflictException) {
            $this->addToAssertionCount(1);
        }

        $this->assertSame(0, Invoice::count());
        $this->assertSame(0, DeliveryNoteInvoiceAllocation::count());
        $this->assertSame(0, DeliveryNoteLineInvoiceLink::count());
    }

    #[Test]
    public function it_rejects_mixed_customer_or_warehouse_and_reused_delivery_notes(): void
    {
        $first = $this->confirmedNote([['product_id' => $this->product->id, 'quantity' => 1]]);
        $secondCustomer = Partner::create(['type' => 'customer', 'name' => 'عميل مختلف', 'is_active' => true]);
        $mixedCustomer = $this->confirmedNote([['product_id' => $this->product->id, 'quantity' => 1]], ['customer_id' => $secondCustomer->id]);

        try {
            $this->builder->build($this->command([$first, $mixedCustomer]));
            $this->fail('قُبل خليط عملاء في فاتورة واحدة.');
        } catch (RuntimeException) {
            $this->addToAssertionCount(1);
        }

        $result = $this->builder->build($this->command([$first], idempotencyKey: 'reuse-note-0001'));
        $this->assertTrue($result->invoice->isDraft());
        try {
            $this->builder->build($this->command([$first], idempotencyKey: 'reuse-note-0002'));
            $this->fail('قُبلت إعادة فوترة سند تسليم مخصص.');
        } catch (DeliveryNoteInvoiceConflictException) {
            $this->addToAssertionCount(1);
        }
    }

    #[Test]
    public function sourced_draft_and_its_delivery_note_are_protected_from_mutation_deletion_duplication_and_cancellation(): void
    {
        $note = $this->confirmedNote([['product_id' => $this->product->id, 'quantity' => 1]]);
        $invoice = $this->builder->build($this->command([$note]))->invoice;

        foreach (['update', 'delete', 'duplicate', 'cancel'] as $operation) {
            try {
                match ($operation) {
                    'update' => $this->invoices->update($invoice, ['partner_id' => $this->customer->id], [[
                        'product_id' => $this->product->id, 'quantity' => 2, 'unit_price' => 12500, 'tax_rate' => 15,
                    ]]),
                    'delete' => $this->invoices->deleteDraft($invoice),
                    'duplicate' => $this->invoices->duplicate($invoice),
                    'cancel' => $this->deliveryNotes->cancel($note, $note->version, $this->owner->id, 'لا يجوز بعد التخصيص.'),
                };
                $this->fail("قُبل {$operation} لمصدر مرتبط.");
            } catch (RuntimeException) {
                $this->addToAssertionCount(1);
            }
        }

        $line = $invoice->lines->sole();
        $this->expectException(LogicException::class);
        $line->update(['description' => 'تغيير ممنوع']);
    }

    #[Test]
    public function api_requires_the_dedicated_permission_and_write_entitlement_and_returns_a_safe_preview_and_draft(): void
    {
        $note = $this->confirmedNote([['product_id' => $this->product->id, 'quantity' => 2]]);
        $previewPayload = ['delivery_note_ids' => [$note->id]];
        $this->withToken($this->token)
            ->postJson('/api/delivery-notes/invoice-draft/preview', $previewPayload)
            ->assertOk()
            ->assertJsonPath('data.delivery_notes.0.id', $note->id)
            ->assertJsonPath('data.delivery_notes.0.eligible', true)
            ->assertJsonMissingPath('data.delivery_notes.0.journal_entry_id');

        $payload = $this->command([$note], idempotencyKey: 'api-draft-0001');
        $apiPayload = $payload;
        unset($apiPayload['actor_id']);
        $this->withToken($this->token)
            ->postJson('/api/delivery-notes/invoice-draft', $apiPayload + [
                'tenant_id' => $this->tenant->id,
                'actor_id' => $this->owner->id,
                'branch_id' => $this->branch->id,
                'payment_type' => 'cash',
                'total' => 1,
                'journal_entry_id' => '00000000-0000-0000-0000-000000000000',
            ])
            ->assertUnprocessable()
            ->assertJsonValidationErrors(['tenant_id', 'actor_id', 'branch_id', 'payment_type', 'total', 'journal_entry_id']);

        $created = $this->withToken($this->token)
            ->postJson('/api/delivery-notes/invoice-draft', $apiPayload)
            ->assertCreated()
            ->assertJsonPath('meta.idempotent_replay', false)
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonCount(1, 'data.delivery_note_sources')
            ->json('data');

        $this->withToken($this->token)
            ->postJson('/api/delivery-notes/invoice-draft', $apiPayload)
            ->assertOk()
            ->assertJsonPath('data.id', $created['id'])
            ->assertJsonPath('meta.idempotent_replay', true);

        $staffToken = $this->tokenForRole($this->tenant->id, 'staff', 'staff@delivery-note-invoice-draft.test');
        $this->withToken($staffToken)
            ->postJson('/api/delivery-notes/invoice-draft/preview', $previewPayload)
            ->assertForbidden();

        $withoutGrant = $this->registerTenant('delivery-note-invoice-draft-no-grant', 'owner@delivery-note-invoice-draft-no-grant.test');
        $this->withToken($withoutGrant['token'])
            ->postJson('/api/delivery-notes/invoice-draft/preview', $previewPayload)
            ->assertForbidden();
    }

    #[Test]
    public function a_custom_delivery_note_invoicer_can_preview_and_build_without_invoice_view_permission(): void
    {
        $role = Role::create([
            'slug' => 'delivery-note-invoicer',
            'name' => 'مُنشئ مسودات التسليم',
            'permissions' => ['delivery_notes.view', 'delivery_notes.invoice'],
            'is_system' => false,
        ]);
        $user = User::create([
            'tenant_id' => $this->tenant->id,
            'name' => 'مُنشئ مسودات محدود',
            'email' => 'delivery-invoicer@delivery-note-invoice-draft.test',
            'password' => 'password123',
            'role' => $role->slug,
            'is_active' => true,
        ]);
        $token = $user->createToken('api')->plainTextToken;
        $note = $this->confirmedNote([['product_id' => $this->product->id, 'quantity' => 1]]);

        $this->withToken($token)
            ->getJson('/api/delivery-notes?status=confirmed&per_page=100')
            ->assertOk()
            ->assertJsonPath('data.0.id', $note->id);
        $this->withToken($token)
            ->postJson('/api/delivery-notes/invoice-draft/preview', ['delivery_note_ids' => [$note->id]])
            ->assertOk()
            ->assertJsonPath('data.delivery_notes.0.eligible', true);

        $payload = $this->command([$note], idempotencyKey: 'custom-delivery-invoicer-0001');
        unset($payload['actor_id']);
        $this->withToken($token)
            ->postJson('/api/delivery-notes/invoice-draft', $payload)
            ->assertCreated()
            ->assertJsonPath('data.status', 'draft');
    }

    #[Test]
    public function preview_reports_ineligibility_without_writing_and_foreign_tenant_note_is_not_disclosed(): void
    {
        $draft = $this->deliveryNotes->create($this->header(), [['product_id' => $this->product->id, 'quantity' => 1]]);
        $preview = $this->builder->preview(['delivery_note_ids' => [$draft->id]]);
        $this->assertFalse($preview['compatible']);
        $this->assertSame(['not_confirmed'], $preview['delivery_notes'][0]['issues']);
        $this->assertSame(0, Invoice::count());

        $foreign = $this->registerTenant('delivery-note-invoice-draft-foreign', 'owner@delivery-note-invoice-draft-foreign.test');
        app(TenantContext::class)->set($foreign['tenant_id']);
        app(BranchContext::class)->set(Branch::query()->firstOrFail()->id);
        $foreignCustomer = Partner::create(['type' => 'customer', 'name' => 'عميل أجنبي', 'is_active' => true]);
        $foreignWarehouse = Warehouse::create(['name' => 'مستودع أجنبي', 'code' => 'DN-INV-FGN', 'branch_id' => app(BranchContext::class)->id(), 'is_active' => true]);
        $foreignProduct = Product::create(['name' => 'منتج أجنبي', 'sku' => 'DN-INV-FGN', 'unit' => 'piece', 'is_active' => true]);
        $foreignNote = app(DeliveryNoteService::class)->create([
            'customer_id' => $foreignCustomer->id, 'warehouse_id' => $foreignWarehouse->id, 'created_by' => User::query()->firstOrFail()->id,
        ], [['product_id' => $foreignProduct->id, 'quantity' => 1]]);

        app(TenantContext::class)->set($this->tenant->id);
        app(BranchContext::class)->set($this->branch->id);
        $hidden = $this->builder->preview(['delivery_note_ids' => [$foreignNote->id]]);
        $this->assertFalse($hidden['delivery_notes'][0]['eligible']);
        $this->assertSame(['not_available'], $hidden['delivery_notes'][0]['issues']);
    }

    private function confirmedNote(array $items, array $header = []): DeliveryNote
    {
        $note = $this->deliveryNotes->create($this->header($header), $items);

        return $this->deliveryNotes->confirm($note, $note->version, $this->owner->id, 'تم تأكيد التسليم للفوترة.');
    }

    /** @return array<int,DeliveryNote> */
    private function confirmedNotesWithSourceLineCount(int $lineCount): array
    {
        $items = array_fill(0, $lineCount, ['product_id' => $this->product->id, 'quantity' => 1]);

        return array_map(
            fn (array $chunk): DeliveryNote => $this->confirmedNote($chunk),
            array_chunk($items, 200),
        );
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

    /** @param array<int,DeliveryNote> $notes @return array<string,mixed> */
    private function command(array $notes, int $unitPrice = 12500, string $idempotencyKey = 'delivery-note-build-0001'): array
    {
        $pricing = [];
        $versions = [];
        foreach ($notes as $note) {
            $fresh = $note->fresh('lines');
            $versions[$fresh->id] = $fresh->version;
            foreach ($fresh->lines as $line) {
                $pricing[] = [
                    'delivery_note_line_id' => $line->id,
                    'unit_price' => $unitPrice,
                    'tax_rate' => 15,
                    'discount' => 0,
                ];
            }
        }

        return [
            'delivery_note_ids' => array_map(fn (DeliveryNote $note) => $note->id, $notes),
            'expected_versions' => $versions,
            'idempotency_key' => $idempotencyKey,
            'reason' => 'تجميع سندات تسليم مؤكدة في مسودة فاتورة مبيعات.',
            'invoice_date' => '2026-08-21',
            'tax_inclusive' => false,
            'line_pricing' => $pricing,
            'actor_id' => $this->owner->id,
        ];
    }

    /** @return array<string,int> */
    private function effects(): array
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

    private function grantSalesInvoicing(Tenant $tenant): void
    {
        app(EntitlementGrantService::class)->grant(
            $tenant,
            'sales.invoicing',
            EntitlementAccessMode::FULL,
            EntitlementSourceType::LEGACY_GRANDFATHER,
            now()->subMinute(),
            null,
            'delivery-note-invoice-draft-test',
            $tenant->id,
        );
    }
}
