<?php

namespace Tests\Feature;

use App\Models\WebhookEndpoint;
use Illuminate\Foundation\Testing\RefreshDatabase;
use PHPUnit\Framework\Attributes\Test;
use Tests\TestCase;

/**
 * PR-7 (حرِج للدمج): إدارة اشتراكات الـ Webhooks عبر الـ Public API. يثبت المصادقة
 * والـ scopes وعزل المستأجر المغلق، وإظهار السرّ **مرّة واحدة**، وتحقّق العنوان
 * (SSRF) والأحداث، وidempotency، وعدم كشف اشتراكات مستأجر آخر.
 */
class WebhookSubscriptionApiTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use InteractsWithWebhooks;

    private const URI = '/api/v1/webhooks';

    protected function setUp(): void
    {
        parent::setUp();
        // مُحلِّل حتميّ: أسماء المضيفين → IP عموميّ، والعناوين الحرفيّة كما هي.
        $this->bindWebhookValidator();
    }

    private function idem(string $key = 'wh-key-00001'): array
    {
        return ['Idempotency-Key' => $key];
    }

    private function createPayload(array $overrides = []): array
    {
        return array_merge([
            'url'         => 'https://hook.example.com/receive',
            'event_types' => ['invoice.created', 'partner.created'],
            'description' => 'Billing integration',
        ], $overrides);
    }

    // ── auth + scope ──────────────────────────────────────────────────

    #[Test]
    public function it_requires_authentication(): void
    {
        $this->postJson(self::URI, $this->createPayload(), $this->idem())->assertStatus(401);
    }

    #[Test]
    public function creating_requires_the_write_scope(): void
    {
        $ctx = $this->webhookTenant('a', ['webhooks:read']);
        $this->withToken($ctx['token'])->postJson(self::URI, $this->createPayload(), $this->idem())
            ->assertStatus(403)->assertJsonPath('error.code', 'insufficient_scope');
        $this->assertSame(0, WebhookEndpoint::withoutGlobalScopes()->count());
    }

    #[Test]
    public function listing_requires_the_read_scope(): void
    {
        $ctx = $this->webhookTenant('a', ['webhooks:write']);
        $this->withToken($ctx['token'])->getJson(self::URI)
            ->assertStatus(403)->assertJsonPath('error.code', 'insufficient_scope');
    }

    // ── create + secret once ──────────────────────────────────────────

    #[Test]
    public function it_creates_a_subscription_and_returns_the_secret_exactly_once(): void
    {
        $ctx = $this->webhookTenant();

        $res = $this->withToken($ctx['token'])->postJson(self::URI, $this->createPayload(), $this->idem())
            ->assertStatus(201)
            ->assertJsonPath('data.status', 'enabled')
            ->assertJsonPath('data.url', 'https://hook.example.com/receive');

        $secret = $res->json('data.secret');
        $this->assertIsString($secret);
        $this->assertStringStartsWith('whsec_', $secret);
        $this->assertNotEmpty($res->json('data.secret_prefix'));
        $id = $res->json('data.id');

        // القراءة اللاحقة لا تُعيد السرّ الخام أبدًا.
        $show = $this->withToken($ctx['token'])->getJson(self::URI . '/' . $id)->assertOk();
        $this->assertArrayNotHasKey('secret', $show->json('data'));
        $this->assertNotEmpty($show->json('data.secret_prefix'));

        // مخزَّن مشفَّرًا لا خامًا.
        $stored = WebhookEndpoint::withoutGlobalScopes()->find($id);
        $this->assertNotSame($secret, $stored->getRawOriginal('secret'));
        $this->assertSame($secret, $stored->secret);
    }

    #[Test]
    public function the_body_cannot_inject_a_foreign_tenant(): void
    {
        $ctx = $this->webhookTenant('a');
        $other = $this->webhookTenant('b');

        $res = $this->withToken($ctx['token'])->postJson(self::URI, $this->createPayload([
            'tenant_id' => $other['tenant']->id, // يُتجاهَل بنيويًّا
        ]), $this->idem())->assertStatus(201);

        $stored = WebhookEndpoint::withoutGlobalScopes()->find($res->json('data.id'));
        $this->assertSame($ctx['tenant']->id, $stored->tenant_id);
    }

    // ── validation ────────────────────────────────────────────────────

    #[Test]
    public function an_unknown_event_type_is_rejected(): void
    {
        $ctx = $this->webhookTenant();
        $this->withToken($ctx['token'])->postJson(self::URI, $this->createPayload(['event_types' => ['invoice.posted']]), $this->idem())
            ->assertStatus(422)->assertJsonPath('error.code', 'validation_failed');
    }

    #[Test]
    public function a_private_url_is_rejected_by_ssrf_validation(): void
    {
        $ctx = $this->webhookTenant();
        $this->withToken($ctx['token'])->postJson(self::URI, $this->createPayload(['url' => 'https://10.0.0.5/x']), $this->idem())
            ->assertStatus(422)->assertJsonPath('error.code', 'validation_failed');
        $this->withToken($ctx['token'])->postJson(self::URI, $this->createPayload(['url' => 'http://hook.example.com/x']), $this->idem('wh-key-00002'))
            ->assertStatus(422);
        $this->assertSame(0, WebhookEndpoint::withoutGlobalScopes()->count());
    }

    // ── update / disable / delete ─────────────────────────────────────

    #[Test]
    public function it_updates_disables_and_deletes_a_subscription(): void
    {
        $ctx = $this->webhookTenant();
        $id = $this->withToken($ctx['token'])->postJson(self::URI, $this->createPayload(), $this->idem())->json('data.id');

        // disable
        $this->withToken($ctx['token'])->patchJson(self::URI . '/' . $id, ['status' => 'disabled'])
            ->assertOk()->assertJsonPath('data.status', 'disabled');
        $this->assertNotNull(WebhookEndpoint::withoutGlobalScopes()->find($id)->disabled_at);

        // update event types
        $this->withToken($ctx['token'])->patchJson(self::URI . '/' . $id, ['event_types' => ['product.created']])
            ->assertOk()->assertJsonPath('data.event_types.0', 'product.created');

        // delete
        $this->withToken($ctx['token'])->deleteJson(self::URI . '/' . $id)->assertOk()->assertJsonPath('data.deleted', true);
        $this->assertNull(WebhookEndpoint::withoutGlobalScopes()->find($id));
    }

    #[Test]
    public function updating_the_url_revalidates_ssrf(): void
    {
        $ctx = $this->webhookTenant();
        $id = $this->withToken($ctx['token'])->postJson(self::URI, $this->createPayload(), $this->idem())->json('data.id');

        $this->withToken($ctx['token'])->patchJson(self::URI . '/' . $id, ['url' => 'https://127.0.0.1/x'])
            ->assertStatus(422)->assertJsonPath('error.code', 'validation_failed');
    }

    // ── rotate secret ─────────────────────────────────────────────────

    #[Test]
    public function it_rotates_the_secret_returning_a_new_one_once(): void
    {
        $ctx = $this->webhookTenant();
        $create = $this->withToken($ctx['token'])->postJson(self::URI, $this->createPayload(), $this->idem());
        $id = $create->json('data.id');
        $old = $create->json('data.secret');

        $rotated = $this->withToken($ctx['token'])->postJson(self::URI . "/{$id}/rotate-secret", [], $this->idem('wh-rotate-0001'))
            ->assertOk();
        $new = $rotated->json('data.secret');

        $this->assertIsString($new);
        $this->assertNotSame($old, $new);
        $this->assertSame($new, WebhookEndpoint::withoutGlobalScopes()->find($id)->secret);
    }

    // ── tenant isolation ──────────────────────────────────────────────

    #[Test]
    public function a_tenant_cannot_read_update_or_delete_another_tenants_subscription(): void
    {
        $a = $this->webhookTenant('a');
        $b = $this->webhookTenant('b');
        $bId = $this->withToken($b['token'])->postJson(self::URI, $this->createPayload(), $this->idem('b-key-00001'))->json('data.id');

        $this->withToken($a['token'])->getJson(self::URI . '/' . $bId)->assertStatus(404);
        $this->withToken($a['token'])->patchJson(self::URI . '/' . $bId, ['status' => 'disabled'])->assertStatus(404);
        $this->withToken($a['token'])->deleteJson(self::URI . '/' . $bId)->assertStatus(404);
        $this->withToken($a['token'])->postJson(self::URI . "/{$bId}/rotate-secret", [], $this->idem('a-rot-00001'))->assertStatus(404);

        // ما زال قائمًا لصاحبه.
        $this->assertNotNull(WebhookEndpoint::withoutGlobalScopes()->find($bId));
    }

    #[Test]
    public function listing_is_scoped_to_the_callers_tenant(): void
    {
        $a = $this->webhookTenant('a');
        $b = $this->webhookTenant('b');
        $this->withToken($a['token'])->postJson(self::URI, $this->createPayload(), $this->idem('a-key-00001'))->assertStatus(201);
        $this->withToken($b['token'])->postJson(self::URI, $this->createPayload(), $this->idem('b-key-00002'))->assertStatus(201);

        $list = $this->withToken($a['token'])->getJson(self::URI)->assertOk();
        $this->assertSame(1, $list->json('meta.pagination.total'));
    }

    // ── idempotency ───────────────────────────────────────────────────

    #[Test]
    public function creating_requires_an_idempotency_key_and_replays_duplicates(): void
    {
        $ctx = $this->webhookTenant();

        $this->withToken($ctx['token'])->postJson(self::URI, $this->createPayload())
            ->assertStatus(400)->assertJsonPath('error.code', 'idempotency_key_required');

        $a = $this->withToken($ctx['token'])->postJson(self::URI, $this->createPayload(), $this->idem('wh-dupe-0001'))->assertStatus(201);
        $b = $this->withToken($ctx['token'])->postJson(self::URI, $this->createPayload(), $this->idem('wh-dupe-0001'))
            ->assertStatus(201)->assertHeader('Idempotency-Replayed', 'true');

        $this->assertSame($a->json('data.id'), $b->json('data.id'));
        $this->assertSame(1, WebhookEndpoint::withoutGlobalScopes()->count());
    }
}
