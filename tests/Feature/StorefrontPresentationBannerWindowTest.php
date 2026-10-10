<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontPresentation;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use App\Support\Commerce\StorefrontPresentationPublishValidator;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * CUST-HV V6c-1 (V0 §8.4، D-15، AMEND-7) — نافذة ظهور البانر: التطبيع يحفظ ما أدخله التاجر حرفياً (حتى المشوَّه)،
 * والنشر يرفضه بمسارٍ محدَّد ورمزٍ ثابت ولا «يُصحِّحه» إلى بلا نافذة (فيصير البانر أكثر ظهوراً).
 * حالات التطبيع مشتركة مع توأمَي TS عبر `tests/Fixtures/presentation/banner-window.json`.
 *
 * تشغيل: php artisan test --filter=StorefrontPresentationBannerWindowTest
 */
class StorefrontPresentationBannerWindowTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    private function banner(array $content, bool $visible = true, string $id = 'banner'): array
    {
        return ['id' => $id, 'type' => 'banner', 'visible' => $visible, 'content' => $content + ['title' => 'تخفيضات']];
    }

    /** @return array<string, array{code:string,message:string}> */
    private function errorsFor(array ...$sections): array
    {
        $document = (new StorefrontPresentationNormalizer)->normalize(['version' => 3, 'homepage' => ['sections' => $sections]]);

        return (new StorefrontPresentationPublishValidator)->errors($document);
    }

    /** @test */
    public function the_shared_fixture_cases_normalize_identically_including_key_order(): void
    {
        $fixture = json_decode((string) file_get_contents(dirname(__DIR__).'/Fixtures/presentation/banner-window.json'), true);
        $this->assertNotEmpty($fixture['cases']);
        $normalizer = new StorefrontPresentationNormalizer;
        $contentOf = function (mixed $input) use ($normalizer): ?array {
            $doc = $normalizer->normalize(['version' => 3, 'homepage' => ['sections' => [['id' => 'banner', 'type' => 'banner', 'visible' => true, 'content' => $input]]]]);
            $row = collect($doc['homepage']['sections'])->firstWhere('id', 'banner');
            $this->assertNotNull($row, 'the banner section itself must survive normalization');

            return $row['content'] ?? null;
        };

        foreach ($fixture['cases'] as $case) {
            $actual = $contentOf($case['input']);
            if ($case['expected'] === null) {
                $this->assertNull($actual, $case['name']);

                continue;
            }
            $this->assertSame($case['expected'], $actual, $case['name']);
            $this->assertSame(json_encode($case['expected']), json_encode($actual), $case['name'].' (key order)');
            $this->assertSame($actual, $contentOf($actual), $case['name'].' (idempotent)');
        }
    }

    /** @test */
    public function only_a_banner_accepts_a_window(): void
    {
        $doc = (new StorefrontPresentationNormalizer)->normalize(['version' => 3, 'homepage' => ['sections' => [
            ['id' => 'cats', 'type' => 'categories', 'visible' => true, 'content' => ['window' => ['startsAt' => '2026-12-01T00:00:00Z']]],
        ]]]);
        $this->assertArrayNotHasKey('content', $doc['homepage']['sections'][0] ?? []);
    }

    /** @test */
    public function the_gate_names_the_exact_path_and_a_stable_code_for_each_window_problem(): void
    {
        $e = $this->errorsFor($this->banner(['window' => ['startsAt' => 'غداً']]));
        $this->assertSame('window_invalid_timestamp', $e['homepage.sections[0].content.window.startsAt']['code']);

        $e = $this->errorsFor($this->banner(['window' => ['endsAt' => '2026-13-45T00:00:00Z']]));
        $this->assertSame('window_invalid_timestamp', $e['homepage.sections[0].content.window.endsAt']['code']);

        $e = $this->errorsFor($this->banner(['window' => ['startsAt' => '2026-02-31T00:00:00Z']]));
        $this->assertArrayHasKey('homepage.sections[0].content.window.startsAt', $e);

        $e = $this->errorsFor($this->banner(['window' => ['startsAt' => '2026-10-07T00:00:00Z', 'endsAt' => '2026-10-06T00:00:00Z']]));
        $this->assertSame('window_end_not_after_start', $e['homepage.sections[0].content.window.endsAt']['code']);

        $e = $this->errorsFor($this->banner(['window' => ['startsAt' => '2026-10-06T10:00:00Z', 'endsAt' => '2026-10-06T10:00:00Z']]));
        $this->assertSame('window_end_not_after_start', $e['homepage.sections[0].content.window.endsAt']['code'], 'endsAt is exclusive: equal edges are an empty window');

        // صالحة: فرق المناطق الزمنية يُقارَن بالتوقيت المطلق، حافةٌ واحدة مقبولة، وبلا نافذة لا خطأ.
        $this->assertSame([], $this->errorsFor($this->banner(['window' => ['startsAt' => '2026-10-06T15:00:00+03:00', 'endsAt' => '2026-10-06T12:00:01Z']])));
        $this->assertSame([], $this->errorsFor($this->banner(['window' => ['startsAt' => '2026-10-06T00:00:00Z']])));
        $this->assertSame([], $this->errorsFor($this->banner(['window' => ['endsAt' => '2026-10-06T00:00:00.500Z']])));
        $this->assertSame([], $this->errorsFor($this->banner([])));
    }

    /** @test */
    public function only_a_visible_banner_can_block_publishing_and_the_path_uses_the_section_index(): void
    {
        $bad = ['window' => ['startsAt' => 'غداً']];
        $this->assertSame([], $this->errorsFor($this->banner($bad, visible: false)), 'a hidden banner is never shown, so it never blocks');

        $errors = $this->errorsFor(
            ['id' => 'cats', 'type' => 'categories', 'visible' => true],
            $this->banner(['window' => ['endsAt' => '2026-12-31T00:00:00Z']], id: 'ok'),
            $this->banner($bad, id: 'bad'),
        );
        $this->assertSame(['homepage.sections[2].content.window.startsAt'], array_keys($errors));
    }

    // ───────────────────────────── API: draft preserves, publish rejects ─────────────────────────────

    private function base(string $id): string
    {
        return '/api/commerce/workspace/storefronts/'.$id.'/presentation';
    }

    private function seedStorefront(string $tenantId): Storefront
    {
        app(TenantContext::class)->set($tenantId);
        $channel = SalesChannel::query()->where('slug', 'web')->first()
            ?? SalesChannel::create(['slug' => 'web', 'name' => 'ويب', 'type' => SalesChannel::TYPE_WEB, 'is_active' => true]);
        $storefront = Storefront::create(['slug' => 'main', 'name' => 'المتجر', 'sales_channel_id' => $channel->id, 'is_active' => true]);
        app(TenantContext::class)->forget();

        return $storefront;
    }

    /** @return array{version:string,revision:int} */
    private function draft($token, string $storefrontId, array $window): array
    {
        $created = $token->postJson($this->base($storefrontId).'/versions', ['name' => 'نسخة'])->assertCreated();
        $saved = $token->putJson($this->base($storefrontId).'/versions/'.$created->json('data.id'), [
            'config' => ['version' => 3, 'homepage' => ['sections' => [$this->banner(['window' => $window])]]],
            'revision' => $created->json('data.revision'),
        ])->assertOk();

        return ['version' => $created->json('data.id'), 'revision' => $saved->json('data.revision')];
    }

    /** @test */
    public function a_draft_keeps_a_bad_window_publish_rejects_it_and_fixing_it_makes_the_same_draft_publishable(): void
    {
        $auth = $this->registerTenant('ban-win', 'owner@ban-win.test');
        $storefront = $this->seedStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $bad = ['startsAt' => '2026-12-31T00:00:00Z', 'endsAt' => '2026-12-01T00:00:00Z'];
        $v = $this->draft($token, $storefront->id, $bad);

        $read = $token->getJson($this->base($storefront->id).'/versions/'.$v['version'])->assertOk();
        $this->assertSame($bad, $read->json('data.config.homepage.sections.0.content.window'), 'the Draft keeps exactly what was typed');

        $res = $token->postJson($this->base($storefront->id).'/versions/'.$v['version'].'/publish', [
            'revision' => $v['revision'], 'expected_published_revision' => null, 'expected_active_version_id' => null,
        ])->assertStatus(422)->assertJsonPath('code', 'publish_validation_failed');
        $this->assertSame(['homepage.sections[0].content.window.endsAt'], array_keys($res->json('errors')));
        $this->assertSame('window_end_not_after_start', $res->json('error_codes')['homepage.sections[0].content.window.endsAt']);

        $head = StorefrontPresentation::withoutGlobalScopes()->where('storefront_id', $storefront->id)->first();
        $this->assertNull($head->published_config, 'nothing was published');

        // نفس المسودة بعد التصحيح تُنشر وتحمل النافذة في اللقطة.
        $good = ['startsAt' => '2026-01-01T00:00:00Z', 'endsAt' => '2026-12-31T00:00:00Z'];
        $fixed = $token->putJson($this->base($storefront->id).'/versions/'.$v['version'], [
            'config' => ['version' => 3, 'homepage' => ['sections' => [$this->banner(['window' => $good])]]],
            'revision' => $v['revision'],
        ])->assertOk();
        $token->postJson($this->base($storefront->id).'/versions/'.$v['version'].'/publish', [
            'revision' => $fixed->json('data.revision'), 'expected_published_revision' => null, 'expected_active_version_id' => null,
        ])->assertOk();

        $head = StorefrontPresentation::withoutGlobalScopes()->where('storefront_id', $storefront->id)->first();
        $this->assertSame($good, $head->published_config['homepage']['sections'][0]['content']['window']);
    }
}
