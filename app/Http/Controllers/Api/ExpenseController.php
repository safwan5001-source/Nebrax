<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\StoreExpenseRequest;
use App\Http\Resources\ExpenseResource;
use App\Models\Account;
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
        $filters = $request->validate([
            'search' => ['sometimes', 'nullable', 'string', 'max:120'],
            'status' => ['sometimes', 'nullable', 'in:draft,posted,cancelled'],
            'payment_method' => ['sometimes', 'nullable', 'string', 'max:60'],
            'category_name' => ['sometimes', 'nullable', 'string', 'max:120'],
            'vendor_name' => ['sometimes', 'nullable', 'string', 'max:160'],
            'account_name' => ['sometimes', 'nullable', 'string', 'max:160'],
            'date_from' => ['sometimes', 'nullable', 'date'],
            'date_to' => ['sometimes', 'nullable', 'date'],
            'amount_min' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'amount_max' => ['sometimes', 'nullable', 'numeric', 'min:0'],
            'sort' => ['sometimes', 'nullable', 'string', 'max:40'],
            'per_page' => ['sometimes', 'nullable', 'integer', 'min:10', 'max:100'],
            'page' => ['sometimes', 'nullable', 'integer', 'min:1'],
        ]);

        $query = $this->scopeToActiveBranch(
            Expense::with(['account', 'category'])->withCount('documentTransactionLinks'),
            $request
        );

        if (filled($filters['search'] ?? null)) {
            $needle = addcslashes(trim((string) $filters['search']), '%_\\');
            $like = "%{$needle}%";
            $query->where(function ($search) use ($like): void {
                $search->where('number', 'like', $like)
                    ->orWhere('vendor_name', 'like', $like)
                    ->orWhere('payment_method', 'like', $like)
                    ->orWhere('description', 'like', $like)
                    ->orWhereHas('account', fn ($account) => $account->where('name', 'like', $like)->orWhere('code', 'like', $like))
                    ->orWhereHas('category', fn ($category) => $category->where('name', 'like', $like));
            });
        }

        if (filled($filters['status'] ?? null)) $query->where('status', $filters['status']);
        if (filled($filters['payment_method'] ?? null)) $query->where('payment_method', $filters['payment_method']);
        if (filled($filters['vendor_name'] ?? null)) $query->where('vendor_name', $filters['vendor_name']);
        if (filled($filters['category_name'] ?? null)) {
            $query->whereHas('category', fn ($category) => $category->where('name', $filters['category_name']));
        }
        if (filled($filters['account_name'] ?? null)) {
            $query->whereHas('account', fn ($account) => $account->where('name', $filters['account_name']));
        }
        if (filled($filters['date_from'] ?? null)) $query->whereDate('expense_date', '>=', $filters['date_from']);
        if (filled($filters['date_to'] ?? null)) $query->whereDate('expense_date', '<=', $filters['date_to']);
        if (filled($filters['amount_min'] ?? null)) $query->where('total', '>=', $this->moneyFilterToMinor((string) $filters['amount_min']));
        if (filled($filters['amount_max'] ?? null)) $query->where('total', '<=', $this->moneyFilterToMinor((string) $filters['amount_max']));

        $paginated = isset($filters['per_page']);
        $sort = (string) ($filters['sort'] ?? '');
        $direction = str_starts_with($sort, '-') ? 'desc' : 'asc';
        $sortKey = ltrim($sort, '-');

        if ($sortKey === 'account_name') {
            $query->orderBy(Account::select('name')->whereColumn('accounts.id', 'expenses.account_id'), $direction)->orderByDesc('id');
        } elseif ($sortKey === 'category_name') {
            $query->orderBy(ExpenseCategory::select('name')->whereColumn('expense_categories.id', 'expenses.category_id'), $direction)->orderByDesc('id');
        } elseif (in_array($sortKey, ['expense_date', 'number', 'vendor_name', 'total', 'created_at'], true) && $sort !== '') {
            $query->orderBy($sortKey, $direction)->orderByDesc('id');
        } elseif ($paginated) {
            $query->orderByDesc('expense_date')->orderByDesc('id');
        } else {
            $query->latest();
        }

        if ($paginated) {
            return ExpenseResource::collection(
                $query->paginate((int) $filters['per_page'])->withQueryString()
            )->response();
        }

        return ExpenseResource::collection($query->get())->response();
    }

    public function store(StoreExpenseRequest $request): JsonResponse
    {
        $data = $request->validated();
        $this->assertReferences($data);

        $expense = $this->domain(fn () => $this->expenses->create($data));
        $this->storeAttachments($request, $expense);

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

    public function update(StoreExpenseRequest $request, string $id): JsonResponse
    {
        $expense = $this->visibleExpense($request, $id);
        $data = $request->validated();
        $this->assertReferences($data);

        $updated = $this->domain(fn () => $this->expenses->update($expense, $data));
        $this->storeAttachments($request, $updated);

        return (new ExpenseResource($updated->load(['account', 'category', 'partner', 'costCenter', 'attachments'])->loadCount('documentTransactionLinks')))->response();
    }

    public function duplicate(Request $request, string $id): JsonResponse
    {
        $expense = $this->visibleExpense($request, $id);
        $copy = $this->domain(fn () => $this->expenses->duplicate($expense, $request->user()?->id));

        return (new ExpenseResource($copy->load(['account', 'category', 'partner', 'costCenter', 'attachments'])->loadCount('documentTransactionLinks')))->response()->setStatusCode(201);
    }

    public function destroy(Request $request, string $id): JsonResponse
    {
        $expense = $this->visibleExpense($request, $id);
        if (! $expense->isDraft()) abort(422, 'لا يمكن حذف مصروف مرحّل أو ملغى.');
        if ($expense->documentTransactionLinks()->exists()) abort(422, 'لا يمكن حذف مسودة مصروف مرتبطة بمستند مصدر.');

        $attachments = $expense->attachments()->get();
        DB::transaction(function () use ($expense) {
            $expense->attachments()->delete();
            $expense->delete();
        });

        foreach ($attachments as $attachment) Storage::disk($attachment->disk)->delete($attachment->path);

        return response()->json(['message' => 'deleted']);
    }

    public function post(Request $request, string $id): JsonResponse
    {
        $expense = $this->visibleExpense($request, $id);
        $posted = $this->domain(fn () => $this->expenses->post($expense));

        return (new ExpenseResource($posted->load(['account', 'category', 'partner', 'costCenter', 'attachments'])->loadCount('documentTransactionLinks')))->response();
    }

    public function downloadAttachment(Request $request, string $id, string $attachmentId): StreamedResponse
    {
        $expense = $this->visibleExpense($request, $id);
        $attachment = $expense->attachments()->whereKey($attachmentId)->firstOrFail();
        $disk = Storage::disk($attachment->disk);
        if (! $disk->exists($attachment->path)) abort(404, 'ملف المرفق غير موجود.');

        return $disk->download($attachment->path, $attachment->original_name, [
            'Content-Type' => $attachment->mime_type ?? 'application/octet-stream',
        ]);
    }

    private function visibleExpense(Request $request, string $id): Expense
    {
        return $this->scopeToActiveBranch(Expense::query(), $request)->whereKey($id)->firstOrFail();
    }

    private function assertReferences(array $data): void
    {
        if (! empty($data['partner_id'])) Partner::findOrFail($data['partner_id']);
        $this->assertTenantOwned(CostCenter::class, $data['cost_center_id'] ?? null, 'مركز التكلفة');
        $this->assertActiveCategory($data['category_id'] ?? null);
    }

    private function assertActiveCategory(?string $categoryId): void
    {
        if ($categoryId !== null && ! ExpenseCategory::whereKey($categoryId)->where('is_active', true)->exists()) {
            abort(422, 'تصنيف المصروف غير موجود أو غير نشط.');
        }
    }

    private function storeAttachments(StoreExpenseRequest $request, Expense $expense): void
    {
        foreach ($request->file('attachments', []) as $file) {
            $path = $file->store("expenses/{$expense->id}", 'local');
            ExpenseAttachment::create([
                'expense_id' => $expense->id,
                'disk' => 'local',
                'path' => $path,
                'original_name' => $file->getClientOriginalName(),
                'mime_type' => $file->getMimeType(),
                'size' => $file->getSize(),
                'uploaded_by' => $request->user()?->id,
            ]);
        }
    }

    private function moneyFilterToMinor(string $value): int
    {
        $normalized = trim($value);
        [$whole, $fraction] = array_pad(explode('.', $normalized, 2), 2, '');
        $fraction = substr(str_pad(preg_replace('/\D/', '', $fraction) ?? '', 2, '0'), 0, 2);
        return ((int) $whole * 100) + (int) $fraction;
    }
}
