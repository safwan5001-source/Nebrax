<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Product;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Services\ApiClientKeyService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * PR-5 (حرِج للدمج): إنشاء **مسودّة** فاتورة عبر الـ Public API. يثبت:
 * scope الكتابة، مسودّة غير مرحّلة، **لا قيد يومية ولا سطر قيد ولا حركة مخزون/تكلفة
 * ولا إرسال ZATCA**، إجماليات يحسبها الخادم (العميل لا يفرضها)، عزل مراجع المستأجر
 * (عميل/منتج/فرع)، دلالة الفرع الافتراضي، وidempotency.
 * تشغيل: php artisan test --filter=PublicApiInvoiceWriteTest
 */
class PublicApiInvoiceWriteTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private const URI = '/api/v1/invoices';

    private function service(): ApiClientKeyService
    {
        return app(ApiClientKeyService::class);
    }

    /** @return array{tenant: Tenant, token: string, partner: Partner, product: Product} */
    private function seedInvoiceContext(string $slug = 'acme', array $scopes = ['invoices:write']): array
    {
        $tenant = Tenant::create(['name' => $slug, 'slug' => $slug . '-' . Str::random(6)]);
        app(TenantContext::class)->set($tenant->id);
        $partner = Partner::create([
            'code' => 'C-' . Str::random(5), 'type' => 'customer', 'entity_type' => 'commercial',
            'name' => "عميل {$slug}", 'is_active' => true,
        ]);
        $product = Product::create([
            'sku' => 'SKU-' . Str::random(6), 'name' => "منتج {$slug}", 'type' => 'good',
            'unit' => 'piece', 'sale_price' => 10000, 'tax_rate' => 15, 'is_active' => true,
        ]);
        app(TenantContext::class)->forget();

        $token = $this->service()->issueKey($this->service()->createClient($tenant, 'x'), 'k', $scopes)->plainTextToken;

        return compact('tenant', 'token', 'partner', 'product');
    }

    private function payload(array $s, array $overrides = []): array
    {
        return array_merge([
            'partner_id' => $s['partner']->id,
            'items'      => [[
                'product_id'       => $s['product']->id,
                'quantity'         => 2,
                'unit_price_minor' => 10000,
                'tax_rate'         => 15,
            ]],
        ], $overrides);
    }

    private function idem(string $key = 'invoice-key-1'): array
    {
        return ['Idempotency-Key' => $key];
    }

    // ── scope ─────────────────────────────────────────────────────────

    /** @test */
    public function read_scope_alone_cannot_create(): void
    {
        $s = $this->seedInvoiceContext('a', ['invoices:read']);
        $this->withToken($s['token'])->postJson(self::URI, $this->payload($s), $this->idem())
            ->assertStatus(403)->assertJsonPath('error.code', 'insufficient_scope');
        $this->assertSame(0, Invoice::count());
    }

    // ── draft + accounting/ZATCA safety ───────────────────────────────

    /** @test */
    public function it_creates_an_unposted_draft_with_no_accounting_or_zatca_side_effects(): void
    {
        $s = $this->seedInvoiceContext();

        $res = $this->withToken($s['token'])->postJson(self::URI, $this->payload($s), $this->idem())
            ->assertStatus(201)
            ->assertJsonPath('data.status', 'draft')
            ->assertJsonPath('data.type', 'sale');

        $invoice = Invoice::withoutGlobalScopes()->firstOrFail();
        $this->assertSame('draft', $invoice->status);

        // لا أثر محاسبي: لا قيد ولا سطر قيد ولا حركة مخزون/تكلفة.
        $this->assertSame(0, JournalEntry::count(), 'لا قيد يومية لمسودّة');
        $this->assertSame(0, JournalLine::count(), 'لا سطر قيد لمسودّة');
        $this->assertSame(0, StockMovement::count(), 'لا حركة مخزون/تكلفة لمسودّة');

        // لا إرسال/بناء ZATCA لمسودّة.
        $this->assertNull($invoice->zatca_qr);
        $this->assertNull($invoice->zatca_hash);
        $this->assertNull($invoice->zatca_uuid);

        // معرّف الطلب في العقد.
        $this->assertNotEmpty($res->json('meta.request_id'));
    }

    /** @test */
    public function totals_are_computed_by_the_server(): void
    {
        $s = $this->seedInvoiceContext();
        // سطر: 2 × 10000 = 20000 صافي، ضريبة 15% = 3000، الإجمالي 23000.
        // العميل يرسل بنودًا فقط — لا حقل إجمالي في العقد يقبله الخادم.
        $this->withToken($s['token'])->postJson(self::URI, $this->payload($s, [
            'subtotal' => 999999, 'tax_amount' => 999999, 'total' => 999999, // تُسقَط
        ]), $this->idem())
            ->assertStatus(201)
            ->assertJsonPath('data.subtotal_minor', 20000)
            ->assertJsonPath('data.tax_minor', 3000)
            ->assertJsonPath('data.total_minor', 23000);
    }

    // ── tenant isolation of references ────────────────────────────────

    /** @test */
    public function a_cross_tenant_partner_is_rejected_without_revealing_existence(): void
    {
        $s = $this->seedInvoiceContext('a');
        $other = $this->seedInvoiceContext('b');

        $this->withToken($s['token'])->postJson(self::URI, $this->payload($s, ['partner_id' => $other['partner']->id]), $this->idem())
            ->assertStatus(422)->assertJsonPath('error.code', 'validation_failed');
        $this->assertSame(0, Invoice::count());
    }

    /** @test */
    public function a_cross_tenant_product_is_rejected(): void
    {
        $s = $this->seedInvoiceContext('a');
        $other = $this->seedInvoiceContext('b');

        $payload = $this->payload($s);
        $payload['items'][0]['product_id'] = $other['product']->id;

        $this->withToken($s['token'])->postJson(self::URI, $payload, $this->idem())
            ->assertStatus(422)->assertJsonPath('error.code', 'validation_failed');
        $this->assertSame(0, Invoice::count());
    }

    // ── branch semantics (§14) ────────────────────────────────────────

    /** @test */
    public function it_defaults_to_the_tenant_main_branch(): void
    {
        $s = $this->seedInvoiceContext();
        app(TenantContext::class)->set($s['tenant']->id);
        $main = Branch::create(['tenant_id' => $s['tenant']->id, 'code' => 'MAIN', 'name' => 'الرئيسي', 'is_main' => true]);
        app(TenantContext::class)->forget();

        $res = $this->withToken($s['token'])->postJson(self::URI, $this->payload($s), $this->idem())->assertStatus(201);

        $invoice = Invoice::withoutGlobalScopes()->findOrFail($res->json('data.id'));
        $this->assertSame($main->id, $invoice->branch_id);
    }

    /** @test */
    public function a_cross_tenant_branch_is_rejected(): void
    {
        $s = $this->seedInvoiceContext('a');
        $other = $this->seedInvoiceContext('b');
        app(TenantContext::class)->set($other['tenant']->id);
        $foreignBranch = Branch::create(['tenant_id' => $other['tenant']->id, 'code' => 'X', 'name' => 'أجنبي', 'is_main' => true]);
        app(TenantContext::class)->forget();

        $this->withToken($s['token'])->postJson(self::URI, $this->payload($s, ['branch_id' => $foreignBranch->id]), $this->idem())
            ->assertStatus(422)->assertJsonPath('error.code', 'validation_failed');
        $this->assertSame(0, Invoice::count());
    }

    // ── validation ────────────────────────────────────────────────────

    /** @test */
    public function invalid_quantity_is_rejected(): void
    {
        $s = $this->seedInvoiceContext();
        $this->withToken($s['token'])->postJson(self::URI, $this->payload($s, [
            'items' => [['product_id' => $s['product']->id, 'quantity' => 0, 'unit_price_minor' => 10000]],
        ]), $this->idem())->assertStatus(422)->assertJsonPath('error.code', 'validation_failed');
    }

    /** @test */
    public function an_empty_items_list_is_rejected(): void
    {
        $s = $this->seedInvoiceContext();
        $this->withToken($s['token'])->postJson(self::URI, ['partner_id' => $s['partner']->id, 'items' => []], $this->idem())
            ->assertStatus(422)->assertJsonPath('error.code', 'validation_failed');
    }

    // ── idempotency ───────────────────────────────────────────────────

    /** @test */
    public function missing_idempotency_key_is_rejected(): void
    {
        $s = $this->seedInvoiceContext();
        $this->withToken($s['token'])->postJson(self::URI, $this->payload($s))
            ->assertStatus(400)->assertJsonPath('error.code', 'idempotency_key_required');
        $this->assertSame(0, Invoice::count());
    }

    /** @test */
    public function a_duplicate_request_returns_the_same_invoice(): void
    {
        $s = $this->seedInvoiceContext();
        $payload = $this->payload($s);

        $a = $this->withToken($s['token'])->postJson(self::URI, $payload, $this->idem('inv-replay'))->assertStatus(201);
        $b = $this->withToken($s['token'])->postJson(self::URI, $payload, $this->idem('inv-replay'))
            ->assertStatus(201)->assertHeader('Idempotency-Replayed', 'true');

        $this->assertSame($a->json('data.id'), $b->json('data.id'));
        $this->assertSame(1, Invoice::count());
    }

    /** @test */
    public function same_key_changed_payload_conflicts(): void
    {
        $s = $this->seedInvoiceContext();
        $this->withToken($s['token'])->postJson(self::URI, $this->payload($s), $this->idem('inv-conflict'))->assertStatus(201);
        $this->withToken($s['token'])->postJson(self::URI, $this->payload($s, [
            'items' => [['product_id' => $s['product']->id, 'quantity' => 5, 'unit_price_minor' => 10000, 'tax_rate' => 15]],
        ]), $this->idem('inv-conflict'))->assertStatus(409)->assertJsonPath('error.code', 'idempotency_conflict');
        $this->assertSame(1, Invoice::count());
    }
}
