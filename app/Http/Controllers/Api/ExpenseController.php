<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreExpenseRequest;
use App\Http\Resources\ExpenseResource;
use App\Models\CostCenter;
use App\Models\Expense;
use App\Models\ExpenseAttachment;
use App\Models\ExpenseCategory;
use App\Models\Partner;
use App\Services\Accounting\ExpenseService;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class ExpenseController extends ApiController
{
    public function __construct(protected ExpenseService $expenses) {}

    public function index(Request $request): JsonResponse
    {
        return ExpenseResource::collection(
            $this->scopeToActiveBranch(Expense::with(['account', 'category'])->latest(), $request)->get()
        )->response();
    }

    public function store(StoreExpenseRequest $request): JsonResponse
    {
        $data = $request->validated();
        $this->assertReferences($data);

        $expense = $this->domain(fn () => $this->expenses->create($data));
        $this->storeAttachments($request, $expense);

        return (new ExpenseResource($expense->load(['account', 'category', 'attachments'])))->response()->setStatusCode(201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        return (new ExpenseResource(
            $this->visibleExpense($request, $id)->load(['account', 'category', 'partner', 'costCenter', 'attachments'])
        ))->response();
    }

    /** تعديل مسودة قائمة: لا يفتح أي مصروف مرحّل لتعديل البيانات أو المبلغ. */
    public function update(StoreExpenseRequest $request, string $id): JsonResponse
    {
        $expense = $this->visibleExpense($request, $id);
        $data = $request->validated();
        $this->assertReferences($data);

        $updated = $this->domain(fn () => $this->expenses->update($expense, $data));
        $this->storeAttachments($request, $updated);

        return (new ExpenseResource($updated->load(['account', 'category', 'partner', 'costCenter', 'attachments'])))->response();
    }

    /** ينشئ نسخة مسودة مستقلة بلا مرفقات إثبات، وبترقيم وتاريخ جديدين. */
    public function duplicate(Request $request, string $id): JsonResponse
    {
        $expense = $this->visibleExpense($request, $id);
        $copy = $this->domain(fn () => $this->expenses->duplicate($expense, $request->user()?->id));

        return (new ExpenseResource($copy->load(['account', 'category', 'partner', 'costCenter', 'attachments'])))->response()->setStatusCode(201);
    }

    /** الحذف متاح للمسودة فقط؛ السند المرحّل جزء من سجل القيد ولا يُمحى. */
    public function destroy(Request $request, string $id): JsonResponse
    {
        $expense = $this->visibleExpense($request, $id);
        if (! $expense->isDraft()) {
            abort(422, 'لا يمكن حذف مصروف مرحّل أو ملغى.');
        }

        $attachments = $expense->attachments()->get();
        DB::transaction(function () use ($expense) {
            $expense->attachments()->delete();
            $expense->delete();
        });

        foreach ($attachments as $attachment) {
            Storage::disk($attachment->disk)->delete($attachment->path);
        }

        return response()->json(['message' => 'deleted']);
    }

    public function post(Request $request, string $id): JsonResponse
    {
        $expense = $this->visibleExpense($request, $id);
        $posted = $this->domain(fn () => $this->expenses->post($expense));

        return (new ExpenseResource($posted->load(['account', 'category', 'partner', 'costCenter', 'attachments'])))->response();
    }

    /** تنزيل مرفق خاص بعد إثبات أنه يعود للمصروف المرئي في الفرع النشط. */
    public function downloadAttachment(Request $request, string $id, string $attachmentId): StreamedResponse
    {
        $expense = $this->visibleExpense($request, $id);
        $attachment = $expense->attachments()->whereKey($attachmentId)->firstOrFail();
        $disk = Storage::disk($attachment->disk);

        if (! $disk->exists($attachment->path)) {
            abort(404, 'ملف المرفق غير موجود.');
        }

        return $disk->download($attachment->path, $attachment->original_name, [
            'Content-Type' => $attachment->mime_type ?? 'application/octet-stream',
        ]);
    }

    /** المصروفات محاسبية بلا Scope عالمي؛ عرضها وتنفيذ الإجراء عليها يُصفّيان صراحةً بالفرع. */
    private function visibleExpense(Request $request, string $id): Expense
    {
        return $this->scopeToActiveBranch(Expense::query(), $request)->whereKey($id)->firstOrFail();
    }

    /** المراجع يجب أن تكون مرئية في سياق الإنشاء/التعديل، لا مجرد موجودة في المستأجر. */
    private function assertReferences(array $data): void
    {
        if (! empty($data['partner_id'])) {
            Partner::findOrFail($data['partner_id']);
        }

        $this->assertTenantOwned(CostCenter::class, $data['cost_center_id'] ?? null, 'مركز التكلفة');
        $this->assertActiveCategory($data['category_id'] ?? null);
    }

    /** لا يقبل سند جديد تصنيفاً معطلاً أو مخفياً بعزل الفرع. */
    private function assertActiveCategory(?string $categoryId): void
    {
        if ($categoryId !== null && ! ExpenseCategory::whereKey($categoryId)->where('is_active', true)->exists()) {
            abort(422, 'تصنيف المصروف غير موجود أو غير نشط.');
        }
    }

    /**
     * تُحفَظ الملفات على قرص خاص وتُربط بمسودة المصروف. لا يُقبل من العميل
     * مسار جاهز، فلا يستطيع ربط مستند بملف يخص مستأجراً أو مصروفاً آخر.
     */
    private function storeAttachments(StoreExpenseRequest $request, Expense $expense): void
    {
        foreach ($request->file('attachments', []) as $file) {
            $path = $file->store("expenses/{$expense->id}", 'local');

            ExpenseAttachment::create([
                'expense_id'    => $expense->id,
                'disk'          => 'local',
                'path'          => $path,
                'original_name' => $file->getClientOriginalName(),
                'mime_type'     => $file->getMimeType(),
                'size'          => $file->getSize(),
                'uploaded_by'   => $request->user()?->id,
            ]);
        }
    }
}
