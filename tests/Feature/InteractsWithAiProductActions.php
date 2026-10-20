<?php

namespace Tests\Feature;

use App\Models\AiAction;
use App\Models\AiActionExtraction;
use App\Models\AiActionFile;
use App\Models\Role;
use App\Support\Settings;
use App\Tenancy\TenantContext;

/** Shared fixtures for the AI Actions product-import preview / approval / execution tests. */
trait InteractsWithAiProductActions
{
    private function enable(string $tenant): void
    {
        config(['ai_actions.enabled' => true, 'ai_actions.execution_enabled' => true]);
        app(TenantContext::class)->set($tenant);
        Settings::put('ai_actions', ['enabled' => true]);
    }

    /** @param array<string,mixed> $values */
    private function row(string $id, int $source, array $values, string $decision = 'create'): array
    {
        $fields = [];
        foreach ($values as $key => $value) {
            $fields[$key] = ['value' => $value, 'origin' => $value === null ? 'missing' : 'extracted', 'confidence' => $value === null ? null : 100];
        }

        return [
            'row_id' => $id, 'source_row' => $source,
            'match' => ['kind' => 'none', 'value' => null, 'target_product_id' => null, 'target_version' => null],
            'decision' => $decision, 'fields' => $fields, 'violations' => [], 'media' => null,
        ];
    }

    /** A complete, valid create row. */
    private function good(string $id, int $source, string $sku, array $extra = []): array
    {
        return $this->row($id, $source, array_merge(['sku' => $sku, 'name' => 'منتج '.$sku, 'type' => 'good', 'sale_price' => '10.50', 'purchase_price' => '5', 'tax_rate' => '15', 'unit' => 'قطعة'], $extra));
    }

    private function makeAction(array $auth, array $rows, string $key = 'pa-action-0001'): string
    {
        $this->enable($auth['tenant_id']);
        $id = $this->withToken($auth['token'])->withHeader('Idempotency-Key', $key)->postJson('/api/ai-actions', ['type' => 'product_import.v1', 'proposal' => ['schema_version' => 1, 'rows' => []]])->assertCreated()->json('data.id');
        $actorId = AiAction::findOrFail($id)->created_by;
        $file = AiActionFile::create(['ai_action_id' => $id, 'action_version' => 1, 'original_name' => 'products.csv', 'extension' => 'csv', 'size_bytes' => 20, 'content_sha256' => str_repeat('a', 64), 'storage_profile' => 'platform', 'storage_key' => 'private/source.csv', 'uploaded_by' => $actorId]);
        AiActionExtraction::create(['ai_action_file_id' => $file->id, 'ai_action_id' => $id, 'action_version' => 1, 'schema_version' => 1,
            'manifest' => ['source' => ['content_sha256' => str_repeat('a', 64)], 'rows' => $rows], 'manifest_hash' => str_repeat('b', 64), 'created_by' => $actorId, 'created_at' => now()]);

        return $id;
    }

    private function preview(string $token, string $id, int $version = 1, string $key = 'pa-preview-0001', array $headers = [])
    {
        return $this->withToken($token)->withHeaders($headers + ['Idempotency-Key' => $key])->postJson("/api/ai-actions/{$id}/previews", ['expected_version' => $version]);
    }

    private function approve(string $token, string $id, array $preview, int $version = 1, string $key = 'pa-approve-0001', array $headers = [])
    {
        return $this->withToken($token)->withHeaders($headers + ['Idempotency-Key' => $key])->postJson("/api/ai-actions/{$id}/approvals", [
            'expected_version' => $version, 'preview_id' => $preview['id'], 'preview_hash' => $preview['preview_hash'], 'acknowledged' => true,
        ]);
    }

    private function product(string $token, array $attributes): array
    {
        return $this->withToken($token)->postJson('/api/products', $attributes + ['type' => 'good', 'sale_price' => 1000, 'purchase_price' => 500])->assertCreated()['data'];
    }

    /** @return array<string,array<string,mixed>> */
    private function rows(array $preview): array
    {
        return collect($preview['rows'])->keyBy('row_id')->all();
    }

    private function codes(array $row): array
    {
        return array_column($row['issues'], 'code');
    }

    private function customRole(string $tenantId, string $slug, array $permissions, string $email): string
    {
        app(TenantContext::class)->set($tenantId);
        Role::create(['slug' => $slug, 'name' => $slug, 'permissions' => $permissions, 'is_system' => false]);

        return $this->tokenForRole($tenantId, $slug, $email);
    }
}
