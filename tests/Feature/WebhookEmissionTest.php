<?php

namespace Tests\Feature;

use App\Models\Branch;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Partner;
use App\Models\Product;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\WebhookDelivery;
use App\Models\WebhookEndpoint;
use App\Models\WebhookEvent;
use App\Services\ApiClientKeyService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * PR-7 (حرِج للدمج): إصدار أحداث الـ Webhooks على مستوى المجال. يثبت حدثًا واحدًا
 * لكلّ إنشاء (طرف/منتج/فاتورة)، وأن إعادة تشغيل idempotent لا تُكرّر الحدث، وأن
 * النوع غير المشترَك والاشتراك المعطَّل لا يُنتجان شيئًا، وأن فشل الـ Webhook لا
 * يكسر إنشاء الأعمال، وأن الفاتورة تبقى مسودّةً بلا أثر محاسبيّ/ZATCA.
 */
class WebhookEmissionTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use InteractsWithWebhooks;

    /**
     * @param  array<int,string>  $eventTypes
     * @param  array<int,string>  $scopes
     * @return array{tenant: Tenant, endpoint: WebhookEndpoint, token: string}
     */
    private function tenantWithSubscription(array $eventTypes, array $scopes = [], string $status = WebhookEndpoint::STATUS_ENABLED): array
    {
        $tenant = Tenant::create(['name' => 'e', 'slug' => 'e-' . Str::random(5)]);
        $endpoint = $this->makeEndpoint($tenant, $eventTypes, status: $status);

        $token = '';
        if ($scopes !== []) {
            $service = app(ApiClientKeyService::class);
            $token = $service->issueKey($service->createClient($tenant, 'x'), 'k', $scopes)->plainTextToken;
        }

        return compact('tenant', 'endpoint', 'token');
    }

    private function inTenant(Tenant $tenant, callable $fn): mixed
    {
        app(TenantContext::class)->set($tenant->id);
        try {
            return $fn();
        } finally {
            app(TenantContext::class)->forget();
        }
    }

    #[Test]
    public function creating_a_partner_emits_exactly_one_event_and_delivery(): void
    {
        $ctx = $this->tenantWithSubscription(['partner.created']);

        $this->inTenant($ctx['tenant'], fn () => Partner::create([
            'code' => 'C1', 'type' => 'customer', 'entity_type' => 'commercial', 'name' => 'عميل', 'is_active' => true,
        ]));

        $this->assertSame(1, WebhookEvent::withoutGlobalScopes()->where('type', 'partner.created')->count());
        $this->assertSame(1, WebhookDelivery::withoutGlobalScopes()->count());
        $event = WebhookEvent::withoutGlobalScopes()->first();
        $this->assertArrayHasKey('name', $event->payload);
        $this->assertSame(WebhookDelivery::STATUS_PENDING, WebhookDelivery::withoutGlobalScopes()->first()->status);
    }

    #[Test]
    public function creating_a_product_emits_one_event(): void
    {
        $ctx = $this->tenantWithSubscription(['product.created']);

        $this->inTenant($ctx['tenant'], fn () => Product::create([
            'sku' => 'S1', 'name' => 'منتج', 'type' => 'good', 'unit' => 'piece', 'sale_price' => 5000, 'tax_rate' => 15, 'is_active' => true,
        ]));

        $this->assertSame(1, WebhookEvent::withoutGlobalScopes()->where('type', 'product.created')->count());
    }

    #[Test]
    public function a_draft_invoice_emits_one_event_with_draft_status_and_no_accounting_or_zatca(): void
    {
        $ctx = $this->tenantWithSubscription(['invoice.created'], ['invoices:write']);
        [$partnerId, $productId] = $this->inTenant($ctx['tenant'], function () use ($ctx) {
            Branch::create(['tenant_id' => $ctx['tenant']->id, 'code' => 'MAIN', 'name' => 'الرئيسي', 'is_main' => true]);
            $p = Partner::create(['code' => 'C1', 'type' => 'customer', 'entity_type' => 'commercial', 'name' => 'عميل', 'is_active' => true]);
            $pr = Product::create(['sku' => 'S1', 'name' => 'منتج', 'type' => 'good', 'unit' => 'piece', 'sale_price' => 10000, 'tax_rate' => 15, 'is_active' => true]);

            return [$p->id, $pr->id];
        });

        $this->withToken($ctx['token'])->postJson('/api/v1/invoices', [
            'partner_id' => $partnerId,
            'items' => [['product_id' => $productId, 'quantity' => 2, 'unit_price_minor' => 10000, 'tax_rate' => 15]],
        ], ['Idempotency-Key' => 'inv-emit-0001'])->assertStatus(201);

        $event = WebhookEvent::withoutGlobalScopes()->where('type', 'invoice.created')->first();
        $this->assertNotNull($event);
        $this->assertSame(1, WebhookEvent::withoutGlobalScopes()->where('type', 'invoice.created')->count());
        $this->assertSame('draft', $event->payload['status']);
        $this->assertArrayNotHasKey('lines', $event->payload); // ملخّص بلا سطور

        // لا أثر محاسبيّ/مخزون/ZATCA من الإصدار.
        $this->assertSame(0, JournalEntry::count());
        $this->assertSame(0, StockMovement::count());
        $invoice = Invoice::withoutGlobalScopes()->firstOrFail();
        $this->assertSame('draft', $invoice->status);
        $this->assertNull($invoice->zatca_qr);
    }

    #[Test]
    public function an_idempotent_replay_does_not_duplicate_the_event(): void
    {
        $ctx = $this->tenantWithSubscription(['partner.created'], ['partners:write']);
        $payload = ['name' => 'عميل', 'type' => 'customer'];

        $a = $this->withToken($ctx['token'])->postJson('/api/v1/partners', $payload, ['Idempotency-Key' => 'p-emit-0001'])->assertStatus(201);
        $b = $this->withToken($ctx['token'])->postJson('/api/v1/partners', $payload, ['Idempotency-Key' => 'p-emit-0001'])
            ->assertStatus(201)->assertHeader('Idempotency-Replayed', 'true');

        $this->assertSame($a->json('data.id'), $b->json('data.id'));
        $this->assertSame(1, Partner::withoutGlobalScopes()->count());
        $this->assertSame(1, WebhookEvent::withoutGlobalScopes()->where('type', 'partner.created')->count());
    }

    #[Test]
    public function a_non_subscribed_event_type_produces_no_event(): void
    {
        $ctx = $this->tenantWithSubscription(['partner.created']); // لا product.created

        $this->inTenant($ctx['tenant'], fn () => Product::create([
            'sku' => 'S1', 'name' => 'منتج', 'type' => 'good', 'unit' => 'piece', 'sale_price' => 5000, 'tax_rate' => 15, 'is_active' => true,
        ]));

        $this->assertSame(0, WebhookEvent::withoutGlobalScopes()->count());
    }

    #[Test]
    public function a_disabled_subscription_receives_nothing(): void
    {
        $ctx = $this->tenantWithSubscription(['partner.created'], status: WebhookEndpoint::STATUS_DISABLED);

        $this->inTenant($ctx['tenant'], fn () => Partner::create([
            'code' => 'C1', 'type' => 'customer', 'entity_type' => 'commercial', 'name' => 'عميل', 'is_active' => true,
        ]));

        $this->assertSame(0, WebhookEvent::withoutGlobalScopes()->count());
        $this->assertSame(0, WebhookDelivery::withoutGlobalScopes()->count());
    }

    #[Test]
    public function creation_writes_the_outbox_but_sends_no_http(): void
    {
        Http::fake(['*' => Http::response('ok', 200)]);
        $ctx = $this->tenantWithSubscription(['partner.created']);

        $this->inTenant($ctx['tenant'], fn () => Partner::create([
            'code' => 'C1', 'type' => 'customer', 'entity_type' => 'commercial', 'name' => 'عميل', 'is_active' => true,
        ]));

        // التسليم أثرٌ جانبيّ لاحق (المُشغّل)، لا داخل الإنشاء — فلا HTTP وقت الإنشاء.
        Http::assertNothingSent();
        $this->assertSame(1, WebhookDelivery::withoutGlobalScopes()->where('status', WebhookDelivery::STATUS_PENDING)->count());
    }

    #[Test]
    public function an_emission_failure_never_breaks_the_business_create(): void
    {
        $ctx = $this->tenantWithSubscription(['partner.created']);
        // يكسر مسار الإصدار (جدول الأحداث مفقود) — يجب أن يبقى إنشاء الطرف ناجحًا.
        // يُسقَط الجدول التابع أولًا: PostgreSQL يفرض تبعيّة الـ FK عند الإسقاط
        // (بخلاف SQLite)، فالترتيب يجعل الاختبار محمولًا على المحرّكين.
        Schema::drop('webhook_deliveries');
        Schema::drop('webhook_events');

        $partner = $this->inTenant($ctx['tenant'], fn () => Partner::create([
            'code' => 'C1', 'type' => 'customer', 'entity_type' => 'commercial', 'name' => 'عميل', 'is_active' => true,
        ]));

        $this->assertNotNull($partner->id);
        $this->assertTrue(Partner::withoutGlobalScopes()->whereKey($partner->id)->exists());
    }
}
