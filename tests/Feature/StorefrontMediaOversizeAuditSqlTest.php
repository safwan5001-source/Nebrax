<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

/**
 * AWJ-ANIMATED-MEDIA P2-0 (review) — the READ-ONLY audit that tells the owner, before deploying the media proxy bound, whether any
 * already-generated Customizer media file is larger than the proxy accepts (8 MiB = 8388608 bytes) and would therefore answer 502.
 *
 * The SQL below is the exact text published in docs/reports/AWJ_ANIMATED_MEDIA_P2_0_REPORT.md (§9); this test executes it against
 * seeded rows on the real driver (PostgreSQL in the pgsql CI job — production's driver — and SQLite locally), so the published text is
 * known to run and to select exactly the oversized files. Both statements are SELECTs: nothing here (or in the report) writes data.
 *
 * تشغيل: php artisan test --filter=StorefrontMediaOversizeAuditSqlTest
 */
class StorefrontMediaOversizeAuditSqlTest extends TestCase
{
    use InteractsWithApi;
    use RefreshDatabase;

    private const BOUND = 8388608;

    /** Ladder + animated entries recorded in `storefront_media.variants` (json array of {file, bytes, …}). */
    private const PG_LADDER = <<<'SQL'
SELECT m.tenant_id, m.id AS media_id, v.item->>'file' AS file, (v.item->>'bytes')::bigint AS bytes
FROM storefront_media AS m
CROSS JOIN LATERAL json_array_elements(
    CASE WHEN json_typeof(m.variants) = 'array' THEN m.variants ELSE '[]'::json END
) AS v(item)
WHERE m.state = 'active'
  AND m.variants_state = 'ready'
  AND CASE WHEN (v.item->>'bytes') ~ '^[0-9]{1,15}$' THEN (v.item->>'bytes')::bigint END > 8388608
ORDER BY bytes DESC, m.tenant_id, m.id, file
SQL;

    /** Per-usage transform derivatives (one row per file; the proxy serves them under the 32-hex transform key). */
    private const PG_DERIVATIVES = <<<'SQL'
SELECT d.tenant_id, d.media_id, d.transform_key, d.width, d.format, d.bytes
FROM storefront_media_derivatives AS d
JOIN storefront_media AS m ON m.id = d.media_id
WHERE d.state = 'ready'
  AND m.state = 'active'
  AND d.bytes > 8388608
ORDER BY d.bytes DESC, d.tenant_id, d.media_id, d.transform_key
SQL;

    private const SQLITE_LADDER = <<<'SQL'
SELECT m.tenant_id, m.id AS media_id, json_extract(v.value, '$.file') AS file, json_extract(v.value, '$.bytes') AS bytes
FROM storefront_media AS m, json_each(CASE WHEN json_valid(m.variants) AND json_type(m.variants) = 'array' THEN m.variants ELSE '[]' END) AS v
WHERE m.state = 'active'
  AND m.variants_state = 'ready'
  AND json_type(v.value, '$.bytes') IN ('integer', 'real')
  AND json_extract(v.value, '$.bytes') > 8388608
ORDER BY bytes DESC, m.tenant_id, m.id, file
SQL;

    /** @param list<array{file:string,bytes:int|string|null}>|string|null $variants */
    private function media(string $tenantId, mixed $variants, string $state = 'active', string $variantsState = 'ready'): string
    {
        $id = (string) Str::uuid();
        DB::table('storefront_media')->insert([
            'id' => $id, 'tenant_id' => $tenantId, 'kind' => 'image', 'original_name' => 'a.png', 'mime' => 'image/png',
            'size' => 1000, 'sha256' => str_repeat('a', 64), 'width' => 1920, 'height' => 8192, 'storage_key' => 'k',
            'variants' => is_string($variants) || $variants === null ? $variants : json_encode($variants),
            'variants_state' => $variantsState, 'state' => $state, 'created_at' => now(), 'updated_at' => now(),
        ]);

        return $id;
    }

    private function derivative(string $tenantId, string $mediaId, int $bytes, string $state = 'ready', string $format = 'jpg'): string
    {
        $key = bin2hex(random_bytes(16));
        DB::table('storefront_media_derivatives')->insert([
            'id' => (string) Str::uuid(), 'tenant_id' => $tenantId, 'media_id' => $mediaId, 'usage_key' => bin2hex(random_bytes(16)),
            'transform_key' => $key, 'transform' => '{}', 'width' => 1920, 'format' => $format, 'bytes' => $bytes,
            'storage_key' => 'dk', 'state' => $state, 'created_at' => now(), 'updated_at' => now(),
        ]);

        return $key;
    }

    /** @return array{tenant:string, over:string, exact:string, justOver:string} */
    private function seedAuditRows(): array
    {
        $tenant = $this->registerTenant('audit', 'owner@audit.test')['tenant_id'];

        $over = $this->media($tenant, [
            ['file' => '480w.webp', 'bytes' => 90_000],
            ['file' => '1920w.jpg', 'bytes' => 10_770_000],   // the reproduced 10.27 MiB file
            ['file' => '1920w.webp', 'bytes' => 9_600_000],
        ]);
        $exact = $this->media($tenant, [['file' => '1920w.jpg', 'bytes' => self::BOUND]]);            // exactly the bound: accepted
        $justOver = $this->media($tenant, [['file' => '1920w.jpg', 'bytes' => self::BOUND + 1]]);     // one byte over: refused
        $this->media($tenant, [['file' => '1920w.jpg', 'bytes' => 7_000_000]]);                         // above the new 6 MiB ceiling, still served
        $this->media($tenant, [['file' => '1920w.jpg', 'bytes' => 20_000_000]], state: 'deleted');   // deleted: 404 anyway
        $this->media($tenant, [['file' => '1920w.jpg', 'bytes' => 20_000_000]], variantsState: 'failed');
        $this->media($tenant, null);                                                                   // SQL NULL variants
        $this->media($tenant, 'null');                                                                 // JSON null
        $this->media($tenant, '{"unexpected":"object"}');                                              // not an array
        $this->media($tenant, [['file' => '480w.webp'], ['file' => '768w.webp', 'bytes' => 'n/a']]);   // missing / non-numeric bytes

        return compact('tenant', 'over', 'exact', 'justOver');
    }

    /** @test */
    public function the_postgres_audit_selects_exactly_the_files_the_proxy_would_refuse(): void
    {
        if (DB::getDriverName() !== 'pgsql') {
            $this->markTestSkipped('PostgreSQL statement — runs in the pgsql CI job (production driver).');
        }
        $s = $this->seedAuditRows();
        $media = $this->media($s['tenant'], [['file' => '480w.webp', 'bytes' => 1000]]);
        $overKey = $this->derivative($s['tenant'], $media, 9_000_000);
        $this->derivative($s['tenant'], $media, self::BOUND);                       // at the bound: accepted
        $this->derivative($s['tenant'], $media, 12_000_000, state: 'failed');       // never served
        $deleted = $this->media($s['tenant'], [['file' => '480w.webp', 'bytes' => 1000]], state: 'deleted');
        $this->derivative($s['tenant'], $deleted, 12_000_000);                      // parent deleted: 404 anyway

        $ladder = DB::select(self::PG_LADDER);
        $this->assertSame(
            [[$s['over'], '1920w.jpg', 10_770_000], [$s['over'], '1920w.webp', 9_600_000], [$s['justOver'], '1920w.jpg', self::BOUND + 1]],
            array_map(static fn ($r): array => [$r->media_id, $r->file, (int) $r->bytes], $ladder),
        );
        $this->assertNotContains($s['exact'], array_column($ladder, 'media_id'), 'a file exactly at the bound is accepted by the proxy');

        $derivatives = DB::select(self::PG_DERIVATIVES);
        $this->assertCount(1, $derivatives);
        $this->assertSame($overKey, $derivatives[0]->transform_key);
        $this->assertSame(9_000_000, (int) $derivatives[0]->bytes);
    }

    /** @test */
    public function the_sqlite_audit_selects_the_same_ladder_files_locally(): void
    {
        if (DB::getDriverName() !== 'sqlite') {
            $this->markTestSkipped('SQLite statement — runs locally / in the sqlite CI job.');
        }
        $s = $this->seedAuditRows();

        $rows = DB::select(self::SQLITE_LADDER);
        $this->assertSame(
            [[$s['over'], '1920w.jpg', 10_770_000], [$s['over'], '1920w.webp', 9_600_000], [$s['justOver'], '1920w.jpg', self::BOUND + 1]],
            array_map(static fn ($r): array => [$r->media_id, $r->file, (int) $r->bytes], $rows),
        );
    }

    /** @test */
    public function the_audit_statements_are_read_only(): void
    {
        foreach ([self::PG_LADDER, self::PG_DERIVATIVES, self::SQLITE_LADDER] as $sql) {
            $this->assertMatchesRegularExpression('/\ASELECT\b/', ltrim($sql));
            $this->assertDoesNotMatchRegularExpression('/\b(INSERT|UPDATE|DELETE|DROP|ALTER|TRUNCATE|CREATE|GRANT)\b/i', $sql);
        }
    }
}
