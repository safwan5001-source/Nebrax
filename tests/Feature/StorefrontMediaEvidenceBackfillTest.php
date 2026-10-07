<?php

namespace Tests\Feature;

use App\Models\StorefrontMedia;
use App\Models\StorefrontMediaDerivative;
use App\Services\Commerce\StorefrontMediaEvidenceBackfiller;
use App\Services\Commerce\StorefrontMediaPixelEvidence;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Str;
use Mockery;
use Symfony\Component\Console\Command\Command;
use Tests\TestCase;

/**
 * CUST-HV V6b-1 — إكمال دليل البكسل للوسائط التي سبقت المرحلة: يقيس الملفات المُقدَّمة فعلاً، ضمن
 * مستأجرٍ واحد، محدود، idempotent، ويبقى فارغاً (fail-closed) ما تعذّر قياسه.
 *
 * تشغيل: php artisan test --filter=StorefrontMediaEvidenceBackfillTest
 */
class StorefrontMediaEvidenceBackfillTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use StorefrontMediaTestSupport;

    private const BASE = '/api/commerce/workspace/storefront-media';

    private int $uploads = 0;

    protected function tearDown(): void
    {
        Mockery::close();
        parent::tearDown();
    }

    /** @return array<string,mixed> */
    private function uploadMedia(array $auth): array
    {
        $json = $this->withToken($auth['token'])
            ->post(self::BASE, ['files' => [$this->upload($this->jpegBytes(1600 + $this->uploads++, 900))]], ['Accept' => 'application/json'])
            ->json();
        $this->assertSame('created', $json['data'][0]['status'], json_encode($json));

        return $json['data'][0]['media'];
    }

    private function asTenant(string $tenantId, callable $fn): mixed
    {
        $context = app(TenantContext::class);
        $context->set($tenantId);
        try {
            return $fn();
        } finally {
            $context->forget();
        }
    }

    /** @return array{auth:array<string,mixed>,id:string,original:array<string,mixed>} */
    private function legacyAsset(string $slug): array
    {
        $auth = $this->registerTenant($slug, "owner@{$slug}.test");
        $media = $this->uploadMedia($auth);
        $original = $this->asTenant($auth['tenant_id'], function () use ($media): array {
            $row = StorefrontMedia::findOrFail($media['id']);
            $evidence = $row->region_luminance;
            $row->forceFill(['region_luminance' => null])->save(); // مصنوعٌ قبل هذه المرحلة

            return $evidence;
        });

        return ['auth' => $auth, 'id' => $media['id'], 'original' => $original];
    }

    /** @test */
    public function it_measures_the_served_files_for_assets_and_derivatives_and_only_inside_the_given_tenant(): void
    {
        $this->fakeStorefrontMediaR2();
        $a = $this->legacyAsset('sfev-a');
        $b = $this->legacyAsset('sfev-b');

        $this->withToken($a['auth']['token'])->postJson(self::BASE.'/'.$a['id'].'/derivatives', [
            'transform' => ['crop' => ['x' => 0.25, 'y' => 0.1, 'w' => 0.5, 'h' => 0.5, 'aspect' => '16:9', 'zoom' => 1]],
            'retry' => false,
        ])->assertOk();
        $this->asTenant($a['auth']['tenant_id'], fn () => StorefrontMediaDerivative::query()->update(['region_luminance' => null]));

        $backfiller = app(StorefrontMediaEvidenceBackfiller::class);

        // dry-run: counts, writes nothing
        $this->assertSame(['assets' => 1, 'derivatives' => 8, 'failed' => 0, 'dry_run' => true], $backfiller->run($a['auth']['tenant_id'], 50, true));
        $this->assertNull($this->asTenant($a['auth']['tenant_id'], fn () => StorefrontMedia::findOrFail($a['id'])->region_luminance));

        $this->assertSame(['assets' => 1, 'derivatives' => 8, 'failed' => 0, 'dry_run' => false], $backfiller->run($a['auth']['tenant_id'], 50));

        $asset = $this->asTenant($a['auth']['tenant_id'], fn () => StorefrontMedia::findOrFail($a['id'])->region_luminance);
        $this->assertSame('frame', $asset['basis']);
        $bounds = StorefrontMediaPixelEvidence::bounds($asset);
        $this->assertNotNull($bounds);
        for ($i = 0; $i < 3; $i++) {
            // the measured served files + margin cover what the encoder was given
            $this->assertLessThanOrEqual($a['original']['min'][$i], $bounds['min'][$i]);
            $this->assertGreaterThanOrEqual($a['original']['max'][$i], $bounds['max'][$i]);
        }
        foreach ($this->asTenant($a['auth']['tenant_id'], fn () => StorefrontMediaDerivative::query()->get()) as $row) {
            $this->assertSame('transform', $row->region_luminance['basis']);
            $this->assertNotNull(StorefrontMediaPixelEvidence::bounds($row->region_luminance));
        }

        // idempotent: nothing left to do
        $this->assertSame(['assets' => 0, 'derivatives' => 0, 'failed' => 0, 'dry_run' => false], $backfiller->run($a['auth']['tenant_id'], 50));

        // tenant isolation: the other tenant's asset was never touched
        $this->assertNull($this->asTenant($b['auth']['tenant_id'], fn () => StorefrontMedia::findOrFail($b['id'])->region_luminance));
    }

    /** @test */
    public function an_unreadable_file_leaves_the_evidence_empty_and_is_reported(): void
    {
        $this->fakeStorefrontMediaR2();
        $a = $this->legacyAsset('sfev-missing');

        $file = $this->asTenant($a['auth']['tenant_id'], function () use ($a): string {
            $variants = StorefrontMedia::findOrFail($a['id'])->variantList();
            $widest = max(array_column($variants, 'width'));

            return (string) collect($variants)->first(fn (array $v): bool => $v['kind'] === 'w' && $v['width'] === $widest && $v['format'] === 'jpg')['file'];
        });
        unset($this->r2Objects["tenant/{$a['auth']['tenant_id']}/storefront-media/{$a['id']}/{$file}"]);

        $stats = app(StorefrontMediaEvidenceBackfiller::class)->run($a['auth']['tenant_id'], 50);
        $this->assertSame(1, $stats['failed']);
        $this->assertSame(0, $stats['assets']);
        $this->assertNull(
            $this->asTenant($a['auth']['tenant_id'], fn () => StorefrontMedia::findOrFail($a['id'])->region_luminance),
            'never a guessed or partial claim: unprovable stays unprovable',
        );
    }

    /** @test */
    public function the_command_requires_one_valid_tenant_and_a_bounded_limit(): void
    {
        $this->fakeStorefrontMediaR2();
        $auth = $this->registerTenant('sfev-cmd', 'owner@sfev-cmd.test');

        $this->artisan('storefront-media:backfill-evidence')->assertExitCode(Command::INVALID);
        $this->artisan('storefront-media:backfill-evidence', ['--tenant' => 'nope'])->assertExitCode(Command::INVALID);
        $this->artisan('storefront-media:backfill-evidence', ['--tenant' => (string) Str::uuid()])->assertExitCode(Command::FAILURE);
        $this->artisan('storefront-media:backfill-evidence', ['--tenant' => $auth['tenant_id'], '--limit' => 5000])->assertExitCode(Command::INVALID);
        $this->artisan('storefront-media:backfill-evidence', ['--tenant' => $auth['tenant_id'], '--dry-run' => true])->assertExitCode(Command::SUCCESS);
    }
}
