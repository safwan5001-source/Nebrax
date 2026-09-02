<?php

namespace Tests\Feature;

use App\Models\Tenant;
use App\Models\WebhookDelivery;
use App\Models\WebhookEndpoint;
use App\Models\WebhookEvent;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * PR-7: تقليم سجلّات الـ Webhooks (`webhooks:prune`). يثبت حذف التسليمات المُنجَزة/
 * الفاشلة القديمة والأحداث اليتيمة القديمة، مع الاحتفاظ بالحديث والنشط، و`--dry-run`.
 */
class WebhookRetentionTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithWebhooks;

    private Tenant $tenant;
    private WebhookEndpoint $endpoint;

    protected function setUp(): void
    {
        parent::setUp();
        $this->tenant = Tenant::create(['name' => 'r', 'slug' => 'r-' . Str::random(5)]);
        $this->endpoint = $this->makeEndpoint($this->tenant, ['partner.created']);
    }

    private function event(int $ageDays = 0): WebhookEvent
    {
        $e = WebhookEvent::query()->create([
            'tenant_id' => $this->tenant->id, 'type' => 'partner.created', 'api_version' => 'v1',
            'source_type' => 'App\\Models\\Partner', 'source_id' => (string) Str::uuid(),
            'payload' => ['id' => 'p'], 'occurred_at' => now(),
        ]);
        if ($ageDays > 0) {
            $e->forceFill(['created_at' => now()->subDays($ageDays)])->save();
        }

        return $e;
    }

    private function delivery(WebhookEvent $event, string $status, ?int $ageDays = null): WebhookDelivery
    {
        $attrs = [
            'tenant_id' => $this->tenant->id, 'webhook_event_id' => $event->id, 'webhook_endpoint_id' => $this->endpoint->id,
            'status' => $status, 'attempts' => 1,
        ];
        if ($status === WebhookDelivery::STATUS_DELIVERED) {
            $attrs['delivered_at'] = $ageDays !== null ? now()->subDays($ageDays) : now();
        } elseif ($status === WebhookDelivery::STATUS_FAILED) {
            $attrs['failed_at'] = $ageDays !== null ? now()->subDays($ageDays) : now();
        } else {
            $attrs['next_attempt_at'] = now();
        }

        return WebhookDelivery::query()->create($attrs);
    }

    #[Test]
    public function it_prunes_old_delivered_and_failed_and_retains_recent_and_active(): void
    {
        $oldDelivered = $this->delivery($this->event(40), WebhookDelivery::STATUS_DELIVERED, 40);
        $oldFailed = $this->delivery($this->event(40), WebhookDelivery::STATUS_FAILED, 40);
        $recentDelivered = $this->delivery($this->event(1), WebhookDelivery::STATUS_DELIVERED, 1);
        $pending = $this->delivery($this->event(90), WebhookDelivery::STATUS_PENDING);

        $this->artisan('webhooks:prune')->assertSuccessful();

        $this->assertNull(WebhookDelivery::withoutGlobalScopes()->find($oldDelivered->id));
        $this->assertNull(WebhookDelivery::withoutGlobalScopes()->find($oldFailed->id));
        $this->assertNotNull(WebhookDelivery::withoutGlobalScopes()->find($recentDelivered->id));
        $this->assertNotNull(WebhookDelivery::withoutGlobalScopes()->find($pending->id), 'التسليم النشط لا يُحذف');
    }

    #[Test]
    public function it_prunes_orphan_events_but_keeps_events_with_deliveries(): void
    {
        $orphan = $this->event(60);                        // بلا تسليمات، قديم
        $withDelivery = $this->event(60);
        $this->delivery($withDelivery, WebhookDelivery::STATUS_PENDING);

        $this->artisan('webhooks:prune')->assertSuccessful();

        $this->assertNull(WebhookEvent::withoutGlobalScopes()->find($orphan->id));
        $this->assertNotNull(WebhookEvent::withoutGlobalScopes()->find($withDelivery->id));
    }

    #[Test]
    public function dry_run_counts_without_deleting(): void
    {
        $old = $this->delivery($this->event(40), WebhookDelivery::STATUS_DELIVERED, 40);

        $this->artisan('webhooks:prune --dry-run')->assertSuccessful();

        $this->assertNotNull(WebhookDelivery::withoutGlobalScopes()->find($old->id), 'dry-run لا يحذف');
    }

    #[Test]
    public function it_never_deletes_the_subscription(): void
    {
        $this->delivery($this->event(90), WebhookDelivery::STATUS_DELIVERED, 90);

        $this->artisan('webhooks:prune')->assertSuccessful();

        $this->assertNotNull(WebhookEndpoint::withoutGlobalScopes()->find($this->endpoint->id));
    }
}
