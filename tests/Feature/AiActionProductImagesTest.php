<?php

namespace Tests\Feature;

use App\Models\AiAction;
use App\Models\AiActionExecutionImage;
use App\Models\AiActionExecutionRow;
use App\Models\AiActionImage;
use App\Models\Invoice;
use App\Models\JournalEntry;
use App\Models\Product;
use App\Models\ProductActivity;
use App\Models\ProductMedia;
use App\Models\Role;
use App\Models\StockMovement;
use App\Services\ProductMediaService;
use App\Tenancy\TenantContext;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Http;
use Illuminate\Support\Facades\Storage;
use Tests\TestCase;
use ZipArchive;

/**
 * AI-ACTIONS-06: product images through the AI import — staged privately after validation, named in the
 * preview by content hash, attached only by the approved execution, one result per image.
 */
class AiActionProductImagesTest extends TestCase
{
    use RefreshDatabase;
    use InteractsWithApi;
    use InteractsWithAiProductActions;
    use InteractsWithWebhooks;

    protected function setUp(): void
    {
        parent::setUp();
        Storage::fake('local');
        config(['document_center.storage.driver' => 'local', 'document_center.storage.disk' => 'local']);
        // A deterministic resolver: example hosts are public, 10.x / localhost-like names are not.
        $this->bindWebhookValidator($this->fakeWebhookResolver(['internal.example' => ['10.0.0.5'], 'meta.example' => ['169.254.169.254']]));
    }

    private function png(int $rgb = 0xFF0000, int $size = 8): string
    {
        $image = imagecreatetruecolor($size, $size);
        imagefill($image, 0, 0, $rgb);
        ob_start();
        imagepng($image);

        return (string) ob_get_clean();
    }

    private function jpg(int $rgb = 0x00FF00): string
    {
        $image = imagecreatetruecolor(8, 8);
        imagefill($image, 0, 0, $rgb);
        ob_start();
        imagejpeg($image);

        return (string) ob_get_clean();
    }

    /** @param array<string,string> $entries */
    private function zip(array $entries, string $name = 'images.zip'): UploadedFile
    {
        $path = tempnam(sys_get_temp_dir(), 'ai-images-test-');
        if ($entries === []) {
            file_put_contents($path, "PK\x05\x06".str_repeat("\0", 18)); // a valid ZIP with no entries
        } else {
            $zip = new ZipArchive();
            $zip->open($path, ZipArchive::CREATE | ZipArchive::OVERWRITE);
            foreach ($entries as $entry => $bytes) {
                $zip->addFromString($entry, $bytes);
            }
            $zip->close();
        }

        return new UploadedFile($path, $name, 'application/zip', null, true);
    }

    /** @param array<string,string> $entries */
    private function stage(string $token, string $id, array $entries, int $version = 1, string $key = 'img-arch-0001')
    {
        return $this->withToken($token)->withHeader('Idempotency-Key', $key)
            ->post("/api/ai-actions/{$id}/image-archives", ['expected_version' => $version, 'archive' => $this->zip($entries)], ['Accept' => 'application/json']);
    }

    private function execute(string $token, string $id, int $version = 1, string $key = 'img-exec-0001')
    {
        return $this->withToken($token)->withHeader('Idempotency-Key', $key)->postJson("/api/ai-actions/{$id}/executions", ['expected_version' => $version]);
    }

    private function retry(string $token, string $id, string $execution, string $key = 'img-retry-0001')
    {
        return $this->withToken($token)->withHeader('Idempotency-Key', $key)->postJson("/api/ai-actions/{$id}/executions/{$execution}/retry");
    }

    private function review(string $token, string $id, int $version, array $edits, string $key = 'img-review-0001')
    {
        return $this->withToken($token)->withHeader('Idempotency-Key', $key)->postJson("/api/ai-actions/{$id}/review/versions", ['expected_version' => $version, 'edits' => $edits]);
    }

    /** @param array<string,string> $entries @return array{0:string,1:array<string,mixed>} */
    private function approvedWithImages(array $auth, array $rows, array $entries, string $key = 'img-act-0001'): array
    {
        $id = $this->makeAction($auth, $rows, $key);
        $this->stage($auth['token'], $id, $entries, 1, $key.'-zip')->assertCreated();
        $preview = $this->preview($auth['token'], $id, 1, $key.'-pv')->assertCreated()->json('data');
        $this->assertTrue($preview['approvable'], json_encode(array_map(fn ($r) => $r['issues'], $preview['rows'])));
        $this->approve($auth['token'], $id, $preview, 1, $key.'-ap')->assertCreated();

        return [$id, $preview];
    }

    private function assertNoAccountingOrStockEffect(): void
    {
        $this->assertSame(0, StockMovement::withoutGlobalScopes()->count());
        $this->assertSame(0, Invoice::withoutGlobalScopes()->count());
        $this->assertSame(0, JournalEntry::withoutGlobalScopes()->count());
        $this->assertSame(0, (int) Product::withoutGlobalScopes()->sum('quantity_on_hand'));
    }

    /** @test */
    public function matched_archive_images_are_staged_privately_and_named_in_the_preview_by_content_hash(): void
    {
        $auth = $this->registerTenant();
        $cover = $this->png(0xFF0000);
        $extra = $this->jpg(0x00FF00);
        $id = $this->makeAction($auth, [$this->good('a', 2, 'IMG-1')]);

        $staged = $this->stage($auth['token'], $id, ['IMG-1.png' => $cover, 'IMG-1__2.jpg' => $extra, 'unused.png' => $this->png(0x0000FF)])->assertCreated();
        $this->assertCount(3, $staged->json('data.archive'));
        // Staging is evidence only: nothing was attached and the action was not advanced.
        $this->assertSame(0, ProductMedia::withoutGlobalScopes()->count());
        $this->assertSame('created', AiAction::findOrFail($id)->status);

        $preview = $this->preview($auth['token'], $id)->assertCreated()->json('data');
        $row = $this->rows($preview)['a'];
        $this->assertSame('ready', $row['images']['status']);
        $this->assertSame(2, $row['images']['ready']);
        $this->assertTrue($row['images']['will_apply']);
        $items = $row['images']['items'];
        $this->assertSame(['primary', 'additional'], array_column($items, 'role'));
        $this->assertSame([hash('sha256', $cover), hash('sha256', $extra)], array_column(array_column($items, 'image'), 'sha256'));
        $this->assertSame(['IMG-1.png', 'IMG-1__2.jpg'], array_column(array_column($items, 'source'), 'label'));
        $this->assertSame('archive', $items[0]['source']['kind']);
        $this->assertSame(2, $preview['totals']['images']);
        // A file nobody claimed is reported, not silently dropped.
        $this->assertSame(['unused.png'], array_column($preview['images']['archive']['unmatched'], 'label'));
        $this->assertTrue($preview['approvable']);
        // The identity is part of the hash the approval binds: a different archive gives a different preview.
        $other = $this->makeAction($auth, [$this->good('a', 2, 'IMG-1')], 'img-act-other');
        $this->stage($auth['token'], $other, ['IMG-1.png' => $this->png(0x123456)], 1, 'img-arch-other')->assertCreated();
        $this->assertNotSame($preview['preview_hash'], $this->preview($auth['token'], $other, 1, 'img-pv-other')->assertCreated()->json('data.preview_hash'));
    }

    /** @test */
    public function thumbnails_are_authenticated_and_never_cross_tenants_or_actions(): void
    {
        $auth = $this->registerTenant();
        $other = $this->registerTenant('beta', 'owner@beta.test');
        $id = $this->makeAction($auth, [$this->good('a', 2, 'TH-1')]);
        $imageId = $this->stage($auth['token'], $id, ['TH-1.png' => $this->png()])->assertCreated()->json('data.archive.0.id');

        $thumb = $this->withToken($auth['token'])->get("/api/ai-actions/{$id}/images/{$imageId}/thumbnail");
        $thumb->assertOk()->assertHeader('X-Content-Type-Options', 'nosniff');
        $this->assertSame('image/png', $thumb->headers->get('Content-Type'));
        $this->assertNotSame('', $thumb->streamedContent());

        $this->withToken($auth['token'])->getJson("/api/ai-actions/{$id}/images/not-a-uuid/thumbnail")->assertNotFound();
        $this->flushHeaders()->getJson("/api/ai-actions/{$id}/images/{$imageId}/thumbnail")->assertUnauthorized();

        app(TenantContext::class)->set($other['tenant_id']);
        $this->enable($other['tenant_id']);
        $this->withToken($other['token'])->getJson("/api/ai-actions/{$id}/images/{$imageId}/thumbnail")->assertNotFound();
        $this->withToken($other['token'])->getJson("/api/ai-actions/{$id}/images")->assertNotFound();
        $this->stage($other['token'], $id, ['TH-1.png' => $this->png(0x111111)], 1, 'img-arch-x')->assertNotFound();

        // An image of another action in the same tenant is not reachable through this action's route.
        app(TenantContext::class)->set($auth['tenant_id']);
        $second = $this->makeAction($auth, [$this->good('a', 2, 'TH-2')], 'img-act-two');
        $this->withToken($auth['token'])->getJson("/api/ai-actions/{$second}/images/{$imageId}/thumbnail")->assertNotFound();

        // A role without the AI permission cannot read or stage images.
        $viewer = $this->customRole($auth['tenant_id'], 'noai', ['products.manage'], 'noai@acme.test');
        $this->withToken($viewer)->getJson("/api/ai-actions/{$id}/images/{$imageId}/thumbnail")->assertForbidden();
        $this->stage($viewer, $id, ['TH-1.png' => $this->png(0x222222)], 1, 'img-arch-y')->assertForbidden();
    }

    /** @test */
    public function the_approved_execution_attaches_exactly_the_approved_images_once_and_records_each_result(): void
    {
        $auth = $this->registerTenant();
        $cover = $this->png(0xFF0000);
        $extra = $this->jpg(0x00FF00);
        [$id, $preview] = $this->approvedWithImages($auth, [$this->good('a', 2, 'EX-IMG')], ['EX-IMG.png' => $cover, 'EX-IMG__2.jpg' => $extra]);
        $this->assertSame(0, ProductMedia::withoutGlobalScopes()->count(), 'approval attaches nothing');

        $execution = $this->execute($auth['token'], $id)->assertCreated()->json('data');
        $this->assertSame('completed', $execution['status']);
        $this->assertSame(['total' => 2, 'pending' => 0, 'success' => 2, 'failed' => 0, 'skipped' => 0, 'waiting_for_product' => 0], $execution['images']);
        $row = $execution['rows'][0];
        $this->assertSame(['success', 'success'], array_column($row['images'], 'status'));

        $product = Product::withoutGlobalScopes()->where('sku', 'EX-IMG')->firstOrFail();
        $media = ProductMedia::withoutGlobalScopes()->where('product_id', $product->id)->orderBy('sort_order')->get();
        $this->assertSame([hash('sha256', $cover), hash('sha256', $extra)], $media->pluck('content_sha256')->all());
        $this->assertSame([0, 1], $media->pluck('sort_order')->map(fn ($v) => (int) $v)->all());
        $this->assertEqualsCanonicalizing($media->pluck('id')->all(), array_column($row['images'], 'product_media_id'));
        $this->assertNoAccountingOrStockEffect();

        // Repeating the request, with the same or a new key, attaches nothing again.
        $this->execute($auth['token'], $id)->assertCreated()->assertHeader('Idempotency-Replayed', 'true');
        $this->execute($auth['token'], $id, 1, 'img-exec-0002')->assertOk();
        $this->assertSame(2, ProductMedia::withoutGlobalScopes()->where('product_id', $product->id)->count());
        $this->assertSame(2, AiActionExecutionImage::withoutGlobalScopes()->count());
        $this->assertSame(1, ProductActivity::withoutGlobalScopes()->where('action', 'created')->where('product_id', $product->id)->count());
    }

    /** @test */
    public function unsafe_archives_are_rejected_whole_and_stage_nothing(): void
    {
        $auth = $this->registerTenant();
        $id = $this->makeAction($auth, [$this->good('a', 2, 'SAFE-1')]);
        $png = $this->png();

        $cases = [
            'zip slip' => ['../SAFE-1.png' => $png],
            'absolute path' => ['/etc/SAFE-1.png' => $png],
            'drive path' => ['C:/SAFE-1.png' => $png],
            'script' => ['SAFE-1.php' => '<?php echo 1;'],
            'executable' => ['SAFE-1.exe' => 'MZ'],
            'text posing as an image' => ['SAFE-1.png' => 'this is not an image'],
            'wrong extension for the content' => ['SAFE-1.jpg' => $png],
            'duplicate names' => ['a/SAFE-1.png' => $png, 'b/safe-1.PNG' => $png],
            'one bad entry spoils all' => ['SAFE-1.png' => $png, 'SAFE-1__2.png' => 'nope'],
            'empty' => [],
        ];
        $n = 0;
        foreach ($cases as $label => $entries) {
            $n++;
            \Illuminate\Support\Facades\Cache::flush(); // the route is throttled; each case is its own scenario
            $this->stage($auth['token'], $id, $entries, 1, 'img-bad-'.$n)->assertStatus(422);
            $this->assertSame(0, AiActionImage::withoutGlobalScopes()->count(), $label);
        }
        $this->assertSame([], Storage::disk('local')->allFiles(), 'a rejected archive leaves no object behind');

        \Illuminate\Support\Facades\Cache::flush();
        config(['ai_actions.max_archive_images' => 1]);
        $this->stage($auth['token'], $id, ['SAFE-1.png' => $png, 'SAFE-1__2.png' => $this->png(0x00FF00)], 1, 'img-bad-big')->assertStatus(422)->assertJsonPath('error.code', 'image_archive_too_large');
        $this->stage($auth['token'], $id, ['SAFE-1.png' => $png], 1, 'img-bad-notzip-x');
        $notZip = $this->withToken($auth['token'])->withHeader('Idempotency-Key', 'img-bad-notzip')
            ->post("/api/ai-actions/{$id}/image-archives", ['expected_version' => 1, 'archive' => UploadedFile::fake()->createWithContent('images.zip', 'not a zip')], ['Accept' => 'application/json']);
        $notZip->assertStatus(422);
        $this->assertSame(1, AiActionImage::withoutGlobalScopes()->count(), 'only the one valid single-image archive was kept');
        $this->assertSame(0, ProductMedia::withoutGlobalScopes()->count());
    }

    /** @test */
    public function the_same_archive_is_idempotent_and_a_new_one_withdraws_an_existing_approval(): void
    {
        $auth = $this->registerTenant();
        [$id] = $this->approvedWithImages($auth, [$this->good('a', 2, 'IDEM-1')], ['IDEM-1.png' => $this->png(0xAA0000)]);
        $count = AiActionImage::withoutGlobalScopes()->count();

        $again = $this->stage($auth['token'], $id, ['IDEM-1.png' => $this->png(0xAA0000)], 1, 'img-arch-again');
        $again->assertCreated()->assertHeader('AI-Action-Images-Replayed', 'true');
        $this->assertSame($count, AiActionImage::withoutGlobalScopes()->count());
        $this->assertSame('approved', AiAction::findOrFail($id)->status, 'identical bytes change nothing');

        // Different bytes after approval: the earlier preview and approval no longer describe what would be applied.
        $this->stage($auth['token'], $id, ['IDEM-1.png' => $this->png(0xBB0000)], 1, 'img-arch-new')->assertCreated();
        $this->assertSame('editing', AiAction::findOrFail($id)->status);
        $this->execute($auth['token'], $id)->assertConflict();
        $this->assertSame(0, Product::withoutGlobalScopes()->count());
        $this->assertSame(0, ProductMedia::withoutGlobalScopes()->count());

        // Going back to the first picture set makes it the matched one again (the newest upload wins, always).
        $back = $this->stage($auth['token'], $id, ['IDEM-1.png' => $this->png(0xAA0000)], 1, 'img-arch-back')->assertCreated();
        $this->assertFalse($back->headers->has('AI-Action-Images-Replayed'));
        $this->assertSame([hash('sha256', $this->png(0xAA0000))], array_column($back->json('data.archive'), 'sha256'));
        $listed = $this->withToken($auth['token'])->getJson("/api/ai-actions/{$id}/images")->assertOk();
        $this->assertSame([hash('sha256', $this->png(0xAA0000))], array_column($listed->json('data.archive'), 'sha256'));
    }

    /** @test */
    public function a_staged_image_that_no_longer_matches_its_approved_hash_is_not_attached_and_the_product_still_saves(): void
    {
        $auth = $this->registerTenant();
        [$id] = $this->approvedWithImages($auth, [$this->good('a', 2, 'TAMP-1')], ['TAMP-1.png' => $this->png(0xAA0000)]);
        $staged = AiActionImage::withoutGlobalScopes()->firstOrFail();
        // The private object is swapped for another perfectly valid image after approval.
        Storage::disk('local')->put($staged->storage_key, $this->png(0x00AA00));

        $execution = $this->execute($auth['token'], $id)->assertCreated()->json('data');
        $this->assertSame('partially_failed', $execution['status']);
        $this->assertSame('success', $execution['rows'][0]['status'], 'the product is independent of its image');
        $this->assertSame('failed', $execution['rows'][0]['images'][0]['status']);
        $this->assertSame('image_changed', $execution['rows'][0]['images'][0]['error_code']);
        $this->assertFalse($execution['rows'][0]['images'][0]['retryable']);
        $this->assertNotNull(Product::withoutGlobalScopes()->where('sku', 'TAMP-1')->first());
        $this->assertSame(0, ProductMedia::withoutGlobalScopes()->count(), 'a failed image is never claimed as saved');
        $this->assertFalse($execution['permissions']['can_retry']);
        $this->assertSame('partially_failed', AiAction::findOrFail($id)->status);
    }

    /** @test */
    public function an_image_that_fails_after_its_product_saved_is_retried_alone(): void
    {
        $auth = $this->registerTenant();
        [$id] = $this->approvedWithImages($auth, [$this->good('a', 2, 'RET-1'), $this->good('b', 3, 'RET-2')], ['RET-1.png' => $this->png(0xAA0000), 'RET-2.png' => $this->png(0x00AA00)]);

        $real = app(ProductMediaService::class);
        $flaky = new class(app(\App\Services\ProductMediaDerivativeService::class), $real) extends ProductMediaService {
            public int $calls = 0;

            public function __construct(\App\Services\ProductMediaDerivativeService $derivatives, private ProductMediaService $inner) {}

            public function attachToProduct(Product $product, array $files, ?string $uploadedBy, bool $preventDuplicates = false): array
            {
                if (++$this->calls === 1) {
                    throw new \RuntimeException('تعذّر حفظ الصورة ومشتقاتها. تحقق من إعداد تخزين الملفات الدائم ثم أعد المحاولة.');
                }

                return $this->inner->attachToProduct($product, $files, $uploadedBy, $preventDuplicates);
            }
        };
        $this->app->instance(ProductMediaService::class, $flaky);

        $execution = $this->execute($auth['token'], $id)->assertCreated()->json('data');
        $this->assertSame('partially_failed', $execution['status']);
        $this->assertSame(['success', 'success'], array_column($execution['rows'], 'status'));
        $this->assertSame(1, $execution['images']['failed']);
        $this->assertSame(1, $execution['images']['success']);
        $this->assertSame(1, $execution['permissions']['retryable_images']);
        $this->assertTrue($execution['permissions']['can_retry']);
        $failed = collect($execution['rows'])->flatMap(fn ($r) => $r['images'])->firstWhere('status', 'failed');
        $this->assertSame('image_storage_failed', $failed['error_code']);
        $this->assertSame(1, ProductMedia::withoutGlobalScopes()->count());
        $productsBefore = Product::withoutGlobalScopes()->pluck('updated_at', 'id')->all();

        $retried = $this->retry($auth['token'], $id, $execution['id'])->assertOk()->json('data');
        $this->assertSame('completed', $retried['status']);
        $this->assertSame(['pending' => 0, 'success' => 2, 'failed' => 0], array_intersect_key($retried['images'], array_flip(['pending', 'success', 'failed'])));
        $this->assertSame(2, ProductMedia::withoutGlobalScopes()->count());
        // The products were not written again to repair an image.
        $this->assertSame(2, Product::withoutGlobalScopes()->count());
        $this->assertSame(2, ProductActivity::withoutGlobalScopes()->where('action', 'created')->count());
        $this->assertEquals($productsBefore, Product::withoutGlobalScopes()->pluck('updated_at', 'id')->all());
        $this->assertSame([1, 1], AiActionExecutionRow::withoutGlobalScopes()->orderBy('source_row')->pluck('attempts')->all());
        $this->assertSame('executed', AiAction::findOrFail($id)->status);
        $this->assertNoAccountingOrStockEffect();
    }

    /** @test */
    public function an_existing_products_gallery_is_never_changed_without_an_explicit_row_decision_and_is_only_appended_to(): void
    {
        $auth = $this->registerTenant();
        $existing = $this->product($auth['token'], ['name' => 'قائم', 'sku' => 'OLD-1']);
        $product = Product::withoutGlobalScopes()->findOrFail($existing['id']);
        $original = app(ProductMediaService::class)->attachToProduct($product, [UploadedFile::fake()->createWithContent('old.png', $this->png(0x777777))], null, true)[0];
        $new = $this->png(0xAA0000);
        $id = $this->makeAction($auth, [$this->row('u', 2, ['sku' => 'OLD-1'], 'update')]);
        $this->stage($auth['token'], $id, ['OLD-1.png' => $new])->assertCreated();

        // Without a decision: the image is listed, skipped with the reason, and nothing about the product changes.
        $preview = $this->preview($auth['token'], $id)->assertCreated()->json('data');
        $row = $this->rows($preview)['u'];
        $this->assertSame('needs_decision', $row['images']['status']);
        $this->assertSame('existing_product_needs_decision', $row['images']['items'][0]['code']);
        $this->assertContains('media_update_not_approved', $this->codes($row));
        $this->assertSame('skip', $row['operation'], 'no product change and no approved image: nothing to apply');

        // The explicit decision, then a fresh preview/approval.
        $edited = $this->review($auth['token'], $id, 1, [['row_id' => 'u', 'media_update_approved' => true]])->assertCreated();
        $this->assertSame(2, $edited->json('data.version'));
        $preview = $this->preview($auth['token'], $id, 2, 'img-pv-2')->assertCreated()->json('data');
        $row = $this->rows($preview)['u'];
        $this->assertSame('update', $row['operation']);
        $this->assertSame('ready', $row['images']['status']);
        $this->assertSame('append_existing', $row['images']['mode']);
        $this->assertSame(1, $row['images']['existing']['count']);
        $this->approve($auth['token'], $id, $preview, 2, 'img-ap-2')->assertCreated();

        $execution = $this->execute($auth['token'], $id, 2)->assertCreated()->json('data');
        $this->assertSame('completed', $execution['status']);
        $media = ProductMedia::withoutGlobalScopes()->where('product_id', $product->id)->orderBy('sort_order')->get();
        $this->assertCount(2, $media);
        $this->assertSame($original->id, $media[0]->id, 'the existing cover is untouched');
        $this->assertSame(hash('sha256', $this->png(0x777777)), $media[0]->content_sha256);
        $this->assertSame(hash('sha256', $new), $media[1]->content_sha256);
        $this->assertSame(0, ProductActivity::withoutGlobalScopes()->where('action', 'updated')->where('product_id', $product->id)->count(), 'an image-only update does not rewrite the product');
    }

    /** @test */
    public function an_image_already_on_the_product_is_not_duplicated_and_a_full_gallery_blocks_the_preview(): void
    {
        $auth = $this->registerTenant();
        $existing = $this->product($auth['token'], ['name' => 'قائم', 'sku' => 'FULL-1']);
        $product = Product::withoutGlobalScopes()->findOrFail($existing['id']);
        $same = $this->png(0x333333);
        app(ProductMediaService::class)->attachToProduct($product, [UploadedFile::fake()->createWithContent('same.png', $same)], null, true);
        $id = $this->makeAction($auth, [$this->row('u', 2, ['sku' => 'FULL-1', 'name' => 'اسم جديد'], 'update')]);
        $this->stage($auth['token'], $id, ['FULL-1.png' => $same])->assertCreated();
        $this->review($auth['token'], $id, 1, [['row_id' => 'u', 'media_update_approved' => true]])->assertCreated();

        $row = $this->rows($this->preview($auth['token'], $id, 2, 'img-pv-d')->assertCreated()->json('data'))['u'];
        $this->assertSame('already_attached', $row['images']['items'][0]['code']);
        $this->assertSame('skipped', $row['images']['items'][0]['status']);

        // Seven more distinct images fill the gallery (8); a ninth would exceed it.
        foreach (range(1, 7) as $i) {
            app(ProductMediaService::class)->attachToProduct($product, [UploadedFile::fake()->createWithContent("f{$i}.png", $this->png(0x400000 + $i))], null, true);
        }
        $other = $this->makeAction($auth, [$this->row('u', 2, ['sku' => 'FULL-1', 'name' => 'اسم جديد'], 'update')], 'img-act-full');
        $this->stage($auth['token'], $other, ['FULL-1.png' => $this->png(0xABCDEF)], 1, 'img-arch-full')->assertCreated();
        $this->review($auth['token'], $other, 1, [['row_id' => 'u', 'media_update_approved' => true]], 'img-review-full')->assertCreated();
        $preview = $this->preview($auth['token'], $other, 2, 'img-pv-full')->assertCreated()->json('data');
        $this->assertContains('too_many_images', $this->codes($this->rows($preview)['u']));
        $this->assertFalse($preview['approvable']);
    }

    /** @test */
    public function an_archive_image_cannot_silently_serve_two_rows(): void
    {
        $auth = $this->registerTenant();
        $id = $this->makeAction($auth, [
            $this->good('a', 2, 'AMB-1'),
            $this->good('b', 3, 'AMB-2', ['barcode' => 'AMB-1__2']),
        ]);
        $this->stage($auth['token'], $id, ['AMB-1__2.png' => $this->png()])->assertCreated();
        $preview = $this->preview($auth['token'], $id)->assertCreated()->json('data');
        $this->assertFalse($preview['approvable']);
        $this->assertContains('archive_image_ambiguous', $this->codes($this->rows($preview)['b']));
    }

    /** @test */
    public function remote_images_are_validated_before_any_request_and_fetched_only_when_the_platform_allows_it(): void
    {
        $auth = $this->registerTenant();
        Http::fake(['*' => Http::response($this->png(), 200, ['Content-Type' => 'image/png'])]);

        // Shipped dark: not a single request, and the row is only warned about.
        $id = $this->makeAction($auth, [$this->good('a', 2, 'URL-0', ['primary_image_url' => 'https://img.example/a.png'])]);
        $preview = $this->preview($auth['token'], $id)->assertCreated()->json('data');
        Http::assertNothingSent();
        $this->assertSame('unavailable', $this->rows($preview)['a']['images']['status']);
        $this->assertTrue($preview['approvable']);
        $this->assertSame(0, AiActionImage::withoutGlobalScopes()->count());

        config(['product_import_media.remote_enabled' => true]);
        $bad = $this->makeAction($auth, [
            $this->good('internal', 2, 'URL-1', ['primary_image_url' => 'https://internal.example/a.png']),
            $this->good('meta', 3, 'URL-2', ['primary_image_url' => 'https://meta.example/latest']),
            $this->good('loop', 4, 'URL-3', ['primary_image_url' => 'https://127.0.0.1/a.png']),
            $this->good('plain', 5, 'URL-4', ['primary_image_url' => 'http://img.example/a.png']),
            $this->good('creds', 6, 'URL-5', ['primary_image_url' => 'https://user:pw@img.example/a.png']),
            $this->good('junk', 7, 'URL-6', ['primary_image_url' => 'ftp://img.example/a.png']),
        ], 'img-act-ssrf');
        $preview = $this->preview($auth['token'], $bad, 1, 'img-pv-ssrf')->assertCreated()->json('data');
        $rows = $this->rows($preview);
        foreach (['internal', 'meta', 'loop', 'plain'] as $name) {
            $this->assertSame('image_url_blocked', $rows[$name]['images']['items'][0]['code'], $name);
            $this->assertSame('blocked', $rows[$name]['operation'], $name);
        }
        $this->assertContains('invalid_image_url', $this->codes($rows['creds']));
        $this->assertContains('invalid_image_url', $this->codes($rows['junk']));
        $this->assertFalse($preview['approvable']);
        Http::assertNothingSent();
        $this->assertSame(0, AiActionImage::withoutGlobalScopes()->count());
        $this->assertSame([], Storage::disk('local')->allFiles());
    }

    /** @test */
    public function a_remote_image_is_fetched_once_at_preview_time_and_executed_from_the_approved_bytes(): void
    {
        $auth = $this->registerTenant();
        config(['product_import_media.remote_enabled' => true]);
        $bytes = $this->png(0x445566);
        Http::fake(['img.example/*' => Http::response($bytes, 200, ['Content-Type' => 'image/png'])]);
        $id = $this->makeAction($auth, [$this->good('a', 2, 'URL-OK', ['primary_image_url' => 'https://img.example/pic.png?sig=secret-token'])]);

        $preview = $this->preview($auth['token'], $id)->assertCreated()->json('data');
        $item = $this->rows($preview)['a']['images']['items'][0];
        $this->assertSame('ready', $item['status']);
        $this->assertSame(hash('sha256', $bytes), $item['image']['sha256']);
        $this->assertSame('img.example/pic.png', $item['source']['label'], 'the label never carries the query string');
        $this->assertStringNotContainsString('secret-token', json_encode($preview));
        Http::assertSentCount(1);

        // The same preview twice does not fetch again; approval and execution never touch the network.
        $this->preview($auth['token'], $id, 1, 'img-pv-again')->assertOk(); // the identical preview is replayed
        $this->approve($auth['token'], $id, $preview, 1, 'img-ap-url')->assertCreated();
        $execution = $this->execute($auth['token'], $id)->assertCreated()->json('data');
        Http::assertSentCount(1);
        $this->assertSame('completed', $execution['status']);
        $this->assertSame([hash('sha256', $bytes)], ProductMedia::withoutGlobalScopes()->pluck('content_sha256')->all());
    }

    /** @test */
    public function a_remote_url_that_is_not_an_image_or_fails_blocks_the_preview(): void
    {
        $auth = $this->registerTenant();
        config(['product_import_media.remote_enabled' => true]);
        Http::fake([
            'html.example/*' => Http::response('<html>nope</html>', 200, ['Content-Type' => 'text/html']),
            'big.example/*' => Http::response(str_repeat('a', 6 * 1024 * 1024), 200, ['Content-Type' => 'image/png']),
            'gone.example/*' => Http::response('', 404),
            'redirect.example/*' => Http::response('', 302, ['Location' => 'https://127.0.0.1/a.png']),
        ]);
        $id = $this->makeAction($auth, [
            $this->good('html', 2, 'BAD-1', ['primary_image_url' => 'https://html.example/a.png']),
            $this->good('big', 3, 'BAD-2', ['primary_image_url' => 'https://big.example/a.png']),
            $this->good('gone', 4, 'BAD-3', ['primary_image_url' => 'https://gone.example/a.png']),
            $this->good('redir', 5, 'BAD-4', ['primary_image_url' => 'https://redirect.example/a.png']),
        ]);
        $preview = $this->preview($auth['token'], $id)->assertCreated()->json('data');
        $rows = $this->rows($preview);
        foreach (['html', 'big', 'gone', 'redir'] as $name) {
            $this->assertSame('error', $rows[$name]['images']['status'], $name);
            $this->assertSame('blocked', $rows[$name]['operation'], $name);
        }
        $this->assertFalse($preview['approvable']);
        $this->assertSame(0, AiActionImage::withoutGlobalScopes()->count());
        $this->assertSame([], Storage::disk('local')->allFiles());
        $this->approve($auth['token'], $id, $preview)->assertStatus(422);
    }

    /** @test */
    public function the_number_of_remote_fetches_per_preview_is_bounded(): void
    {
        $auth = $this->registerTenant();
        config(['product_import_media.remote_enabled' => true, 'ai_actions.max_remote_images_per_preview' => 2]);
        Http::fake(['img.example/*' => fn () => Http::response($this->png(random_int(1, 0xFFFFFF)), 200, ['Content-Type' => 'image/png'])]);
        $rows = [];
        foreach (range(1, 4) as $i) {
            $rows[] = $this->good("r{$i}", $i + 1, "LIM-{$i}", ['primary_image_url' => "https://img.example/{$i}.png"]);
        }
        $preview = $this->preview($auth['token'], $this->makeAction($auth, $rows))->assertCreated()->json('data');
        Http::assertSentCount(2);
        $this->assertSame(['ready', 'ready', 'error', 'error'], array_map(fn ($r) => $r['images']['status'], array_values($this->rows($preview))));
        $this->assertFalse($preview['approvable']);
    }

    /** @test */
    public function an_expired_approval_or_revoked_permission_attaches_nothing(): void
    {
        $auth = $this->registerTenant();
        [$id] = $this->approvedWithImages($auth, [$this->good('a', 2, 'EXP-1')], ['EXP-1.png' => $this->png()]);

        // Permission withdrawn between approval and execution.
        app(TenantContext::class)->set($auth['tenant_id']);
        Role::where('slug', 'owner')->update(['permissions' => ['ai.actions.use', 'ai.actions.approve']]);
        $this->execute($auth['token'], $id)->assertForbidden();
        $this->assertSame(0, Product::withoutGlobalScopes()->count());
        $this->assertSame(0, ProductMedia::withoutGlobalScopes()->count());
        Role::where('slug', 'owner')->update(['permissions' => ['*']]);

        $this->travel(config('ai_actions.approval_ttl_minutes') + 5)->minutes();
        $this->execute($auth['token'], $id, 1, 'img-exec-late')->assertConflict();
        $this->assertSame(0, Product::withoutGlobalScopes()->count());
        $this->assertSame(0, ProductMedia::withoutGlobalScopes()->count());
        $this->assertSame(0, AiActionExecutionImage::withoutGlobalScopes()->count());
    }

    /** @test */
    public function execution_stays_dark_by_default_and_images_follow_the_branch_of_the_action(): void
    {
        $this->assertFalse((bool) (require base_path('config/ai_actions.php'))['execution_enabled']);
        $auth = $this->registerTenant();
        [$id] = $this->approvedWithImages($auth, [$this->good('a', 2, 'BRN-1')], ['BRN-1.png' => $this->png()]);
        $branch = $this->withToken($auth['token'])->postJson('/api/branches', ['name' => 'فرع الخبر'])->assertCreated()['data']['id'];

        $this->execute($auth['token'], $id, 1, 'img-exec-br')->assertCreated()->assertJsonPath('data.status', 'completed');
        $this->withoutHeader('X-Branch-Id');
        app(\App\Tenancy\BranchContext::class)->forget();
        $mediaBranch = ProductMedia::withoutGlobalScopes()->value('product_id');
        $this->assertSame(AiAction::findOrFail($id)->branch_id, Product::withoutGlobalScopes()->whereKey($mediaBranch)->value('branch_id'));
        // Another branch's context cannot stage or read this action's images.
        $this->withToken($auth['token'])->withHeaders(['X-Branch-Id' => $branch])->getJson("/api/ai-actions/{$id}/images")->assertConflict()->assertJsonPath('error.code', 'branch_context_conflict');
    }

    /** @test */
    public function staged_images_and_their_results_are_immutable(): void
    {
        $auth = $this->registerTenant();
        [$id] = $this->approvedWithImages($auth, [$this->good('a', 2, 'IMM-1')], ['IMM-1.png' => $this->png()]);
        $this->execute($auth['token'], $id)->assertCreated();

        $image = AiActionImage::withoutGlobalScopes()->firstOrFail();
        $this->expectException(\LogicException::class);
        $image->forceFill(['content_sha256' => str_repeat('0', 64)])->save();
    }

    /** @test */
    public function a_finished_image_result_cannot_be_rewritten_or_deleted(): void
    {
        $auth = $this->registerTenant();
        [$id] = $this->approvedWithImages($auth, [$this->good('a', 2, 'IMM-2')], ['IMM-2.png' => $this->png()]);
        $this->execute($auth['token'], $id)->assertCreated();

        $result = AiActionExecutionImage::withoutGlobalScopes()->firstOrFail();
        $this->assertSame('success', $result->status);
        try {
            $result->forceFill(['status' => 'pending'])->save();
            $this->fail('A finished image result must be final.');
        } catch (\LogicException) {
            $this->assertSame('success', $result->fresh()->status);
        }
        $this->expectException(\LogicException::class);
        $result->delete();
    }
}
