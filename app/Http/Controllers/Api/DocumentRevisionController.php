<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\DocumentRevisionResource;
use App\Models\DocumentRevision;
use App\Models\Invoice;
use App\Models\ProcurementDocument;
use App\Models\Quote;
use Illuminate\Http\JsonResponse;

/**
 * سجلّ تغييرات مستند — قراءة فقط. لا كتابة يدوية: القيود تُكتب تلقائياً في
 * `RecordsRevisions` عند كل حفظ، فلا مسار يُنشئ سجلاً مصطنعاً.
 */
class DocumentRevisionController extends ApiController
{
    /** الأنواع المسموح الاستعلام عنها — لا يُمرَّر اسم كلاس من العميل. */
    private const TYPES = [
        'invoice'     => Invoice::class,
        'quote'       => Quote::class,
        'procurement' => ProcurementDocument::class,
    ];

    public function index(string $type, string $id): JsonResponse
    {
        $model = self::TYPES[$type] ?? abort(404, 'نوع مستند غير معروف.');

        // العزل: المستند نفسه يجب أن يخصّ المستأجر — findOrFail يمرّ بـ TenantScope.
        $model::findOrFail($id);

        $revisions = DocumentRevision::with('user')
            ->where('document_type', $model)->where('document_id', $id)
            ->latest()->get();

        return DocumentRevisionResource::collection($revisions)->response();
    }
}
