<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\RemoveFuelTankerFillAttachmentRequest;
use App\Http\Requests\ReplaceFuelTankerFillAttachmentRequest;
use App\Http\Requests\StoreFuelTankerFillAttachmentsRequest;
use App\Http\Resources\FuelTankerFillAttachmentResource;
use App\Models\FuelTankerFill;
use App\Services\AttachmentStorage;
use App\Services\FuelTankerFillAttachmentService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * TANKER-PR5 — مرفقات سندات تعبئة الصهاريج (عرض/رفع/تنزيل/استبدال/إزالة). **دليل فقط: لا مخزون ولا قيد ولا فاتورة ولا تحصيل ولا تعديل للسند.**
 *
 * - خلف بوابتَي PR-1 وPR-4 المغلقتين افتراضياً (404 موحَّد قبل أي صلاحية). العرض والتنزيل `fuel.tanker.fill.view`، الرفع `…attachment.add`، الإزالة والاستبدال `…attachment.remove`.
 * - نطاق السند أولاً: فرع/مخزن/محطة مسنَدة وعزل المؤسسات ⇒ 404 موحَّد قبل أي أثر (معرّف مرفق صحيح لمؤسسة أخرى لا يُحلّ).
 * - التخزين خاص بلا روابط عامة ولا presigned: التنزيل يُبثّ عبر Laravel خلف فحص الصلاحيات (قرار المشروع D-g). جلسة PIN لا تصل هذه المسارات (تكامل موظف المحطة = PR-7).
 */
class FuelTankerFillAttachmentController extends ApiController
{
    use AuthorizesFuelStationScope;

    public function __construct(private FuelTankerFillAttachmentService $attachments, private AttachmentStorage $storage) {}

    public function index(Request $request, string $id): JsonResponse
    {
        $fill = $this->visibleFill($id, $request);
        $rows = $this->domain(fn () => $this->attachments->list($fill, $request->user(), $request->boolean('history')));
        $rows->each(fn ($row) => $row->setRelation('tankerFill', $fill));

        return FuelTankerFillAttachmentResource::collection($rows)
            ->additional(['meta' => $this->attachments->state($fill, $request->user())])
            ->response();
    }

    public function store(StoreFuelTankerFillAttachmentsRequest $request, string $id): JsonResponse
    {
        $fill = $this->visibleFill($id, $request);
        $result = $this->domain(fn () => $this->attachments->add($fill, $request->file('attachments', []), $request->user()));
        foreach ($result['attachments'] as $row) {
            $row->setRelation('tankerFill', $fill)->load(['uploader:id,name', 'remover:id,name']);
        }

        return FuelTankerFillAttachmentResource::collection(collect($result['attachments']))
            ->additional(['meta' => ['created' => $result['created'], 'replayed' => $result['created'] === 0] + $this->attachments->state($fill, $request->user())])
            ->response()
            ->setStatusCode($result['created'] > 0 ? 201 : 200);
    }

    public function download(Request $request, string $id, string $attachmentId): StreamedResponse
    {
        $fill = $this->visibleFill($id, $request);
        $attachment = $this->domain(fn () => $this->attachments->forDownload($fill, $attachmentId, $request->user()));

        $response = $this->storage->download($attachment->disk, $attachment->path, $this->attachments->downloadName($fill, $attachment), $attachment->mime_type);
        // مستند خاص: لا يُخزَّن في وسيط ولا يُفهرس.
        $response->headers->set('Cache-Control', 'private, no-store');

        return $response;
    }

    public function replace(ReplaceFuelTankerFillAttachmentRequest $request, string $id, string $attachmentId): JsonResponse
    {
        $fill = $this->visibleFill($id, $request);
        $old = $this->attachmentOf($fill, $attachmentId);
        $result = $this->domain(fn () => $this->attachments->replace($fill, $old, $request->file('attachment'), $request->user()));
        $result['attachment']->setRelation('tankerFill', $fill)->load(['uploader:id,name', 'remover:id,name']);

        return (new FuelTankerFillAttachmentResource($result['attachment']))
            ->additional(['meta' => ['replayed' => $result['replayed']] + $this->attachments->state($fill, $request->user())])
            ->response()
            ->setStatusCode($result['replayed'] ? 200 : 201);
    }

    public function destroy(RemoveFuelTankerFillAttachmentRequest $request, string $id, string $attachmentId): JsonResponse
    {
        $fill = $this->visibleFill($id, $request);
        $attachment = $this->attachmentOf($fill, $attachmentId);
        $result = $this->domain(fn () => $this->attachments->remove($fill, $attachment, $request->validated()['reason'], $request->user()));
        $result['attachment']->setRelation('tankerFill', $fill)->load(['uploader:id,name', 'remover:id,name']);

        return (new FuelTankerFillAttachmentResource($result['attachment']))
            ->additional(['meta' => ['replayed' => $result['replayed']] + $this->attachments->state($fill, $request->user())])
            ->response();
    }

    private function visibleFill(string $id, Request $request): FuelTankerFill
    {
        $fill = $this->scopeToActiveBranch(FuelTankerFill::query(), $request)->findOrFail($id);
        $this->accessibleStation($fill->fuel_station_id);

        return $fill;
    }

    private function attachmentOf(FuelTankerFill $fill, string $attachmentId): \App\Models\FuelTankerFillAttachment
    {
        return \App\Models\FuelTankerFillAttachment::query()->withoutGlobalScope(\App\Tenancy\BranchScope::class)
            ->where('fuel_tanker_fill_id', $fill->id)->findOrFail($attachmentId);
    }
}
