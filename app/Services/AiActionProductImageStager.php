<?php

namespace App\Services;

use App\Models\AiAction;
use App\Models\AiActionEvent;
use App\Models\AiActionImage;
use App\Models\User;
use App\Services\DocumentCenter\DocumentStorageService;
use App\Support\AiActionException;
use App\Tenancy\TenantContext;
use Illuminate\Database\QueryException;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Intervention\Image\Interfaces\ImageManagerInterface;
use Throwable;

/**
 * AI-ACTIONS-06: brings candidate product images into private staging — and nowhere else.
 *
 * Every byte is validated BEFORE it is stored: a remote URL is checked (HTTPS, public DNS, no redirect)
 * before it is fetched, an archive entry is checked for traversal / size / compression / real content
 * before it is read out, and both go through the same content inspection the product gallery uses.
 * Nothing staged here is attached to a product, visible to a storefront, or reachable without the
 * action's own authorization. The content SHA-256 is the image's identity in the preview and the approval.
 */
final class AiActionProductImageStager
{
    public function __construct(
        private readonly ProductImageArchiveService $archives,
        private readonly ProductImageRemoteFetcher $remote,
        private readonly ProductImageInspector $inspector,
        private readonly DocumentStorageService $storage,
        private readonly ImageManagerInterface $images,
        private readonly AiActionGateway $gateway,
        private readonly AiActionApprovalLedger $ledger,
        private readonly TenantContext $tenantContext,
    ) {}

    public static function urlKey(string $url): string
    {
        return 'url:'.hash('sha256', $url);
    }

    /**
     * Stages every entry of an uploaded ZIP, or none: a single unsafe entry rejects the whole archive.
     *
     * @return array{images:list<AiActionImage>,replayed:bool}
     */
    public function stageArchive(User $requestActor, AiAction $action, int $expectedVersion, UploadedFile $archive): array
    {
        $actor = $this->gateway->authorizeFileIntake($requestActor, $action);
        if (strtolower((string) $archive->getClientOriginalExtension()) !== 'zip') {
            throw new AiActionException('image_archive_invalid', 'ارفع ملف ZIP يحتوي صور المنتجات.', 422);
        }
        $path = $archive->getRealPath();
        $archiveSha = $path === false ? false : hash_file('sha256', $path);
        if ($archiveSha === false) {
            throw new AiActionException('image_archive_invalid', 'تعذر قراءة ملف ZIP المرفوع.', 422);
        }

        try {
            $manifest = $this->archives->manifest($archive);
        } catch (Throwable $e) {
            throw new AiActionException('image_archive_invalid', mb_substr($e->getMessage(), 0, 300), 422);
        }
        if ($manifest === []) {
            throw new AiActionException('image_archive_empty', 'لا يحتوي ملف ZIP على أي صورة.', 422);
        }
        // The same pictures re-zipped (different bytes, same names and content hashes) are not new evidence.
        $signature = $this->signature(array_map(static fn (array $e): array => [$e['name'], $e['sha256']], $manifest));
        $current = $this->currentArchive($action);
        if ($current->isNotEmpty() && $this->archiveSignature($current) === $signature) {
            return ['images' => $current->sortBy('source_label')->values()->all(), 'replayed' => true];
        }
        if (count($manifest) > max(1, (int) config('ai_actions.max_archive_images', 200))) {
            throw new AiActionException('image_archive_too_large', 'عدد الصور في ZIP يتجاوز الحد المسموح لعملية واحدة؛ قسّمها على أكثر من عملية.', 422);
        }

        $written = [];
        $rows = [];
        try {
            foreach ($manifest as $entry) {
                $file = $this->archives->materialize($archive, (int) $entry['index'], (string) $entry['name']);
                try {
                    $inspected = $this->inspector->inspect($file);
                    if ($inspected->sha256 !== $entry['sha256']) {
                        throw new AiActionException('image_archive_invalid', "تغيّر محتوى الصورة {$entry['name']} أثناء المعالجة.", 422);
                    }
                    $rows[] = $this->persistBytes($action, $file, $inspected, [
                        'source_kind' => AiActionImage::KIND_ARCHIVE,
                        'source_key' => 'archive:'.substr($archiveSha, 0, 16).':'.sha1(mb_strtolower((string) $entry['name'], 'UTF-8')),
                        'source_label' => mb_substr((string) $entry['name'], 0, 255),
                        'archive_sha256' => $archiveSha,
                    ], $actor, $written);
                } finally {
                    if (is_file((string) $file->getRealPath())) {
                        @unlink((string) $file->getRealPath());
                    }
                }
            }

            $images = DB::transaction(function () use ($action, $expectedVersion, $actor, $rows, $archiveSha, $signature): array {
                $locked = AiAction::query()->whereKey($action->id)->lockForUpdate()->firstOrFail();
                if (! in_array($locked->status, AiAction::MUTABLE_STATUSES, true)) {
                    throw new AiActionException('state_conflict', 'لا تقبل العملية صوراً في حالتها الحالية.', 409);
                }
                if ($locked->version !== $expectedVersion) {
                    throw new AiActionException('version_conflict', 'تغيّرت المسودة. حدّثها قبل رفع الصور.', 409);
                }
                // A concurrent request may have staged the very same set while this one waited for the lock.
                $current = $this->currentArchive($locked);
                if ($current->isNotEmpty() && $this->archiveSignature($current) === $signature) {
                    throw new AiActionException('image_archive_replayed', 'سبق رفع هذا الأرشيف.', 409);
                }
                $saved = [];
                $seq = ((int) AiActionImage::query()->where('ai_action_id', $locked->id)->max('archive_seq')) + 1;
                foreach ($rows as $row) {
                    $saved[] = $this->make(['source_key' => 'archive:'.$seq.':'.sha1(mb_strtolower($row['source_label'], 'UTF-8'))] + $row + ['ai_action_id' => $locked->id, 'created_by' => $actor->id, 'archive_seq' => $seq]);
                }
                // New image evidence changes what any earlier preview described: withdraw it and its approval.
                $from = $locked->status;
                if (in_array($from, [AiAction::STATUS_READY_FOR_APPROVAL, AiAction::STATUS_APPROVED, AiAction::STATUS_EXPIRED], true)) {
                    $this->ledger->invalidate($locked, $actor, 'image_source_changed');
                    $locked->forceFill(['status' => AiAction::STATUS_EDITING])->save();
                }
                AiActionEvent::create([
                    'ai_action_id' => $locked->id, 'version' => $locked->version, 'event' => 'product_images_staged',
                    'from_status' => $from, 'to_status' => $locked->status, 'actor_id' => $actor->id,
                    'metadata' => ['archive_sha256' => $archiveSha, 'images' => count($saved)], 'occurred_at' => now('UTC'),
                ]);

                return $saved;
            }, 3);
        } catch (AiActionException $e) {
            $this->discard($written);
            if ($e->reason === 'image_archive_replayed') {
                return ['images' => $this->currentArchive($action)->sortBy('source_label')->values()->all(), 'replayed' => true];
            }
            throw $e;
        } catch (Throwable $e) {
            $this->discard($written);
            report($e);
            throw new AiActionException('image_archive_failed', 'تعذر حفظ صور الأرشيف؛ لم تُحفظ أي صورة. أعد المحاولة.', 500);
        }

        return ['images' => $images, 'replayed' => false];
    }

    /**
     * Fetches (when the platform allows it) and stages the remote images a preview is about to name.
     * Called outside any transaction. A URL is never requested unless it passed the SSRF check first.
     *
     * @param  list<string>  $urls
     * @return array<string,array{status:string,image:?AiActionImage,code:?string,message:?string}> by `urlKey()`
     */
    public function stageUrls(User $actor, AiAction $action, array $urls): array
    {
        $outcomes = [];
        $known = AiActionImage::query()->where('ai_action_id', $action->id)->where('source_kind', AiActionImage::KIND_URL)->get()->keyBy('source_key');
        $budget = max(0, (int) config('ai_actions.max_remote_images_per_preview', 20));
        foreach (array_values(array_unique($urls)) as $url) {
            $key = self::urlKey($url);
            if ($known->has($key)) {
                $outcomes[$key] = ['status' => 'ready', 'image' => $known[$key], 'code' => null, 'message' => null];
                continue;
            }
            if (config('product_import_media.remote_enabled') !== true) {
                $outcomes[$key] = ['status' => 'unavailable', 'image' => null, 'code' => 'remote_fetch_disabled', 'message' => 'جلب الصور من روابط خارجية غير مفعّل على المنصة؛ لن تُطبَّق هذه الصورة.'];
                continue;
            }
            if ($budget === 0) {
                $outcomes[$key] = ['status' => 'error', 'image' => null, 'code' => 'remote_fetch_limit', 'message' => 'تجاوزت المعاينة حد الصور الخارجية المسموح في المرة الواحدة؛ قسّم الملف أو استخدم أرشيف ZIP.'];
                continue;
            }
            $budget--;
            $outcomes[$key] = $this->fetchAndStage($actor, $action, $url, $key);
        }

        return $outcomes;
    }

    /**
     * Read-only picture of the staged evidence for an action: by source key, plus the entries of the most
     * recently uploaded archive (older archives stay as history and are never matched again).
     *
     * @return array{by_key:array<string,array<string,mixed>>,archive:list<array<string,mixed>>}
     */
    public function catalog(AiAction $action): array
    {
        $rows = AiActionImage::query()->where('ai_action_id', $action->id)->orderBy('created_at')->orderBy('id')->get();
        $byKey = [];
        foreach ($rows as $row) {
            $byKey[$row->source_key] = $this->describe($row);
        }
        $archive = $this->latestArchive($rows)
            ->sortBy('source_label')->map(fn (AiActionImage $r): array => $this->describe($r) + ['lookup' => mb_strtolower(pathinfo($r->source_label, PATHINFO_FILENAME), 'UTF-8')])->values()->all();

        return ['by_key' => $byKey, 'archive' => $archive];
    }

    /** @param list<array{0:string,1:string}> $pairs */
    private function signature(array $pairs): string
    {
        usort($pairs, static fn (array $a, array $b): int => [mb_strtolower($a[0], 'UTF-8'), $a[1]] <=> [mb_strtolower($b[0], 'UTF-8'), $b[1]]);

        return hash('sha256', json_encode(array_map(static fn (array $p): array => [mb_strtolower($p[0], 'UTF-8'), $p[1]], $pairs), JSON_UNESCAPED_UNICODE));
    }

    /** @param \Illuminate\Support\Collection<int,AiActionImage> $rows */
    private function archiveSignature($rows): string
    {
        return $this->signature($rows->map(fn (AiActionImage $r): array => [$r->source_label, $r->content_sha256])->all());
    }

    /** @return \Illuminate\Support\Collection<int,AiActionImage> the entries of the most recently staged archive */
    private function currentArchive(AiAction $action): \Illuminate\Support\Collection
    {
        return $this->latestArchive(AiActionImage::query()->where('ai_action_id', $action->id)->orderBy('created_at')->orderBy('id')->get());
    }

    /**
     * @param  \Illuminate\Support\Collection<int,AiActionImage>  $rows  oldest first
     * @return \Illuminate\Support\Collection<int,AiActionImage>
     */
    private function latestArchive($rows): \Illuminate\Support\Collection
    {
        $archives = $rows->filter(fn (AiActionImage $r): bool => $r->source_kind === AiActionImage::KIND_ARCHIVE);
        $seq = $archives->max('archive_seq');

        return $seq === null ? collect() : $archives->filter(fn (AiActionImage $r): bool => $r->archive_seq === $seq)->values();
    }

    /** @return array{stream:resource,mime:string} */
    public function thumbnail(User $requestActor, AiAction $action, string $imageId): array
    {
        $this->gateway->authorizeFileIntake($requestActor, $action);
        $image = Str::isUuid($imageId) ? AiActionImage::query()->where('ai_action_id', $action->id)->whereKey($imageId)->first() : null;
        if ($image === null || $image->thumb_key === null) {
            throw new AiActionException('image_not_found', 'الصورة غير موجودة لهذه العملية.', 404);
        }
        try {
            return ['stream' => $this->storage->readStream($image->storage_profile, $image->thumb_key), 'mime' => (string) $image->thumb_mime];
        } catch (Throwable) {
            throw new AiActionException('image_unavailable', 'تعذر قراءة الصورة المصغّرة.', 404);
        }
    }

    /**
     * Copies a staged image out of private storage into a temp file for attachment. The caller proves the
     * bytes still hash to the approved identity before using them.
     */
    public function materialize(AiActionImage $image): UploadedFile
    {
        $tmp = tempnam(sys_get_temp_dir(), 'ai-staged-image-');
        if ($tmp === false) {
            throw new \RuntimeException('تعذّر إنشاء ملف مؤقت للصورة.');
        }
        $target = fopen($tmp, 'wb');
        $stream = null;
        try {
            $stream = $this->storage->readStream($image->storage_profile, $image->storage_key);
            if (! is_resource($target) || stream_copy_to_stream($stream, $target, ProductImageInspector::MAX_BYTES + 1) === false) {
                throw new \RuntimeException('تعذّر نسخ الصورة المجهّزة.');
            }
        } catch (Throwable $e) {
            if (is_resource($target)) fclose($target);
            @unlink($tmp);
            throw $e;
        } finally {
            if (is_resource($stream)) fclose($stream);
        }
        fclose($target);

        return new UploadedFile($tmp, 'staged.'.$image->extension, $image->mime_type, null, true);
    }

    /** @return array{status:string,image:?AiActionImage,code:?string,message:?string} */
    private function fetchAndStage(User $actor, AiAction $action, string $url, string $key): array
    {
        try {
            $this->remote->validateUrl($url);
        } catch (Throwable $e) {
            return ['status' => 'error', 'image' => null, 'code' => 'image_url_blocked', 'message' => 'رابط الصورة مرفوض أمنياً (يلزم HTTPS وعنوان عام بلا اعتمادات)؛ لم يُطلب.'];
        }

        $file = null;
        try {
            try {
                $file = $this->remote->fetch($url);
            } catch (Throwable $e) {
                return ['status' => 'error', 'image' => null, 'code' => 'image_fetch_failed', 'message' => mb_substr($e->getMessage(), 0, 300)];
            }
            try {
                $inspected = $this->inspector->inspect($file);
            } catch (Throwable $e) {
                return ['status' => 'error', 'image' => null, 'code' => 'image_invalid', 'message' => mb_substr($e->getMessage(), 0, 300)];
            }

            $written = [];
            try {
                $attributes = $this->persistBytes($action, $file, $inspected, [
                    'source_kind' => AiActionImage::KIND_URL, 'source_key' => $key, 'source_label' => $this->label($url), 'archive_sha256' => null,
                ], $actor, $written);
                $image = $this->make($attributes + ['ai_action_id' => $action->id, 'created_by' => $actor->id]);
            } catch (QueryException $e) {
                $this->discard($written);
                $image = AiActionImage::query()->where('ai_action_id', $action->id)->where('source_key', $key)->first();
                if ($image === null) {
                    throw $e;
                }
            } catch (AiActionException $e) {
                $this->discard($written);

                return ['status' => 'error', 'image' => null, 'code' => 'image_invalid', 'message' => $e->getMessage()];
            }

            return ['status' => 'ready', 'image' => $image, 'code' => null, 'message' => null];
        } finally {
            if ($file instanceof UploadedFile && is_file((string) $file->getRealPath())) {
                @unlink((string) $file->getRealPath());
            }
        }
    }

    /**
     * Writes the validated bytes and a thumbnail to private storage and returns the row attributes. A
     * picture that cannot be decoded for a thumbnail would also fail the gallery derivatives, so it is rejected here.
     *
     * @param  array<string,mixed>  $source
     * @param  list<array{0:string,1:string}>  $written  (profile, key) pairs, for clean-up on failure
     * @return array<string,mixed>
     */
    private function persistBytes(AiAction $action, UploadedFile $file, \App\Support\InspectedProductImage $inspected, array $source, User $actor, array &$written): array
    {
        $path = (string) $file->getRealPath();
        $thumb = $this->thumbnailBytes($path, $inspected->mimeType);
        $profile = $this->storage->profile();
        $id = (string) Str::uuid();
        $base = sprintf('ai-actions/%s/%s/images/%s', $this->tenantContext->id(), $action->id, $id);
        $key = "{$base}.{$inspected->extension}";
        $thumbKey = "{$base}.thumb.{$inspected->extension}";

        $stream = fopen($path, 'rb');
        if ($stream === false) {
            throw new AiActionException('image_unreadable', 'تعذر قراءة الصورة.', 422);
        }
        try {
            $this->storage->put($profile, $key, $stream);
            $written[] = [$profile, $key];
        } finally {
            fclose($stream);
        }
        $thumbStream = fopen('php://temp', 'r+b');
        fwrite($thumbStream, $thumb);
        rewind($thumbStream);
        try {
            $this->storage->put($profile, $thumbKey, $thumbStream);
            $written[] = [$profile, $thumbKey];
        } finally {
            fclose($thumbStream);
        }

        return $source + [
            'id' => $id, 'content_sha256' => $inspected->sha256, 'mime_type' => $inspected->mimeType, 'extension' => $inspected->extension,
            'size_bytes' => $inspected->size, 'width' => $inspected->width, 'height' => $inspected->height,
            'storage_profile' => $profile, 'storage_key' => $key, 'thumb_key' => $thumbKey, 'thumb_mime' => $inspected->mimeType,
        ];
    }

    private function thumbnailBytes(string $path, string $mime): string
    {
        $edge = max(32, (int) config('ai_actions.image_thumbnail_px', 256));
        try {
            $image = $this->images->decodePath($path);
            $image->orient()->scaleDown(width: $edge, height: $edge);

            return (string) match ($mime) {
                'image/jpeg' => $image->encodeUsingMediaType('image/jpeg', 80),
                'image/webp' => $image->encodeUsingMediaType('image/webp', 78),
                default => $image->encodeUsingMediaType('image/png'),
            };
        } catch (Throwable) {
            throw new AiActionException('image_invalid', 'تعذّر فك محتوى الصورة لإنشاء معاينتها المصغّرة.', 422);
        }
    }

    /**
     * AI-ACTIONS-06B: gives a repair action its own private copy of the images its rows named (bytes copied, not shared),
     * under the same content hashes, so the repair's preview identifies exactly the pictures the original did. The caller
     * discards `$written` if anything later fails.
     *
     * @param  list<string>  $imageIds
     * @param  list<array{0:string,1:string}>  $written
     */
    public function copyBetween(AiAction $from, AiAction $to, array $imageIds, User $actor, array &$written): int
    {
        $copied = 0;
        $profile = $this->storage->profile();
        foreach (AiActionImage::query()->where('ai_action_id', $from->id)->whereIn('id', array_values(array_unique($imageIds)))->orderBy('id')->get() as $image) {
            $id = (string) Str::uuid();
            $base = sprintf('ai-actions/%s/%s/images/%s', $this->tenantContext->id(), $to->id, $id);
            $key = "{$base}.{$image->extension}";
            $thumbKey = $image->thumb_key === null ? null : "{$base}.thumb.{$image->extension}";
            // Only bytes that still hash to the recorded identity are carried over: a corrupted object is not
            // re-blessed, the repair simply lacks that image and the reviewer supplies it again.
            $original = $this->readAll($image->storage_profile, $image->storage_key);
            if ($original === null || ! hash_equals($image->content_sha256, hash('sha256', $original))) {
                continue;
            }
            $thumbBytes = $image->thumb_key === null ? null : $this->readAll($image->storage_profile, $image->thumb_key);
            foreach ([[$original, $key], [$thumbBytes, $thumbKey]] as [$bytes, $target]) {
                if ($bytes === null || $target === null) {
                    continue;
                }
                $stream = fopen('php://temp', 'r+b');
                fwrite($stream, $bytes);
                rewind($stream);
                try {
                    $this->storage->put($profile, $target, $stream);
                    $written[] = [$profile, $target];
                } finally {
                    fclose($stream);
                }
            }
            $isArchive = $image->source_kind === AiActionImage::KIND_ARCHIVE;
            $this->make([
                'id' => $id, 'ai_action_id' => $to->id, 'source_kind' => $image->source_kind,
                'source_key' => $isArchive ? 'archive:1:'.sha1(mb_strtolower($image->source_label, 'UTF-8')) : $image->source_key,
                'source_label' => $image->source_label, 'archive_sha256' => $image->archive_sha256, 'archive_seq' => $isArchive ? 1 : null,
                'content_sha256' => $image->content_sha256, 'mime_type' => $image->mime_type, 'extension' => $image->extension,
                'size_bytes' => $image->size_bytes, 'width' => $image->width, 'height' => $image->height,
                'storage_profile' => $profile, 'storage_key' => $key, 'thumb_key' => $thumbBytes === null ? null : $thumbKey, 'thumb_mime' => $thumbBytes === null ? null : $image->thumb_mime,
                'created_by' => $actor->id,
            ]);
            $copied++;
        }

        return $copied;
    }

    private function readAll(string $profile, string $key): ?string
    {
        try {
            $stream = $this->storage->readStream($profile, $key);
        } catch (Throwable) {
            return null;
        }
        try {
            $bytes = stream_get_contents($stream, ProductImageInspector::MAX_BYTES + 1);
        } finally {
            fclose($stream);
        }

        return is_string($bytes) && strlen($bytes) <= ProductImageInspector::MAX_BYTES ? $bytes : null;
    }

    /** @param list<array{0:string,1:string}> $written */
    public function discardObjects(array $written): void
    {
        $this->discard($written);
    }

    /** @param array<string,mixed> $attributes */
    private function make(array $attributes): AiActionImage
    {
        $image = new AiActionImage();
        $image->forceFill($attributes)->save();

        return $image;
    }

    /** @param list<array{0:string,1:string}> $written */
    private function discard(array $written): void
    {
        foreach ($written as [$profile, $key]) {
            try { $this->storage->delete($profile, $key); } catch (Throwable) {}
        }
    }

    private function label(string $url): string
    {
        $parts = parse_url($url) ?: [];

        // Host and path only: a query string can carry a signed token and never belongs in an audit-visible label.
        return mb_substr(((string) ($parts['host'] ?? '')).((string) ($parts['path'] ?? '')), 0, 255);
    }

    /** @return array<string,mixed> */
    private function describe(AiActionImage $row): array
    {
        return [
            'id' => $row->id, 'kind' => $row->source_kind, 'source_key' => $row->source_key, 'label' => $row->source_label,
            'sha256' => $row->content_sha256, 'mime_type' => $row->mime_type, 'size' => (int) $row->size_bytes,
            'width' => (int) $row->width, 'height' => (int) $row->height,
        ];
    }
}
