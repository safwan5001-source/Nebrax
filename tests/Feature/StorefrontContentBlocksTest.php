<?php

namespace Tests\Feature;

use App\Support\Commerce\StorefrontContentBlocksNormalizer;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use App\Support\Commerce\StorefrontPresentationPublishValidator;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

/**
 * CUST-HV V9c-1 — مفردات كتل المحتوى المشتركة لقسم `customContent` (V0 §15): الشكل المعتمد لكل كتلة، الحدود، القيم الافتراضية =
 * الغياب، توافق الوثائق القديمة، وعزل الوسائط/النص البديل لكل لغة للصور (حتى داخل الأعمدة) عبر البوابة العامة.
 * الحالات مشتركة مع توأمَي TS عبر `tests/Fixtures/presentation/content-blocks.json`.
 *
 * تشغيل: php artisan test --filter=StorefrontContentBlocksTest
 */
class StorefrontContentBlocksTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;
    use StorefrontMediaTestSupport;

    private const BASE = '/api/commerce/workspace/storefront-media';

    private int $uploads = 0;

    protected function tearDown(): void
    {
        app(TenantContext::class)->forget();
        parent::tearDown();
    }

    /** @return array<string,array{0:array<string,mixed>}> */
    public static function cases(): array
    {
        $fixture = json_decode((string) file_get_contents(__DIR__.'/../Fixtures/presentation/content-blocks.json'), true, 512, JSON_THROW_ON_ERROR);
        $cases = $fixture['cases'];

        return array_combine(array_column($cases, 'name'), array_map(static fn (array $c): array => [$c], $cases));
    }

    /** @return array<string,mixed> */
    private function document(mixed $content, bool $visible = true): array
    {
        return (new StorefrontPresentationNormalizer)->normalize([
            'version' => 2,
            'primaryColor' => '#12372a',
            'homepage' => ['sections' => [['id' => 'sec-a', 'type' => 'customContent', 'visible' => $visible, 'content' => $content]]],
        ]);
    }

    /**
     * @test
     *
     * @dataProvider cases
     *
     * @param  array<string,mixed>  $case
     */
    public function the_content_normalizes_like_the_shared_fixture(array $case): void
    {
        $section = collect($this->document($case['input'])['homepage']['sections'])->firstWhere('id', 'sec-a');
        $this->assertNotNull($section, 'the section itself survives');

        // الترتيب جزءٌ من العقد: التكافؤ الحرفي لا القيمي.
        $this->assertSame(
            json_encode($case['expected'], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            json_encode($section['content'] ?? null, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            $case['name'],
        );
        $this->assertSame(
            $section['content'] ?? null,
            collect($this->document($section['content'] ?? null)['homepage']['sections'])->firstWhere('id', 'sec-a')['content'] ?? null,
            'idempotent: '.$case['name'],
        );
    }

    /** @test */
    public function the_ceilings_and_closed_lists_are_the_contracts(): void
    {
        $this->assertSame(12, StorefrontContentBlocksNormalizer::MAX_BLOCKS);
        $this->assertSame(12, StorefrontPresentationNormalizer::MAX_CUSTOM_BLOCKS);
        $this->assertSame(4, StorefrontContentBlocksNormalizer::MAX_COLUMN_BLOCKS);
        $this->assertSame(
            ['heading', 'paragraph', 'image', 'button', 'divider', 'spacer', 'callout', 'columns'],
            StorefrontContentBlocksNormalizer::KINDS,
        );
        $this->assertSame(['outline', 'link'], StorefrontContentBlocksNormalizer::BUTTON_STYLES, 'solid is the absence; soft waits for the colour slice');
    }

    /** @test */
    public function a_document_without_any_new_kind_is_unchanged_by_the_new_vocabulary(): void
    {
        $legacy = ['blocks' => [
            ['id' => 'b1', 'kind' => 'heading', 'text' => 'About'],
            ['id' => 'b2', 'kind' => 'paragraph', 'text' => 'Text'],
        ]];

        $section = collect($this->document($legacy)['homepage']['sections'])->firstWhere('id', 'sec-a');

        $this->assertSame($legacy, $section['content']);
        $this->assertSame(3, $this->document($legacy)['version']);
    }

    // ─── integration: real uploads, tenant isolation, per-locale alt ───────────────────

    /** @return array<string,mixed> */
    private function uploadMedia(array $auth): array
    {
        $json = $this->withToken($auth['token'])
            ->post(self::BASE, ['files' => [$this->upload($this->jpegBytes(1600 + $this->uploads++, 900, null, ['left' => [10, 12, 14], 'right' => [40, 44, 60]]))]], ['Accept' => 'application/json'])
            ->json();
        $this->assertSame('created', $json['data'][0]['status'], json_encode($json));

        return $json['data'][0]['media'];
    }

    /** @return array{auth:array<string,mixed>,a:string} */
    private function tenantWithPicture(string $slug): array
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        $this->seedMediaStorefront($auth['tenant_id']);

        return ['auth' => $auth, 'a' => $this->uploadMedia($auth)['id']];
    }

    /** @return array<string,string> مسار → رمز */
    private function codes(array $document): array
    {
        return array_map(
            static fn (array $e): string => $e['code'],
            (new StorefrontPresentationPublishValidator)->errors($document),
        );
    }

    /** @test */
    public function an_image_block_publishes_with_alt_text_or_the_decorative_flag_even_inside_a_column(): void
    {
        $t = $this->tenantWithPicture('cb-ok');
        app(TenantContext::class)->set($t['auth']['tenant_id']);

        $doc = $this->document(['blocks' => [
            ['id' => 'i', 'kind' => 'image', 'media' => ['mediaId' => $t['a'], 'alt' => ['ar' => 'زهور', 'en' => 'Flowers']], 'caption' => 'Spring'],
            ['id' => 'c', 'kind' => 'columns', 'columns' => [[['id' => 'j', 'kind' => 'image', 'media' => ['mediaId' => $t['a'], 'decorative' => true]]], []]],
        ]]);

        $this->assertSame([], $this->codes($doc));
    }

    /** @test */
    public function an_image_block_without_alt_text_is_refused_per_locale_at_its_path_including_in_a_column(): void
    {
        $t = $this->tenantWithPicture('cb-alt');
        app(TenantContext::class)->set($t['auth']['tenant_id']);

        $codes = $this->codes($this->document(['blocks' => [
            ['id' => 'i', 'kind' => 'image', 'media' => ['mediaId' => $t['a']]],
            ['id' => 'c', 'kind' => 'columns', 'columns' => [[], [['id' => 'j', 'kind' => 'image', 'media' => ['mediaId' => $t['a'], 'alt' => ['ar' => 'نص']]]]]],
        ]]));

        $this->assertSame('alt_required_ar', $codes['homepage.sections.0.content.blocks.0.media.alt.ar'] ?? null);
        $this->assertSame('alt_required_en', $codes['homepage.sections.0.content.blocks.0.media.alt.en'] ?? null);
        $this->assertArrayNotHasKey('homepage.sections.0.content.blocks.1.columns.1.0.media.alt.ar', $codes);
        $this->assertSame('alt_required_en', $codes['homepage.sections.0.content.blocks.1.columns.1.0.media.alt.en'] ?? null);
    }

    /** @test */
    public function another_tenants_picture_in_a_block_is_missing_for_this_tenant(): void
    {
        $mine = $this->tenantWithPicture('cb-mine');
        $theirs = $this->tenantWithPicture('cb-theirs');
        app(TenantContext::class)->set($mine['auth']['tenant_id']);

        $codes = $this->codes($this->document(['blocks' => [
            ['id' => 'a', 'kind' => 'image', 'media' => ['mediaId' => $mine['a'], 'decorative' => true]],
            ['id' => 'c', 'kind' => 'columns', 'columns' => [[['id' => 'b', 'kind' => 'image', 'media' => ['mediaId' => $theirs['a'], 'decorative' => true]]], []]],
        ]]));

        $this->assertSame('media_missing', $codes['homepage.sections.0.content.blocks.1.columns.0.0.media.mediaId'] ?? null);
        $this->assertArrayNotHasKey('homepage.sections.0.content.blocks.0.media.mediaId', $codes);
    }

    /** @test */
    public function the_media_gate_judges_a_picture_wherever_it_is_even_in_a_hidden_section(): void
    {
        $t = $this->tenantWithPicture('cb-hidden');
        app(TenantContext::class)->set($t['auth']['tenant_id']);

        // الوسائط قاعدة وثيقة لا قاعدة قسمٍ ظاهر: الملكية والنص البديل تُحكَم أينما وُجد المرجع (يُظهر التاجر القسم لاحقاً بلا مفاجأة).
        $codes = $this->codes($this->document(['blocks' => [
            ['id' => 'i', 'kind' => 'image', 'media' => ['mediaId' => $t['a']]],
        ]], false));

        $this->assertSame('alt_required_ar', $codes['homepage.sections.0.content.blocks.0.media.alt.ar'] ?? null);
        $this->assertSame('alt_required_en', $codes['homepage.sections.0.content.blocks.0.media.alt.en'] ?? null);
    }
}
