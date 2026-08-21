<?php

namespace App\Http\Controllers\Api;

use App\Http\Requests\UpdateAccountEmailRequest;
use App\Http\Requests\UpdateAccountPasswordRequest;
use App\Http\Requests\UpdateAccountPreferencesRequest;
use App\Models\Account;
use App\Models\AccountExportEvent;
use App\Models\Branch;
use App\Models\CashBankAccount;
use App\Models\CostCenter;
use App\Models\Invoice;
use App\Models\InvoiceLine;
use App\Models\JournalEntry;
use App\Models\JournalLine;
use App\Models\Partner;
use App\Models\Payment;
use App\Models\PaymentAllocation;
use App\Models\PaymentMethod;
use App\Models\Product;
use App\Models\ProductCategory;
use App\Models\ProductWarehouseStock;
use App\Models\Purchase;
use App\Models\PurchaseLine;
use App\Models\ReturnDocument;
use App\Models\ReturnLine;
use App\Models\StockMovement;
use App\Models\Tenant;
use App\Models\UnitTemplate;
use App\Models\User;
use App\Models\Warehouse;
use App\Support\Settings;
use App\Tenancy\TenantContext;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * مركز حساب المستخدم: تفضيلات شخصية، بيانات الدخول، وتصدير المؤسسة.
 *
 * لا تنشئ هذه المسارات أثراً محاسبياً. التصدير قراءة مؤسسية محروسة بالمالك
 * ويُسجل طلبه فقط؛ لا يُخزن ملفاً دائماً ولا كلمات مرور أو توكنات.
 */
class AccountSettingsController extends ApiController
{
    public function updatePreferences(UpdateAccountPreferencesRequest $request): JsonResponse
    {
        $user = $request->user();
        $user->update(['preferences' => $request->validated()]);

        return response()->json(['user' => $this->userPayload($user->fresh())]);
    }

    public function updateEmail(UpdateAccountEmailRequest $request): JsonResponse
    {
        $user = $request->user();
        $user->update(['email' => $request->validated('email')]);
        $this->revokeOtherTokens($request);

        return response()->json([
            'message' => 'تم تحديث البريد الإلكتروني وإلغاء الجلسات الأخرى.',
            'user'    => $this->userPayload($user->fresh()),
        ]);
    }

    public function updatePassword(UpdateAccountPasswordRequest $request): JsonResponse
    {
        $user = $request->user();
        $user->update(['password' => $request->validated('password')]);
        $this->revokeOtherTokens($request);

        return response()->json(['message' => 'تم تحديث كلمة المرور وإلغاء الجلسات الأخرى.']);
    }

    /** تصدير تشغيلي V1 لبيانات المؤسسة؛ المالك وحده يملك حق تنزيله. */
    public function export(Request $request): StreamedResponse
    {
        $this->assertOwner($request);

        $tenant = Tenant::findOrFail(app(TenantContext::class)->id());
        $fileName = 'nebrax-company-export-'.now()->format('Ymd-His').'.json';

        AccountExportEvent::create([
            'user_id'     => $request->user()->id,
            'file_name'   => $fileName,
            'ip_address'  => $request->ip(),
            'user_agent'  => mb_substr((string) $request->userAgent(), 0, 1000),
            'generated_at' => now(),
        ]);

        $payload = $this->exportPayload($tenant);

        return response()->streamDownload(
            static function () use ($payload): void {
                echo json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT | JSON_THROW_ON_ERROR);
            },
            $fileName,
            ['Content-Type' => 'application/json; charset=UTF-8']
        );
    }

    private function assertOwner(Request $request): void
    {
        if ($request->user()->role !== 'owner') {
            abort(403, 'تصدير بيانات المؤسسة متاح للمالك فقط.');
        }
    }

    /** @return array<string, mixed> */
    private function exportPayload(Tenant $tenant): array
    {
        return [
            'export_version' => 1,
            'generated_at'   => now()->toIso8601String(),
            'scope'          => 'operational_company_data',
            'company'        => [
                'id'         => $tenant->id,
                'name'       => $tenant->name,
                'slug'       => $tenant->slug,
                'vat_number' => $tenant->vat_number,
                'cr_number'  => $tenant->cr_number,
                'currency'   => $tenant->currency,
                'country'    => $tenant->country,
                'settings'   => $tenant->settings,
            ],
            // كلمة المرور والتوكنات وملفات التخزين وسجل الأمن مستثناة عمداً.
            'users'           => User::where('tenant_id', $tenant->id)->get()->map(fn (User $user) => [
                'id'          => $user->id,
                'name'        => $user->name,
                'email'       => $user->email,
                'phone'       => $user->phone,
                'role'        => $user->role,
                'permissions' => $user->permissions,
                'preferences' => $user->preferences,
                'is_active'   => $user->is_active,
                'created_at'  => $user->created_at?->toIso8601String(),
                'updated_at'  => $user->updated_at?->toIso8601String(),
            ])->values()->all(),
            'branches'        => $this->rows(Branch::class),
            'warehouses'      => $this->rows(Warehouse::class),
            'accounts'        => $this->rows(Account::class),
            'cash_bank_accounts' => $this->rows(CashBankAccount::class),
            'payment_methods' => $this->rows(PaymentMethod::class),
            'cost_centers'    => $this->rows(CostCenter::class),
            'partners'        => $this->rows(Partner::class),
            'product_categories' => $this->rows(ProductCategory::class),
            'unit_templates'  => $this->rows(UnitTemplate::class),
            'products'        => $this->rows(Product::class),
            'warehouse_stock' => $this->rows(ProductWarehouseStock::class),
            'stock_movements' => $this->rows(StockMovement::class),
            'invoices'        => $this->rows(Invoice::class),
            'invoice_lines'   => $this->rows(InvoiceLine::class),
            'purchases'       => $this->rows(Purchase::class),
            'purchase_lines'  => $this->rows(PurchaseLine::class),
            'returns'         => $this->rows(ReturnDocument::class),
            'return_lines'    => $this->rows(ReturnLine::class),
            'payments'        => $this->rows(Payment::class),
            'payment_allocations' => $this->rows(PaymentAllocation::class),
            'journal_entries' => $this->rows(JournalEntry::class),
            'journal_lines'   => $this->rows(JournalLine::class),
        ];
    }

    /** @param class-string<\Illuminate\Database\Eloquent\Model> $model */
    private function rows(string $model): array
    {
        return $model::query()->get()->map->toArray()->all();
    }

    private function revokeOtherTokens(Request $request): void
    {
        $currentTokenId = $request->user()->currentAccessToken()?->getKey();

        if ($currentTokenId !== null) {
            $request->user()->tokens()->where('id', '!=', $currentTokenId)->delete();
        }
    }

    /** @return array<string, mixed> */
    private function userPayload(User $user): array
    {
        return [
            'id'          => $user->id,
            'name'        => $user->name,
            'email'       => $user->email,
            'role'        => $user->role,
            'employee_id' => $user->employee_id,
            'tenant_id'   => $user->tenant_id,
            'preferences' => $user->preferences ?? ['locale' => 'ar', 'theme' => 'system'],
        ];
    }
}
