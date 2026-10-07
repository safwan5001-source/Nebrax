<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontPresentation;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * CUST-HV V5e-2b — بوّابة تباين تسمية الأزرار العامة عبر مسار النشر الفعلي: مسودةٌ بنمط
 * outline ولونٍ لا يُثبَت تباينه تُحفظ كما أدخلها التاجر ويُرفض نشرها بـ422 على
 * المسار `buttons.colour`؛ ونمطٌ ممتلئ بالعلامة نفسها يُنشر.
 *
 * تشغيل: php artisan test --filter=ButtonTokensPublishGateTest
 */
class ButtonTokensPublishGateTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private function base(string $id): string
    {
        return '/api/commerce/workspace/storefronts/'.$id.'/presentation';
    }

    /** @return array{storefront: Storefront} */
    private function seedStorefront(string $tenantId): array
    {
        app(TenantContext::class)->set($tenantId);
        $channel = SalesChannel::query()->where('slug', 'web')->first()
            ?? SalesChannel::create(['slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $storefront = Storefront::create(['slug' => 'main', 'name' => 'المتجر', 'sales_channel_id' => $channel->id, 'is_active' => true]);
        app(TenantContext::class)->forget();

        return compact('storefront');
    }

    /** @return array{version:string,revision:int} */
    private function draftVersion($token, string $storefrontId, array $config): array
    {
        $created = $token->postJson($this->base($storefrontId).'/versions', ['name' => 'نسخة'])->assertCreated();
        $saved = $token->putJson($this->base($storefrontId).'/versions/'.$created->json('data.id'), [
            'config' => $config,
            'revision' => $created->json('data.revision'),
        ])->assertOk();

        return ['version' => $created->json('data.id'), 'revision' => $saved->json('data.revision')];
    }

    /** @test */
    public function an_outline_button_the_page_cannot_prove_is_rejected_with_the_exact_path_and_the_draft_is_kept(): void
    {
        $auth = $this->registerTenant('btn-bad', 'owner@btn-bad.test');
        $seed = $this->seedStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);
        $v = $this->draftVersion($token, $seed['storefront']->id, ['version' => 3, 'primaryColor' => '#fde68a', 'buttons' => ['style' => 'outline']]);

        $read = $token->getJson($this->base($seed['storefront']->id).'/versions/'.$v['version'])->assertOk();
        $this->assertSame('outline', $read->json('data.config.buttons.style'));

        $res = $token->postJson($this->base($seed['storefront']->id).'/versions/'.$v['version'].'/publish', [
            'revision' => $v['revision'], 'expected_published_revision' => null, 'expected_active_version_id' => null,
        ])->assertStatus(422)->assertJsonPath('code', 'publish_validation_failed');

        $this->assertSame(['buttons.colour'], array_keys($res->json('errors')));
        $this->assertSame('contrast_insufficient', $res->json('error_codes')['buttons.colour']);
        $head = StorefrontPresentation::withoutGlobalScopes()->where('storefront_id', $seed['storefront']->id)->first();
        $this->assertNull($head->published_config);
    }

    /** @test */
    public function the_same_brand_as_a_solid_button_publishes_and_the_snapshot_carries_the_tokens(): void
    {
        $auth = $this->registerTenant('btn-ok', 'owner@btn-ok.test');
        $seed = $this->seedStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);
        $v = $this->draftVersion($token, $seed['storefront']->id, [
            'version' => 3, 'primaryColor' => '#fde68a',
            'buttons' => ['style' => 'solid', 'size' => 'lg', 'radius' => 'pill'],
            'typography' => ['buttonText' => ['weight' => 800, 'case' => 'upper']],
        ]);

        $token->postJson($this->base($seed['storefront']->id).'/versions/'.$v['version'].'/publish', [
            'revision' => $v['revision'], 'expected_published_revision' => null, 'expected_active_version_id' => null,
        ])->assertOk();

        $head = StorefrontPresentation::withoutGlobalScopes()->where('storefront_id', $seed['storefront']->id)->first();
        $this->assertSame(['style' => 'solid', 'size' => 'lg', 'radius' => 'pill'], $head->published_config['buttons']);
        $this->assertSame(['weight' => 800, 'case' => 'upper'], $head->published_config['typography']['buttonText']);
    }
}
