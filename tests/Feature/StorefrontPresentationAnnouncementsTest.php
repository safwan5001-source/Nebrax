<?php

namespace Tests\Feature;

use App\Models\SalesChannel;
use App\Models\Storefront;
use App\Models\StorefrontPresentation;
use App\Services\Commerce\ScheduledPresentationDispatcher;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use App\Support\Commerce\StorefrontPresentationPublishValidator;
use App\Tenancy\TenantContext;
use Carbon\Carbon;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Tests\TestCase;

/**
 * CUST-HV V3 — شريط الإعلانات (العقد §12): التطبيع على الخادم (سلطة)، بوابة
 * النشر (النافذة + التباين)، وحفظ المسودة لما أدخله التاجر حرفياً.
 *
 * الحالات المشتركة في `tests/Fixtures/presentation/announcements.json` يقرؤها
 * اختبارا web وstorefront أيضاً — فلا ينحرف أحد التطبيعات الثلاثة بصمت.
 *
 * تشغيل: php artisan test --filter=StorefrontPresentationAnnouncementsTest
 */
class StorefrontPresentationAnnouncementsTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;

    /** @return array<string,mixed> */
    private function fixture(): array
    {
        return json_decode((string) file_get_contents(dirname(__DIR__).'/Fixtures/presentation/announcements.json'), true, 512, JSON_THROW_ON_ERROR);
    }

    // ───────────────────────── normalizer parity ─────────────────────────

    /** @return array<string, array{array<string,mixed>}> */
    public static function parityCases(): array
    {
        $cases = json_decode((string) file_get_contents(dirname(__DIR__).'/Fixtures/presentation/announcements.json'), true, 512, JSON_THROW_ON_ERROR)['cases'];

        return array_combine(array_column($cases, 'name'), array_map(static fn (array $c): array => [$c], $cases));
    }

    /**
     * @test
     *
     * @dataProvider parityCases
     *
     * @param  array<string,mixed>  $case
     */
    public function the_normalizer_matches_the_shared_golden_cases(array $case): void
    {
        $out = (new StorefrontPresentationNormalizer)->normalize(['announcements' => $case['input']]);

        $this->assertSame($case['expected'], $out['announcements'] ?? null, $case['name']);
        // الغياب غياب: لا مفتاح فارغ يُكتب أبداً.
        if ($case['expected'] === null) {
            $this->assertArrayNotHasKey('announcements', $out);
        }
    }

    /** @test */
    public function a_document_without_announcements_normalizes_exactly_as_before(): void
    {
        $normalizer = new StorefrontPresentationNormalizer;

        $this->assertArrayNotHasKey('announcements', $normalizer->normalize([]));
        $this->assertArrayNotHasKey('announcements', $normalizer->normalize(['version' => 2, 'themePreset' => 'navy']));
        $this->assertSame(StorefrontPresentationNormalizer::VERSION, 3, 'additive key: the schema version does not move');

        // idempotent: normalising a normalised document is a fixed point.
        $once = $normalizer->normalize(['announcements' => $this->fixture()['cases'][19]['input']]);
        $this->assertSame($once, $normalizer->normalize($once));
    }

    /** @test */
    public function contrast_maths_and_automatic_foreground_match_the_shared_cases(): void
    {
        foreach ($this->fixture()['contrast'] as $case) {
            $ratio = StorefrontPresentationPublishValidator::contrastRatio($case['fg'], $case['bg']);
            $this->assertEqualsWithDelta($case['ratio'], $ratio, 0.005, "{$case['fg']} on {$case['bg']}");
            $this->assertSame($case['passesNormalText'], $ratio >= StorefrontPresentationPublishValidator::MIN_TEXT_CONTRAST);
        }
        foreach ($this->fixture()['autoForeground'] as $case) {
            $this->assertSame($case['foreground'], StorefrontPresentationPublishValidator::autoForeground($case['background']), $case['background']);
        }
    }

    // ───────────────────────── publish gate (unit) ─────────────────────────

    /** @test */
    public function the_gate_agrees_with_the_shared_window_cases_on_what_is_publishable(): void
    {
        foreach ($this->fixture()['windows'] as $case) {
            if ($case['window'] === null) {
                continue;
            }
            $errors = $this->errorsFor(['window' => $case['window']]);
            $this->assertSame($case['publishable'], $errors === [], $case['name'].' → '.json_encode($errors));
        }
    }

    /** @param array<string,mixed> $item */
    private function errorsFor(array $item, bool $barEnabled = true): array
    {
        $normalizer = new StorefrontPresentationNormalizer;
        $config = $normalizer->normalize(['announcements' => ['enabled' => $barEnabled, 'items' => [$item + ['text' => 'نص']]]]);

        return (new StorefrontPresentationPublishValidator)->errors($config);
    }

    /** @test */
    public function the_gate_names_the_exact_path_and_a_stable_code_for_each_window_problem(): void
    {
        $e = $this->errorsFor(['window' => ['startsAt' => 'غداً']]);
        $this->assertSame('window_invalid_timestamp', $e['announcements.items[0].window.startsAt']['code']);

        $e = $this->errorsFor(['window' => ['endsAt' => '2026-13-45T00:00:00Z']]);
        $this->assertSame('window_invalid_timestamp', $e['announcements.items[0].window.endsAt']['code']);

        $e = $this->errorsFor(['window' => ['startsAt' => '2026-02-31T00:00:00Z']]);
        $this->assertArrayHasKey('announcements.items[0].window.startsAt', $e);

        $e = $this->errorsFor(['window' => ['startsAt' => '2026-10-07T00:00:00Z', 'endsAt' => '2026-10-06T00:00:00Z']]);
        $this->assertSame('window_end_not_after_start', $e['announcements.items[0].window.endsAt']['code']);

        $e = $this->errorsFor(['window' => ['startsAt' => '2026-10-06T10:00:00Z', 'endsAt' => '2026-10-06T10:00:00Z']]);
        $this->assertSame('window_end_not_after_start', $e['announcements.items[0].window.endsAt']['code']);

        // مقارنة بالتوقيت لا بالنص: 15:00+03:00 = 12:00Z.
        $this->assertSame([], $this->errorsFor(['window' => ['startsAt' => '2026-10-06T15:00:00+03:00', 'endsAt' => '2026-10-06T12:00:01Z']]));
        $this->assertSame([], $this->errorsFor(['window' => ['startsAt' => '2026-10-06T00:00:00Z']]));
        $this->assertSame([], $this->errorsFor(['window' => ['endsAt' => '2026-10-06T00:00:00.500Z']]));
        $this->assertSame([], $this->errorsFor([]));
    }

    /** @test */
    public function only_enabled_items_of_an_enabled_bar_can_block_publishing(): void
    {
        $bad = ['window' => ['startsAt' => 'غداً']];

        $this->assertNotSame([], $this->errorsFor($bad));
        $this->assertSame([], $this->errorsFor($bad + ['enabled' => false]), 'a disabled item renders nothing');
        $this->assertSame([], $this->errorsFor($bad, barEnabled: false), 'a disabled bar renders nothing');
    }

    /** @test */
    public function one_invalid_item_blocks_only_its_own_path(): void
    {
        $config = (new StorefrontPresentationNormalizer)->normalize(['announcements' => ['enabled' => true, 'items' => [
            ['id' => 'ok', 'text' => 'سليم'],
            ['id' => 'bad', 'text' => 'مشوَّه', 'window' => ['endsAt' => 'x']],
            ['id' => 'empty', 'text' => '   '],
        ]]]);

        $errors = (new StorefrontPresentationPublishValidator)->errors($config);

        $this->assertSame(['announcements.items[1].window.endsAt', 'announcements.items[2].text'], array_keys($errors));
        $this->assertSame('announcement_text_required', $errors['announcements.items[2].text']['code']);
    }

    /** @test */
    public function colours_below_4_5_to_1_are_rejected_for_text_and_link_independently(): void
    {
        $e = $this->errorsFor(['surface' => ['background' => ['hex' => '#ffffff'], 'text' => ['hex' => '#777777'], 'link' => ['hex' => '#767676']]]);

        $this->assertSame(['announcements.items[0].surface.text'], array_keys($e), '#777 fails (4.48), #767676 passes (4.54)');
        $this->assertSame('contrast_insufficient', $e['announcements.items[0].surface.text']['code']);

        $e = $this->errorsFor(['surface' => ['background' => ['hex' => '#d1456a'], 'text' => ['hex' => '#ffffff'], 'link' => ['hex' => '#ffffff']]]);
        $this->assertSame(['announcements.items[0].surface.text', 'announcements.items[0].surface.link'], array_keys($e));

        // خلفية بلا ألوان أمامية صريحة = تلقائي = دائماً مقبول (أي خلفية).
        $this->assertSame([], $this->errorsFor(['surface' => ['background' => ['hex' => '#d1456a']]]));
        $this->assertSame([], $this->errorsFor(['surface' => ['background' => ['hex' => '#1e3a5f'], 'text' => ['hex' => '#ffffff']]]));
    }

    // ───────────────────────── API: draft preserves, publish gates ─────────────────────────

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
    private function documentWith(array $announcements): array
    {
        return ['version' => 3, 'announcements' => $announcements];
    }

    /** @return array{id:string,version:string,revision:int} */
    private function draftVersion($token, string $storefrontId, array $announcements, string $name = 'نسخة'): array
    {
        $created = $token->postJson($this->base($storefrontId).'/versions', ['name' => $name])->assertCreated();
        $saved = $token->putJson($this->base($storefrontId).'/versions/'.$created->json('data.id'), [
            'config' => $this->documentWith($announcements),
            'revision' => $created->json('data.revision'),
        ])->assertOk();

        return ['id' => $storefrontId, 'version' => $created->json('data.id'), 'revision' => $saved->json('data.revision'), 'token' => $saved->json('data.schedule_token')];
    }

    private function invalidWindowBar(): array
    {
        return ['enabled' => true, 'items' => [
            ['id' => 'a', 'text' => 'صالح'],
            ['id' => 'b', 'text' => 'مشوَّه', 'window' => ['startsAt' => '2026-12-31T00:00:00Z', 'endsAt' => '2026-12-01T00:00:00Z']],
        ]];
    }

    /** @test */
    public function a_draft_save_preserves_exactly_what_the_merchant_entered_even_when_it_cannot_be_published(): void
    {
        $auth = $this->registerTenant('ann-draft', 'owner@ann-draft.test');
        $seed = $this->seedStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $v = $this->draftVersion($token, $seed['storefront']->id, $this->invalidWindowBar());

        $read = $token->getJson($this->base($seed['storefront']->id).'/versions/'.$v['version'])->assertOk();
        $this->assertSame('2026-12-01T00:00:00Z', $read->json('data.config.announcements.items.1.window.endsAt'));
        $this->assertSame('2026-12-31T00:00:00Z', $read->json('data.config.announcements.items.1.window.startsAt'));
    }

    /** @test */
    public function immediate_publish_is_rejected_with_a_path_specific_422_and_publishes_nothing(): void
    {
        $auth = $this->registerTenant('ann-pub-bad', 'owner@ann-pub-bad.test');
        $seed = $this->seedStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);
        $v = $this->draftVersion($token, $seed['storefront']->id, $this->invalidWindowBar());

        $res = $token->postJson($this->base($seed['storefront']->id).'/versions/'.$v['version'].'/publish', [
            'revision' => $v['revision'], 'expected_published_revision' => null, 'expected_active_version_id' => null,
        ])->assertStatus(422)->assertJsonPath('code', 'publish_validation_failed');

        $this->assertSame(['announcements.items[1].window.endsAt'], array_keys($res->json('errors')));
        $this->assertSame('window_end_not_after_start', $res->json('error_codes')['announcements.items[1].window.endsAt']);

        $head = StorefrontPresentation::withoutGlobalScopes()->where('storefront_id', $seed['storefront']->id)->first();
        $this->assertNull($head->published_config);
        $this->assertNull($head->active_version_id);
    }

    /** @test */
    public function fixing_the_window_makes_the_same_draft_publishable_and_the_snapshot_carries_the_bar(): void
    {
        $auth = $this->registerTenant('ann-pub-ok', 'owner@ann-pub-ok.test');
        $seed = $this->seedStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);
        $good = ['enabled' => true, 'items' => [['id' => 'a', 'text' => 'شحن مجاني', 'icon' => 'truck', 'window' => ['startsAt' => '2026-01-01T00:00:00Z', 'endsAt' => '2026-12-31T00:00:00Z']]], 'behaviour' => ['sticky' => true]];
        $v = $this->draftVersion($token, $seed['storefront']->id, $good);

        $token->postJson($this->base($seed['storefront']->id).'/versions/'.$v['version'].'/publish', [
            'revision' => $v['revision'], 'expected_published_revision' => null, 'expected_active_version_id' => null,
        ])->assertOk();

        $head = StorefrontPresentation::withoutGlobalScopes()->where('storefront_id', $seed['storefront']->id)->first();
        $this->assertSame('شحن مجاني', $head->published_config['announcements']['items'][0]['text']);
        $this->assertTrue($head->published_config['announcements']['behaviour']['sticky']);
    }

    /** @test */
    public function the_legacy_head_publish_applies_the_same_gate(): void
    {
        $auth = $this->registerTenant('ann-legacy', 'owner@ann-legacy.test');
        $seed = $this->seedStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        $show = $token->getJson($this->base($seed['storefront']->id))->assertOk();
        $saved = $token->putJson($this->base($seed['storefront']->id), [
            'config' => $this->documentWith($this->invalidWindowBar()),
            'draft_revision' => $show->json('data.draft_revision'),
        ])->assertOk();

        $token->postJson($this->base($seed['storefront']->id).'/publish', ['draft_revision' => $saved->json('data.draft_revision')])
            ->assertStatus(422)->assertJsonPath('code', 'publish_validation_failed');
    }

    /** @test */
    public function scheduling_rejects_an_unpublishable_document_now_instead_of_failing_at_midnight(): void
    {
        $auth = $this->registerTenant('ann-sched', 'owner@ann-sched.test');
        $seed = $this->seedStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);
        $v = $this->draftVersion($token, $seed['storefront']->id, $this->invalidWindowBar());

        $token->putJson($this->base($seed['storefront']->id).'/versions/'.$v['version'].'/schedule', [
            'revision' => $v['revision'],
            'scheduled_for' => Carbon::now('UTC')->addDay()->toIso8601String(),
            'expected_schedule_token' => $v['token'],
        ])->assertStatus(422)->assertJsonPath('code', 'publish_validation_failed');

        $head = StorefrontPresentation::withoutGlobalScopes()->where('storefront_id', $seed['storefront']->id)->first();
        $this->assertNull($head->scheduled_version_id);
    }

    /** @test */
    public function a_scheduled_publish_that_became_invalid_fails_closed_and_leaves_the_live_snapshot_intact(): void
    {
        $auth = $this->registerTenant('ann-dispatch', 'owner@ann-dispatch.test');
        $seed = $this->seedStorefront($auth['tenant_id']);
        $token = $this->withToken($auth['token']);

        // 1) نشر نسخة سليمة — هذا هو «الحيّ».
        $live = $this->draftVersion($token, $seed['storefront']->id, ['enabled' => true, 'items' => [['id' => 'live', 'text' => 'الحيّ']]], 'الحيّ');
        $token->postJson($this->base($seed['storefront']->id).'/versions/'.$live['version'].'/publish', [
            'revision' => $live['revision'], 'expected_published_revision' => null, 'expected_active_version_id' => null,
        ])->assertOk();

        // 2) نسخة ثانية سليمة تُجدوَل، ثم يتلف مستندها في القاعدة (كاتبٌ قديم/تعديلٌ خارجي).
        $next = $this->draftVersion($token, $seed['storefront']->id, ['enabled' => true, 'items' => [['id' => 'next', 'text' => 'القادم']]], 'القادم');
        $token->putJson($this->base($seed['storefront']->id).'/versions/'.$next['version'].'/schedule', [
            'revision' => $next['revision'],
            'scheduled_for' => Carbon::now('UTC')->addMinutes(10)->toIso8601String(),
            'expected_schedule_token' => $next['token'],
        ])->assertOk();
        $row = DB::table('storefront_presentation_versions')->where('id', $next['version'])->first();
        $config = json_decode($row->config, true);
        $config['announcements']['items'][0]['window'] = ['endsAt' => 'not-a-date'];
        DB::table('storefront_presentation_versions')->where('id', $next['version'])->update([
            'config' => json_encode($config, JSON_UNESCAPED_UNICODE),
            'scheduled_for' => Carbon::now('UTC')->subMinute(),
        ]);

        $summary = app(ScheduledPresentationDispatcher::class)->dispatchDueBatch();

        $this->assertSame(['due' => 1, 'published' => 0, 'skipped' => 1, 'failed' => 0], $summary);
        $head = StorefrontPresentation::withoutGlobalScopes()->where('storefront_id', $seed['storefront']->id)->first();
        $this->assertSame($live['version'], $head->active_version_id, 'the previous Published state is untouched');
        $this->assertSame('الحيّ', $head->published_config['announcements']['items'][0]['text']);
        $this->assertSame($next['version'], $head->scheduled_version_id, 'the schedule stays pending for the merchant to fix');
    }
}
