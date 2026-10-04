<?php

namespace Tests\Feature;

use App\Models\DeliveryPlatformProfileVersion;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Payment;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Services\DeliveryFinancialRoleGate;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * DLV-FINANCIAL-ROLE-CONFIG-1 — إعداد البوابة فقط. لا أمر فاتورة.
 */
class DeliveryFinancialRoleGateTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @return array<string, string> */
    private function compatible(): array
    {
        return [
            'selling_role' => 'merchant_seller',
            'invoice_responsibility' => 'merchant_issues',
            'collection_role' => 'platform_collects_for_merchant',
            'merchant_vat_status_at_supply' => 'registered',
            'financial_evidence_ref' => 'contract-2026-10-04',
        ];
    }

    /** @test */
    public function a_new_profile_is_unknown_even_when_the_tenant_has_a_current_vat_number(): void
    {
        $auth = $this->registerTenant('dlv-gate-vat', 'owner@dlv-gate-vat.test');
        $tenant = Tenant::query()->findOrFail($auth['tenant_id']);
        $this->assertNotNull($tenant->vat_number);

        $created = $this->withToken($auth['token'])->postJson('/api/delivery-platforms', [
            'platform_key' => 'jahez',
        ])->assertCreated()->json('data');

        $version = $created['current_version'];
        $this->assertSame('unknown', $version['selling_role']);
        $this->assertSame('unknown', $version['invoice_responsibility']);
        $this->assertSame('unknown', $version['collection_role']);
        $this->assertSame('unknown', $version['merchant_vat_status_at_supply']);
        $this->assertNull($version['financial_evidence_ref']);
        $this->assertSame('blocked', $version['financial_gate']['decision']);
        $this->assertFalse($version['financial_gate']['posting_authorized']);
        $this->assertContains('merchant_vat_status_unknown', $version['financial_gate']['reason_codes']);
        $this->assertNotContains('configuration_compatible', $version['financial_gate']['reason_codes']);
    }

    /** @test */
    public function each_unknown_dimension_blocks_on_its_own_and_a_compatible_shape_still_does_not_authorize_posting(): void
    {
        $auth = $this->registerTenant('dlv-gate-dims', 'owner@dlv-gate-dims.test');
        $created = $this->withToken($auth['token'])->postJson('/api/delivery-platforms', [
            'platform_key' => 'keeta',
        ])->assertCreated()->json('data');
        $id = $created['id'];

        foreach ([
            'selling_role' => 'selling_role_unknown',
            'invoice_responsibility' => 'invoice_responsibility_unknown',
            'collection_role' => 'collection_role_unknown',
            'merchant_vat_status_at_supply' => 'merchant_vat_status_unknown',
        ] as $field => $reason) {
            $body = $this->compatible();
            $body[$field] = 'unknown';
            $gate = $this->withToken($auth['token'])->putJson("/api/delivery-platforms/{$id}", $body)
                ->assertOk()->json('data.current_version.financial_gate');
            $this->assertSame('blocked', $gate['decision']);
            $this->assertFalse($gate['posting_authorized']);
            $this->assertContains($reason, $gate['reason_codes']);
        }

        $eligible = $this->withToken($auth['token'])->putJson("/api/delivery-platforms/{$id}", $this->compatible())
            ->assertOk()->json('data.current_version.financial_gate');
        $this->assertSame('eligible', $eligible['decision']);
        $this->assertFalse($eligible['posting_authorized']);
        $this->assertSame(['configuration_compatible', 'posting_not_authorized'], $eligible['reason_codes']);
        $merchantCollects = $this->withToken($auth['token'])->putJson("/api/delivery-platforms/{$id}", [
            ...$this->compatible(),
            'collection_role' => 'merchant_collects',
            'financial_evidence_ref' => 'contract-merchant-collects',
        ])->assertOk()->json('data.current_version.financial_gate');
        $this->assertSame('eligible', $merchantCollects['decision']);
        $this->assertFalse($merchantCollects['posting_authorized']);
        $this->assertSame(0, Invoice::query()->count());
        $this->assertSame(0, Payment::query()->count());
        $this->assertSame(0, JournalEntry::query()->count());
        $this->assertSame(0, StockMovement::query()->count());
    }

    /** @test */
    public function platform_seller_and_the_other_blocked_shapes_cannot_use_the_restaurant_invoice_path(): void
    {
        $auth = $this->registerTenant('dlv-gate-block', 'owner@dlv-gate-block.test');
        $id = $this->withToken($auth['token'])->postJson('/api/delivery-platforms', [
            'platform_key' => 'hungerstation',
        ])->assertCreated()->json('data.id');

        $cases = [
            ['selling_role' => 'platform_seller', 'reason' => 'platform_seller_blocked'],
            ['invoice_responsibility' => 'platform_as_supplier', 'reason' => 'platform_issues_as_supplier_blocked'],
            ['invoice_responsibility' => 'platform_on_behalf', 'reason' => 'platform_on_behalf_blocked'],
            ['collection_role' => 'platform_collects_as_seller', 'reason' => 'platform_collects_as_seller_blocked'],
            ['merchant_vat_status_at_supply' => 'not_registered', 'reason' => 'merchant_not_registered_blocked'],
        ];
        foreach ($cases as $case) {
            $body = array_merge($this->compatible(), $case);
            unset($body['reason']);
            $codes = $this->withToken($auth['token'])->putJson("/api/delivery-platforms/{$id}", $body)
                ->assertOk()->json('data.current_version.financial_gate.reason_codes');
            $this->assertContains($case['reason'], $codes);
        }
    }

    /** @test */
    public function a_legal_change_without_evidence_is_rejected_and_an_old_version_keeps_its_meaning(): void
    {
        $auth = $this->registerTenant('dlv-gate-version', 'owner@dlv-gate-version.test');
        $created = $this->withToken($auth['token'])->postJson('/api/delivery-platforms', [
            'platform_key' => 'ninja',
            ...$this->compatible(),
        ])->assertCreated()->json('data');
        $first = $created['current_version']['id'];

        $this->withToken($auth['token'])->putJson("/api/delivery-platforms/{$created['id']}", [
            'selling_role' => 'platform_seller',
        ])->assertStatus(422);

        $this->withToken($auth['token'])->putJson("/api/delivery-platforms/{$created['id']}", [
            'display_name' => 'نينجا',
        ])->assertOk()->assertJsonPath('data.current_version.selling_role', 'merchant_seller')
            ->assertJsonPath('data.current_version.financial_evidence_ref', 'contract-2026-10-04');

        $historical = $this->withToken($auth['token'])
            ->getJson("/api/delivery-platforms/{$created['id']}/resolve?version_id={$first}")
            ->assertOk()->json('data');
        $this->assertSame('merchant_seller', $historical['selling_role']);
        $this->assertSame(1, $historical['version_number']);
        $this->assertFalse($historical['financial_role_branch_override']);
        $this->assertFalse($historical['financial_gate']['posting_authorized']);

        $at = rawurlencode($created['current_version']['effective_from']);
        $this->withToken($auth['token'])
            ->getJson("/api/delivery-platforms/{$created['id']}/resolve?at={$at}")
            ->assertOk()
            ->assertJsonPath('data.version_number', 1)
            ->assertJsonPath('data.selling_role', 'merchant_seller')
            ->assertJsonPath('data.financial_gate.posting_authorized', false);

        $this->withToken($auth['token'])->putJson("/api/delivery-platforms/{$created['id']}", [
            'financial_verified_at' => '2026-10-04T00:00:00Z',
        ])->assertStatus(422);

        $pinned = DeliveryPlatformProfileVersion::query()->findOrFail($first);
        $pinned->selling_role = 'platform_seller';
        $this->expectException(\LogicException::class);
        $pinned->save();
    }

    /** @test */
    public function branch_collection_mode_does_not_change_the_legal_role_and_other_tenants_cannot_read_it(): void
    {
        $a = $this->registerTenant('dlv-gate-a', 'owner@dlv-gate-a.test');
        $branch = $this->withToken($a['token'])->postJson('/api/branches', ['name' => 'فرع'])->assertCreated()->json('data.id');
        $created = $this->withToken($a['token'])->postJson('/api/delivery-platforms', [
            'platform_key' => 'mrsool',
            ...$this->compatible(),
            'collection_mode' => 'platform_collected',
            'branch_overrides' => [['branch_id' => $branch, 'collection_mode' => 'merchant_collected']],
        ])->assertCreated()->json('data');

        $resolved = $this->withToken($a['token'])
            ->getJson("/api/delivery-platforms/{$created['id']}/resolve?branch_id={$branch}")
            ->assertOk()->json('data');
        $this->assertSame('merchant_collected', $resolved['collection_mode']);
        $this->assertSame('platform_collects_for_merchant', $resolved['collection_role']);
        $this->assertFalse($resolved['financial_role_branch_override']);

        $this->withToken($a['token'])
            ->getJson("/api/delivery-platforms/{$created['id']}/resolve?branch_id=".\Illuminate\Support\Str::uuid())
            ->assertStatus(422);

        $b = $this->registerTenant('dlv-gate-b', 'owner@dlv-gate-b.test');
        $this->withToken($b['token'])->getJson("/api/delivery-platforms/{$created['id']}/resolve?version_id={$created['current_version']['id']}")
            ->assertNotFound();

        app(TenantContext::class)->set($b['tenant_id']);
        $foreign = DeliveryPlatformProfileVersion::query()->withoutGlobalScopes()->findOrFail($created['current_version']['id']);
        $this->expectException(\RuntimeException::class);
        app(DeliveryFinancialRoleGate::class)->evaluate($foreign);
    }

    /** @test */
    public function staff_cannot_change_the_financial_role_and_an_unchanged_save_does_not_mint_a_version(): void
    {
        $auth = $this->registerTenant('dlv-gate-auth', 'owner@dlv-gate-auth.test');
        $created = $this->withToken($auth['token'])->postJson('/api/delivery-platforms', [
            'platform_key' => 'the_chefz',
            ...$this->compatible(),
        ])->assertCreated()->json('data');
        $staff = $this->tokenForRole($auth['tenant_id'], 'staff', 'staff@dlv-gate-auth.test');
        $accountant = $this->tokenForRole($auth['tenant_id'], 'accountant', 'acct@dlv-gate-auth.test');
        $this->withToken($staff)->putJson("/api/delivery-platforms/{$created['id']}", $this->compatible())->assertForbidden();
        $this->withToken($accountant)->putJson("/api/delivery-platforms/{$created['id']}", $this->compatible())->assertForbidden();
        $this->withToken($staff)->getJson("/api/delivery-platforms/{$created['id']}")->assertOk();
        $this->withToken($accountant)->getJson("/api/delivery-platforms/{$created['id']}")->assertOk();

        $this->withToken($auth['token'])->putJson("/api/delivery-platforms/{$created['id']}", $this->compatible())
            ->assertOk()->assertJsonPath('data.current_version.version_number', 1);
    }
}
