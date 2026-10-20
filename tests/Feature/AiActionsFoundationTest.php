<?php

namespace Tests\Feature;

use App\Models\AiAction;
use App\Models\AiActionEvent;
use App\Models\AiActionVersion;
use App\Models\Product;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class AiActionsFoundationTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function proposal(string $sku = 'AI-SKU-1'): array
    {
        return [
            'schema_version' => 1,
            'rows' => [[
                'row_id' => 'row-1',
                'source_row' => 2,
                'match' => [
                    'kind' => 'sku',
                    'value' => $sku,
                    'target_product_id' => null,
                    'target_version' => null,
                ],
                'decision' => 'create',
                'fields' => [
                    'sku' => ['value' => $sku, 'origin' => 'extracted', 'confidence' => 100],
                    'name' => ['value' => 'منتج مقترح', 'origin' => 'extracted', 'confidence' => 95],
                    'purchase_price' => ['value' => null, 'origin' => 'missing', 'confidence' => null],
                ],
                'violations' => [[
                    'code' => 'purchase_price.missing',
                    'field' => 'purchase_price',
                    'severity' => 'warning',
                    'message' => 'سعر الشراء مفقود ولن يخترعه المساعد.',
                ]],
                'media' => null,
            ]],
        ];
    }

    private function enable(string $tenantId): void
    {
        config(['ai_actions.enabled' => true]);
        app(TenantContext::class)->set($tenantId);
        Settings::put('ai_actions', ['enabled' => true]);
    }

    /** @test */
    public function foundation_is_disabled_by_default_and_has_no_execute_or_approve_route(): void
    {
        $auth = $this->registerTenant();

        $this->withToken($auth['token'])->withHeader('Idempotency-Key', 'ai-create-0001')
            ->postJson('/api/ai-actions', ['type' => 'product_import.v1', 'proposal' => $this->proposal()])
            ->assertForbidden();

        $this->withToken($auth['token'])->postJson('/api/ai-actions/not-a-real-id/execute')->assertNotFound();
        $this->assertSame(0, AiAction::withoutGlobalScopes()->count());
        $this->assertSame(0, Product::withoutGlobalScopes()->count());
    }

    /** @test */
    public function it_persists_an_immutable_version_and_audit_event_without_writing_products(): void
    {
        $auth = $this->registerTenant();
        $this->enable($auth['tenant_id']);

        $response = $this->withToken($auth['token'])->withHeader('Idempotency-Key', 'ai-create-0002')
            ->postJson('/api/ai-actions', ['type' => 'product_import.v1', 'proposal' => $this->proposal()])
            ->assertCreated()
            ->assertJsonPath('data.version', 1)
            ->assertJsonPath('data.status', 'created')
            ->assertJsonPath('data.latest_version.validation_summary.row_count', 1);

        $hash = (string) $response->json('data.latest_version.proposal_hash');
        $this->assertMatchesRegularExpression('/^[a-f0-9]{64}$/', $hash);
        $this->assertSame(1, AiActionVersion::count());
        $this->assertSame(1, AiActionEvent::count());
        $this->assertSame(0, Product::count(), 'المسودة لا تصل أبداً إلى خدمة كتابة ERP في هذه المرحلة.');
    }

    /** @test */
    public function repeated_request_is_replayed_and_stale_version_is_rejected(): void
    {
        $auth = $this->registerTenant();
        $this->enable($auth['tenant_id']);
        $body = ['type' => 'product_import.v1', 'proposal' => $this->proposal()];

        $first = $this->withToken($auth['token'])->withHeader('Idempotency-Key', 'ai-create-0003')
            ->postJson('/api/ai-actions', $body)->assertCreated();
        $this->withToken($auth['token'])->withHeader('Idempotency-Key', 'ai-create-0003')
            ->postJson('/api/ai-actions', $body)->assertCreated()->assertHeader('Idempotency-Replayed', 'true');

        $id = $first->json('data.id');
        $this->withToken($auth['token'])->withHeader('Idempotency-Key', 'ai-version-0001')
            ->postJson("/api/ai-actions/{$id}/versions", [
                'expected_version' => 1,
                'proposal' => $this->proposal('AI-SKU-2'),
            ])->assertCreated()->assertJsonPath('data.version', 2);

        $this->withToken($auth['token'])->withHeader('Idempotency-Key', 'ai-version-0002')
            ->postJson("/api/ai-actions/{$id}/versions", [
                'expected_version' => 1,
                'proposal' => $this->proposal('AI-SKU-3'),
            ])->assertConflict()->assertJsonPath('error.code', 'version_conflict');

        $this->assertSame(1, AiAction::count());
        $this->assertSame(2, AiActionVersion::count());
    }

    /** @test */
    public function tenant_scope_and_rbac_are_enforced(): void
    {
        $a = $this->registerTenant('ai-a', 'owner@ai-a.test');
        $this->enable($a['tenant_id']);
        $id = $this->withToken($a['token'])->withHeader('Idempotency-Key', 'ai-create-0004')
            ->postJson('/api/ai-actions', ['type' => 'product_import.v1', 'proposal' => $this->proposal()])
            ->assertCreated()->json('data.id');

        $restricted = $this->tokenForRole($a['tenant_id'], 'accountant', 'accountant@ai-a.test');
        $this->withToken($restricted)->getJson("/api/ai-actions/{$id}")->assertForbidden();

        $b = $this->registerTenant('ai-b', 'owner@ai-b.test');
        $this->enable($b['tenant_id']);
        $this->withToken($b['token'])->getJson("/api/ai-actions/{$id}")->assertNotFound();
    }
}
