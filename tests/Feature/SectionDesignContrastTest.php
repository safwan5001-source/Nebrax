<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontPresentation;
use App\Support\Commerce\SectionDesignContrast;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use App\Support\Commerce\StorefrontPresentationPublishValidator;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * CUST-HV V5d-1 — بوّابة تباين تصميم الأقسام عند النشر (V0 §4.5.5–6).
 *
 * الحالات المشتركة في `tests/Fixtures/presentation/section-design-contrast.json`
 * يقرؤها اختبارا web وstorefront أيضاً: المحرّر والخادم يشغّلان الخوارزمية ذاتها.
 *
 * تشغيل: php artisan test --filter=SectionDesignContrastTest
 */
class SectionDesignContrastTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    /** @return array<string, array{array<string,mixed>}> */
    public static function parityCases(): array
    {
        $cases = json_decode((string) file_get_contents(dirname(__DIR__).'/Fixtures/presentation/section-design-contrast.json'), true, 512, JSON_THROW_ON_ERROR)['cases'];

        return array_combine(array_column($cases, 'name'), array_map(static fn (array $c): array => [$c], $cases));
    }

    /**
     * @test
     *
     * @dataProvider parityCases
     *
     * @param  array<string,mixed>  $case
     */
    public function the_gate_matches_the_shared_cases(array $case): void
    {
        $media = $case['media'] ?? [];
        $actual = SectionDesignContrast::issues(
            $case['design'],
            $case['config'],
            $case['type'],
            static fn (array $ref): ?array => $media[$ref['mediaId']] ?? null,
        );

        $this->assertSame(
            array_map(static fn (array $i): array => [$i['field'], $i['code']], $case['expected']),
            array_map(static fn (array $i): array => [$i['field'], $i['code']], $actual),
            $case['name'],
        );
        foreach ($case['expected'] as $i => $expected) {
            $this->assertEqualsWithDelta($expected['ratio'], $actual[$i]['ratio'], 1e-4, $case['name']);
        }
    }

    /** @param array<string,mixed> $design */
    private function document(array $design, bool $visible = true, string $type = 'hero'): array
    {
        return (new StorefrontPresentationNormalizer)->normalize([
            'primaryColor' => '#12372a',
            'homepage' => ['sections' => [['id' => $type, 'type' => $type, 'visible' => $visible, 'design' => $design]]],
        ]);
    }

    /** @test */
    public function a_failing_explicit_colour_is_reported_at_the_exact_field_path(): void
    {
        $errors = (new StorefrontPresentationPublishValidator)->errors($this->document([
            'background' => ['kind' => 'solid', 'color' => ['hex' => '#102030']],
            'text' => ['body' => ['hex' => '#222222'], 'link' => ['hex' => '#ffffff']],
        ]));

        $this->assertSame(['homepage.sections[0].design.text.body'], array_keys($errors));
        $this->assertSame('contrast_insufficient', $errors['homepage.sections[0].design.text.body']['code']);
    }

    /** @test */
    public function an_unprovable_gradient_is_reported_on_the_background_not_the_text(): void
    {
        $errors = (new StorefrontPresentationPublishValidator)->errors($this->document([
            'background' => ['kind' => 'gradient', 'from' => ['hex' => '#d1456a'], 'to' => ['hex' => '#1e8b9a'], 'direction' => 'to-end'],
        ]));

        $this->assertSame(['homepage.sections[0].design.background'], array_keys($errors));
        $this->assertSame('contrast_unprovable', $errors['homepage.sections[0].design.background']['code']);
    }

    /** @test */
    public function a_dark_surface_section_without_a_design_background_ignores_text_colours_and_is_not_blocked(): void
    {
        $bad = ['text' => ['body' => ['hex' => '#ffffff']]];
        foreach (['hero', 'appPromo', 'wholesale'] as $type) {
            $doc = $this->document($bad, type: $type);
            $this->assertSame([], (new StorefrontPresentationPublishValidator)->errors($doc), $type);
        }
        // the same colour on a light-surface section is judged on the page background
        $this->assertNotSame([], (new StorefrontPresentationPublishValidator)->errors($this->document($bad, type: 'banner')));
    }

    /** @test */
    public function a_hidden_section_never_blocks_publishing_and_a_design_free_document_is_unaffected(): void
    {
        $bad = ['text' => ['body' => ['hex' => '#ffffff']]];

        $this->assertNotSame([], (new StorefrontPresentationPublishValidator)->errors($this->document($bad, type: 'banner')));
        $this->assertSame([], (new StorefrontPresentationPublishValidator)->errors($this->document($bad, visible: false, type: 'banner')));
        $this->assertSame([], (new StorefrontPresentationPublishValidator)->errors((new StorefrontPresentationNormalizer)->normalize([])));
    }

    /** @test */
    public function any_background_is_publishable_with_the_automatic_foreground(): void
    {
        foreach (['#000000', '#ffffff', '#777777', '#d1456a', '#1e8b9a', '#12372a', '#f8f9fa'] as $hex) {
            $this->assertSame([], (new StorefrontPresentationPublishValidator)->errors($this->document([
                'background' => ['kind' => 'solid', 'color' => ['hex' => $hex]],
            ])), $hex);
        }
    }

    // ───────────────────────── API: every publish path ─────────────────────────

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

    /** @return array<string,mixed> */
    private function badDesignDocument(): array
    {
        return ['version' => 3, 'homepage' => ['sections' => [['id' => 'hero', 'type' => 'hero', 'visible' => true, 'design' => [
            'background' => ['kind' => 'solid', 'color' => ['hex' => '#102030']],
            'text' => ['heading' => ['hex' => '#1a2a3a']],
        ]]]]];
    }

    /** @return array{version:string,revision:int,token:string} */
    private function draftVersion($token, string $storefrontId, array $config): array
    {
        $created = $token->postJson($this->base($storefrontId).'/versions', ['name' => 'نسخة'])->assertCreated();
        $saved = $token->putJson($this->base($storefrontId).'/versions/'.$created->json('data.id'), [
            'config' => $config,
            'revision' => $created->json('data.revision'),
        ])->assertOk();

        return ['version' => $created->json('data.id'), 'revision' => $saved->json('data.revision'), 'token' => $saved->json('data.schedule_token')];
    }

    /** @test */
    public function immediate_publish_is_rejected_with_a_path_specific_422_and_the_draft_is_kept(): void
    {
        $auth = $this->registerTenant('sdc-pub', 'owner@sdc-pub.test');
        $seed = $this->seedStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);
        $v = $this->draftVersion($token, $seed['storefront']->id, $this->badDesignDocument());

        // المسودة تُحفظ كما أدخلها التاجر ولو لم تكن قابلة للنشر.
        $read = $token->getJson($this->base($seed['storefront']->id).'/versions/'.$v['version'])->assertOk();
        $this->assertSame('#1a2a3a', $read->json('data.config.homepage.sections.0.design.text.heading.hex'));

        $res = $token->postJson($this->base($seed['storefront']->id).'/versions/'.$v['version'].'/publish', [
            'revision' => $v['revision'], 'expected_published_revision' => null, 'expected_active_version_id' => null,
        ])->assertStatus(422)->assertJsonPath('code', 'publish_validation_failed');

        $this->assertSame(['homepage.sections[0].design.text.heading'], array_keys($res->json('errors')));
        $this->assertSame('contrast_insufficient', $res->json('error_codes')['homepage.sections[0].design.text.heading']);

        $head = StorefrontPresentation::withoutGlobalScopes()->where('storefront_id', $seed['storefront']->id)->first();
        $this->assertNull($head->published_config);
    }

    /** @test */
    public function the_legacy_head_publish_and_scheduling_apply_the_same_gate(): void
    {
        $auth = $this->registerTenant('sdc-legacy', 'owner@sdc-legacy.test');
        $seed = $this->seedStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $show = $token->getJson($this->base($seed['storefront']->id))->assertOk();
        $saved = $token->putJson($this->base($seed['storefront']->id), [
            'config' => $this->badDesignDocument(),
            'draft_revision' => $show->json('data.draft_revision'),
        ])->assertOk();
        $token->postJson($this->base($seed['storefront']->id).'/publish', ['draft_revision' => $saved->json('data.draft_revision')])
            ->assertStatus(422)->assertJsonPath('code', 'publish_validation_failed');

        $v = $this->draftVersion($token, $seed['storefront']->id, $this->badDesignDocument());
        $token->putJson($this->base($seed['storefront']->id).'/versions/'.$v['version'].'/schedule', [
            'revision' => $v['revision'],
            'scheduled_for' => now('UTC')->addDay()->toIso8601String(),
            'expected_schedule_token' => $v['token'],
        ])->assertStatus(422)->assertJsonPath('code', 'publish_validation_failed');
    }

    /** @test */
    public function a_compliant_design_publishes_and_the_snapshot_carries_it(): void
    {
        $auth = $this->registerTenant('sdc-ok', 'owner@sdc-ok.test');
        $seed = $this->seedStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);
        $doc = ['version' => 3, 'homepage' => ['sections' => [['id' => 'hero', 'type' => 'hero', 'visible' => true, 'design' => [
            'background' => ['kind' => 'solid', 'color' => ['hex' => '#102030']],
        ]]]]];
        $v = $this->draftVersion($token, $seed['storefront']->id, $doc);

        $token->postJson($this->base($seed['storefront']->id).'/versions/'.$v['version'].'/publish', [
            'revision' => $v['revision'], 'expected_published_revision' => null, 'expected_active_version_id' => null,
        ])->assertOk();

        $head = StorefrontPresentation::withoutGlobalScopes()->where('storefront_id', $seed['storefront']->id)->first();
        $this->assertSame('#102030', $head->published_config['homepage']['sections'][0]['design']['background']['color']['hex']);
    }
}
