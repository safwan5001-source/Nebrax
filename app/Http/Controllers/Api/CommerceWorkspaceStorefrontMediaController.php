<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\StorefrontMediaResource;
use App\Models\StorefrontMedia;
use App\Models\StorefrontPresentationVersion;
use App\Services\Commerce\StorefrontMediaException;
use App\Services\Commerce\StorefrontMediaReferenceScanner;
use App\Services\Commerce\StorefrontMediaService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\ValidationException;

/**
 * CUST-HV V2a — مكتبة وسائط المُخصِّص (مساحة العمل، `commerce.manage`).
 * العقد: docs/plans/store/CUST-HV-V0-DECISIONS-AND-ARCHITECTURE-CONTRACT.md §7.3.
 *
 * **السلطة:** المستأجر من `TenantContext` فقط (نطاق `BaseModel` الآلي) — لا
 * `tenant_id` ولا مفتاح تخزين من العميل. معرّف أجنبي أو محذوف = 404 موحّد غير
 * كاشف. الحقول المقبولة قائمة سماح صريحة؛ أي مفتاح آخر يُرفض 422.
 *
 * **لا مسار/قرص/دلو في أي استجابة** (انظر `StorefrontMediaResource`).
 */
class CommerceWorkspaceStorefrontMediaController extends ApiController
{
    private const PAGE_SIZE = 24;

    /** @var list<string> */
    private const UPDATABLE = ['name', 'alt_ar', 'alt_en'];

    public function index(Request $request, StorefrontMediaService $media, StorefrontMediaReferenceScanner $references): JsonResponse
    {
        $this->denySelfService($request);

        $request->validate([
            'q' => ['sometimes', 'nullable', 'string', 'max:120'],
            'unused' => ['sometimes', 'boolean'],
            'cursor' => ['sometimes', 'nullable', 'string', 'max:512'],
        ]);

        $query = StorefrontMedia::query()->where('state', StorefrontMedia::STATE_ACTIVE);

        $term = trim((string) $request->query('q', ''));
        if ($term !== '') {
            $like = '%'.str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], mb_strtolower($term)).'%';
            $query->where(function ($q) use ($like): void {
                $q->whereRaw("LOWER(original_name) LIKE ? ESCAPE '\\'", [$like])
                    ->orWhereRaw("LOWER(COALESCE(alt_ar, '')) LIKE ? ESCAPE '\\'", [$like])
                    ->orWhereRaw("LOWER(COALESCE(alt_en, '')) LIKE ? ESCAPE '\\'", [$like]);
            });
        }

        if ($request->boolean('unused')) {
            $referenced = array_keys($references->allReferencedIds());
            if ($referenced !== []) {
                $query->whereNotIn('id', $referenced);
            }
        }

        $page = $query->orderByDesc('created_at')->orderByDesc('id')->cursorPaginate(self::PAGE_SIZE);

        $refs = $references->referencesFor($page->getCollection()->pluck('id')->all());
        $items = $page->getCollection()->map(fn (StorefrontMedia $m) => StorefrontMediaResource::workspace(
            $m,
            $media,
            $this->containerCount($refs[$m->id] ?? []),
        ))->values()->all();

        $active = StorefrontMedia::query()->where('state', StorefrontMedia::STATE_ACTIVE);

        return response()->json([
            'data' => $items,
            'meta' => [
                'next_cursor' => $page->nextCursor()?->encode(),
                'has_more' => $page->hasMorePages(),
                'uploads_enabled' => $media->uploadsEnabled(),
                'max_files_per_request' => (int) config('storefront_media.max_files_per_request'),
                'max_bytes' => (int) config('storefront_media.max_bytes'),
                'library' => [
                    'assets' => (clone $active)->count(),
                    'max_assets' => (int) config('storefront_media.max_assets_per_tenant'),
                    'bytes' => (int) (clone $active)->sum('size'),
                    'max_bytes' => (int) config('storefront_media.max_bytes_per_tenant'),
                ],
            ],
        ]);
    }

    public function store(Request $request, StorefrontMediaService $media): JsonResponse
    {
        $this->denySelfService($request);

        $max = (int) config('storefront_media.max_files_per_request');
        $request->validate([
            'files' => ['required', 'array', 'min:1', 'max:'.$max],
            'files.*' => ['required', 'file'],
        ]);
        $this->rejectUnknown($request, ['files']);

        if (! $media->uploadsEnabled()) {
            return $this->failure(StorefrontMediaException::storageNotEnabled());
        }

        $results = [];
        $created = 0;
        foreach ((array) $request->file('files') as $file) {
            $name = $file->getClientOriginalName();
            if (! $file->isValid()) {
                $results[] = $this->rejected($name, 'upload_failed', 'فشل رفع الملف. أعد المحاولة.');

                continue;
            }

            try {
                $outcome = $media->upload($file, $request->user()?->id);
                $created += $outcome['deduplicated'] ? 0 : 1;
                $results[] = [
                    'status' => $outcome['deduplicated'] ? 'duplicate' : 'created',
                    'name' => $name,
                    'media' => StorefrontMediaResource::workspace($outcome['media'], $media),
                ];
            } catch (StorefrontMediaException $e) {
                if ($e->status >= 500) {
                    // فشل بنية تحتية ينهي الدفعة: لا فائدة من متابعة بقية الملفات.
                    return $this->failure($e, $results);
                }
                $results[] = $this->rejected($name, $e->errorCode, $e->getMessage());
            }
        }

        return response()->json(['data' => $results], $created > 0 ? 201 : 200);
    }

    public function update(Request $request, StorefrontMediaService $media, string $mediaId): JsonResponse
    {
        $this->denySelfService($request);
        $asset = $this->activeOr404($mediaId);
        $this->rejectUnknown($request, self::UPDATABLE);

        $data = $request->validate([
            'name' => ['sometimes', 'string', 'min:1', 'max:255'],
            'alt_ar' => ['sometimes', 'nullable', 'string', 'max:300'],
            'alt_en' => ['sometimes', 'nullable', 'string', 'max:300'],
        ]);

        $attributes = [];
        if (array_key_exists('name', $data)) {
            $name = trim((string) $data['name']);
            if ($name === '') {
                throw ValidationException::withMessages(['name' => ['الاسم مطلوب.']]);
            }
            $attributes['original_name'] = $name;
        }
        foreach (['alt_ar', 'alt_en'] as $field) {
            if (array_key_exists($field, $data)) {
                $value = $data[$field] === null ? '' : trim((string) $data[$field]);
                $attributes[$field] = $value === '' ? null : $value;
            }
        }

        $asset->fill($attributes)->save();

        return response()->json(['data' => StorefrontMediaResource::workspace($asset->refresh(), $media)]);
    }

    public function destroy(Request $request, StorefrontMediaService $media, string $mediaId): JsonResponse
    {
        $this->denySelfService($request);
        $asset = $this->activeOr404($mediaId);

        try {
            $media->delete($asset);
        } catch (StorefrontMediaException $e) {
            return $this->failure($e);
        }

        return response()->json(['data' => ['deleted' => true]]);
    }

    public function usage(Request $request, StorefrontMediaReferenceScanner $references, string $mediaId): JsonResponse
    {
        $this->denySelfService($request);
        $asset = $this->activeOr404($mediaId);

        $rows = $references->referencesFor([$asset->id])[$asset->id] ?? [];

        $versionNames = StorefrontPresentationVersion::query()
            ->whereIn('id', array_values(array_unique(array_column(array_filter(
                $rows,
                static fn (array $r): bool => $r['container'] === StorefrontMediaReferenceScanner::CONTAINER_VERSION,
            ), 'id'))))
            ->pluck('name', 'id');

        return response()->json(['data' => [
            'media_id' => $asset->id,
            'count' => $this->containerCount($rows),
            'usage' => array_map(static fn (array $r): array => $r + [
                'name' => $r['container'] === StorefrontMediaReferenceScanner::CONTAINER_VERSION
                    ? ($versionNames[$r['id']] ?? null)
                    : null,
            ], $rows),
        ]]);
    }

    public function retry(Request $request, StorefrontMediaService $media, string $mediaId): JsonResponse
    {
        $this->denySelfService($request);
        $asset = $this->activeOr404($mediaId);

        try {
            $asset = $media->retry($asset);
        } catch (StorefrontMediaException $e) {
            return $this->failure($e);
        }

        return response()->json(['data' => StorefrontMediaResource::workspace($asset, $media)]);
    }

    // ─────────────────────────────── helpers ───────────────────────────────

    private function activeOr404(string $id): StorefrontMedia
    {
        $asset = StorefrontMedia::query()->where('state', StorefrontMedia::STATE_ACTIVE)->find($id);
        abort_if($asset === null, 404, 'الوسيط غير موجود.');

        return $asset;
    }

    /** @param list<array{container:string,id:string}> $rows */
    private function containerCount(array $rows): int
    {
        return count(array_unique(array_map(static fn (array $r): string => $r['container'].':'.$r['id'], $rows)));
    }

    /** @param list<string> $allowed */
    private function rejectUnknown(Request $request, array $allowed): void
    {
        $unknown = array_diff(array_keys($request->all()), $allowed);
        if ($unknown === []) {
            return;
        }

        throw ValidationException::withMessages(array_fill_keys(
            array_values($unknown),
            ['حقل غير مسموح.'],
        ));
    }

    /** @return array{status:string,name:string,error:array{code:string,message:string}} */
    private function rejected(string $name, string $code, string $message): array
    {
        return ['status' => 'rejected', 'name' => $name, 'error' => ['code' => $code, 'message' => $message]];
    }

    /** @param list<array<string,mixed>> $partial */
    private function failure(StorefrontMediaException $e, array $partial = []): JsonResponse
    {
        $body = ['message' => $e->getMessage(), 'code' => $e->errorCode] + $e->context;
        if ($partial !== []) {
            $body['data'] = $partial;
        }

        return response()->json($body, $e->status);
    }

    private function denySelfService(Request $request): void
    {
        if ($request->user()?->role === 'self_service') {
            abort(403, 'مساحة عمل التجارة غير متاحة لحساب الخدمة الذاتية.');
        }
    }
}
