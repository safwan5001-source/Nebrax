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
use App\Services\AttachmentStorage;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\StreamedResponse;

class ExpenseController extends ApiController
{
    public function __construct(
        protected ExpenseService $expenses,
        protected AttachmentStorage $attachmentStorage,
    ) {}

    public function index(Request $request): JsonResponse
    {
        return ExpenseResource::collection(
            $this->scopeToActiveBranch(Expense::with(['account', 'category'])->withCount('documentTransactionLinks')->latest(), $request)->get()
        )->response();
    }

    public function store(StoreExpenseRequest $request): JsonResponse
    {
        $data = $request->validated();
        $this->assertReferences($data);

        $expense = $this->atomicWithAttachments(
            $request,
            $this->attachmentStorage->newResourceId(),
            fn () => $this->domain(fn () => $this->expenses->create($data)),
        );

        return (new ExpenseResource($expense->load(['account', 'category', 'attachments'])->loadCount('documentTransactionLinks')))->response()->setStatusCode(201);
    }

    public function show(Request $request, string $id): JsonResponse
    {
        return (new ExpenseResource(
            $this->visibleExpense($request, $id)
                ->load(['account', 'category', 'partner', 'costCenter', 'attachments', 'documentTransactionLinks.batch'])
                ->loadCount('documentTransactionLinks')
        ))->response();
    }

    /** تعديل مسودة قائمة: لا يفتح أي مصروف مرحّل لتعديل البيانات أو المبلغ. */
    public function update(StoreExpenseRequest $request, string $id): JsonResponse
    {
        $expense = $this->visibleExpense($request, $id);
        $data = $request->validated();
        $this->assertReferences($data);

        $updated = $this->atomicWithAttachments(
            $request,
            (string) $expense->id,
            fn () => $this->domain(fn () => $this->expenses->update($expense, $data)),
        );

        return (new ExpenseResource($updated->load(['account', 'category', 'partner', 'costCenter', 'attachments'])->loadCount('documentTransactionLinks')))->response();
    }

    /** ينشئ نسخة مسودة مستقلة بلا مرفقات إثبات، وبترقيم وتاريخ جديدين. */
    public function duplicate(Request $request, string $id): JsonResponse
    {
        $expense = $this->visibleExpense($request, $id);
        $copy = $this->domain(fn () => $this->expenses->duplicate($expense, $request->user()?->id));

        return (new ExpenseResource($copy->load(['account', 'category', 'partner', 'costCenter', 'attachments'])->loadCount('documentTransactionLinks')))->response()->setStatusCode(201);
    }

    /** الحذف متاح للمسودة فقط؛ السند المرحّل جزء من سجل القيد ولا يُمحى. */
    public function destroy(Request $request, string $id): JsonResponse
    {
        $expense = $this->visibleExpense($request, $id);
        if (! $expense->isDraft()) {
            abort(422, 'لا يمكن حذف مصروف مرحّل أو ملغى.');
        }
        if ($expense->documentTransactionLinks()->exists()) {
            abort(422, 'لا يمكن حذف مسودة مصروف مرتبطة بمستند مصدر.');
        }

        $attachments = $expense->attachments()->get();
        DB::transaction(function () use ($expense) {
            $expense->attachments()->delete();
            $expense->delete();
        });

        // الصف حُذف أولاً (يبقى السجل صحيحاً)؛ فشل حذف الكائن يُسجَّل ولا يُفشل الطلب.
        $this->attachmentStorage->discard($attachments->all());

        return response()->json(['message' => 'deleted']);
    }

    public function post(Request $request, string $id): JsonResponse
    {
        $expense = $this->visibleExpense($request, $id);
        $posted = $this->domain(fn () => $this->expenses->post($expense));

        return (new ExpenseResource($posted->load(['account', 'category', 'partner', 'costCenter', 'attachments'])->loadCount('documentTransactionLinks')))->response();
    }

    /** تنزيل مرفق خاص بعد إثبات أنه يعود للمصروف المرئي في الفرع النشط. */
    public function downloadAttachment(Request $request, string $id, string $attachmentId): StreamedResponse
    {
        $expense = $this->visibleExpense($request, $id);
        $attachment = $expense->attachments()->whereKey($attachmentId)->firstOrFail();

        return $this->attachmentStorage->download(
            $attachment->disk, $attachment->path, $attachment->original_name, $attachment->mime_type,
        );
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
     * ذرّية الطلب (Q12): الملفات تُكتب أولاً خارج المعاملة، ثم الأب المالي وصفوف المرفقات في
     * معاملة واحدة. أي فشل يتراجع عنه الأب وصفوفه وقيده (المعاملات الداخلية للخدمة savepoints)
     * وتُحذف الكائنات المكتوبة، فإعادة الطلب محاولة أولى نظيفة لا تُنتج مصروفاً مكرّراً.
     * لا يُقبل من العميل مسار جاهز، فلا يستطيع ربط مستند بملف مستأجر أو مصروف آخر.
     */
    private function atomicWithAttachments(StoreExpenseRequest $request, string $resourceId, \Closure $persistParent): Expense
    {
        $stored = $this->attachmentStorage->putMany(
            AttachmentStorage::DOMAIN_EXPENSE, $resourceId, $request->file('attachments', []), "expenses/{$resourceId}",
        );

        try {
            return DB::transaction(function () use ($request, $persistParent, $stored): Expense {
                $expense = $persistParent();
                foreach ($stored as $file) {
                    ExpenseAttachment::create($file + [
                        'expense_id' => $expense->id,
                        'uploaded_by' => $request->user()?->id,
                    ]);
                }

                return $expense;
            });
        } catch (\Throwable $e) {
            $this->attachmentStorage->discard($stored);
            throw $e;
        }
    }
}
