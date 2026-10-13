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
            // REM-03: لا يظهر سجلُّ مستندٍ من غير الفرع النشط — الترشيح في SQL
            // **قبل** `limit` فلا يتسرّب عدد ولا ترتيب ولا ما استُبعد.
            ->where(fn ($q) => $this->whereDocumentInCurrentBranch($q))
            ->latest()
            ->limit((int) $request->query('limit', 10))
            ->get();

        return DocumentRevisionResource::collection($revisions)->response();
    }

    public function index(string $type, string $id): JsonResponse
    {
        $model = DocumentRevision::TYPES[$type] ?? abort(404, 'نوع مستند غير معروف.');

        // العزل: المستند نفسه يجب أن يخصّ المستأجر (TenantScope) **وأن يقع في الفرع
        // النشط** (REM-03) — وإلا 404 كمعرّفٍ غير موجود، فلا يُكشف وجوده في فرعٍ آخر.
        $this->scopeToCurrentBranchOnly($model::query())->findOrFail($id);

        $revisions = DocumentRevision::with('user')
            ->where('document_type', $model)->where('document_id', $id)
            ->latest()->get();

        return DocumentRevisionResource::collection($revisions)->response();
    }

    /**
     * يقيّد سجلات التعديل بمستندات الفرع النشط (أو بلا فرع) لكل نوع معروف.
     *
     * المستند يُحدَّد بمعرّفه عبر استعلام فرعي على نموذجه — يحمل TenantScope
     * ومحمّلاً بنفس `scopeToCurrentBranchOnly()` — فلا استعلام لكل صف (لا N+1).
     * سجلُّ مستندٍ لم يعد موجوداً (مسودة محذوفة) لا يُعرف فرعه فلا يُثبَت
     * ترخيصه ⇒ يُستبعد (إغلاقٌ آمن).
     */
    private function whereDocumentInCurrentBranch(\Illuminate\Database\Eloquent\Builder $query): void
    {
        foreach (DocumentRevision::TYPES as $class) {
            $query->orWhere(function ($q) use ($class) {
                $q->where('document_type', $class)
                    ->whereIn('document_id', $this->scopeToCurrentBranchOnly($class::query())->select('id'));
            });
        }
    }
}
