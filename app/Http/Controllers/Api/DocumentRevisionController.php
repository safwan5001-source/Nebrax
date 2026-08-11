<?php

namespace App\Http\Controllers\Api;

use App\Http\Resources\DocumentRevisionResource;
use App\Models\DocumentRevision;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * سجلّ تغييرات مستند — قراءة فقط. لا كتابة يدوية: القيود تُكتب تلقائياً في
 * `RecordsRevisions` عند كل حفظ، فلا مسار يُنشئ سجلاً مصطنعاً.
 */
class DocumentRevisionController extends ApiController
{
    /**
     * تغذية النشاطات على مستوى المستأجر — أحدث ما جرى عبر كل المستندات.
     * قراءة خالصة: لا تكتب شيئاً ولا تمسّ قيداً.
     */
    public function feed(Request $request): JsonResponse
    {
        $request->validate(['limit' => ['nullable', 'integer', 'min:1', 'max:50']]);

        $revisions = DocumentRevision::with(['user', 'document'])
            // الأنواع المعروفة وحدها: سجلٌّ لنموذج خارج القائمة لا واجهة له.
            ->whereIn('document_type', array_values(DocumentRevision::TYPES))
            ->latest()
            ->limit((int) $request->query('limit', 10))
            ->get();

        return DocumentRevisionResource::collection($revisions)->response();
    }

    public function index(string $type, string $id): JsonResponse
    {
        $model = DocumentRevision::TYPES[$type] ?? abort(404, 'نوع مستند غير معروف.');

        // العزل: المستند نفسه يجب أن يخصّ المستأجر — findOrFail يمرّ بـ TenantScope.
        $model::findOrFail($id);

        $revisions = DocumentRevision::with('user')
            ->where('document_type', $model)->where('document_id', $id)
            ->latest()->get();

        return DocumentRevisionResource::collection($revisions)->response();
    }
}
