<?php

namespace App\Http\Middleware;

use App\Models\CreditNote;
use App\Models\ReturnDocument;
use App\Services\Accounting\CreditNoteOwnershipResolver;
use App\Services\ApplicationOperationClassifier;
use App\Services\EntitlementCohortEnforcer;
use App\Services\EntitlementShadowEvaluator;
use App\Services\TenantApplicationService;
use App\Support\ApplicationAccessReason;
use App\Support\ApplicationAccessResult;
use Closure;
use Illuminate\Database\Eloquent\ModelNotFoundException;
use Illuminate\Http\Request;
use RuntimeException;
use Symfony\Component\HttpFoundation\Response;

/**
 * يفرض حالة التطبيق على عملية مشتركة حين تحددها بياناتها، لا اسم مسارها.
 *
 * الاستخدام:
 * - ->middleware(EnsureApplicationOperationActive::class . ':return')
 * - ->middleware(EnsureApplicationOperationActive::class . ':credit-note')
 *
 * اليوم لا يحتاج فرع المبيعات إلى حارس لأن `sales.invoicing` قدرة إلزامية.
 * أما أي عملية purchase داخل المسار المشترك فتتبع `purchases.cycle`، سواء جاء
 * النوع من `{type}` أو من الحمولة أو من المستند المخزّن قبل عرض/ترحيل العملية.
 */
class EnsureApplicationOperationActive
{
    private const PURCHASES_APPLICATION = 'purchases.cycle';

    /** @var list<string> */
    private const SUPPORTED_OPERATIONS = ['return', 'credit-note'];

    public function __construct(
        private TenantApplicationService $applications,
        private CreditNoteOwnershipResolver $creditNoteOwnership,
        private ApplicationOperationClassifier $operations,
        private EntitlementShadowEvaluator $shadow,
        private EntitlementCohortEnforcer $cohortEnforcement,
    ) {}

    public function handle(Request $request, Closure $next, string $operation): Response
    {
        $this->assertSupportedOperation($operation);
        $type = $this->typeFor($request, $operation);

        if ($type === 'purchase') {
            $this->assertActive($request, self::PURCHASES_APPLICATION);
        }

        // الاستعلام العام بلا `type` مورد مشترك: لا نرفض مرتجعات/إشعارات البيع
        // لمجرد تعطيل المشتريات، لكن لا نسمح له بإعادة سجلات المشتريات المعطلة.
        if ($type === null
            && $request->isMethodSafe()
            && $this->applications->statusFor(self::PURCHASES_APPLICATION) === 'disabled') {
            $request->attributes->set($this->hiddenPurchaseAttribute($operation), true);
        }

        return $next($request);
    }

    private function assertActive(Request $request, string $applicationKey): void
    {
        $this->cohortEnforcement->enforce($request, $applicationKey, $this->operations->classify($request));
        $status = $this->applications->statusFor($applicationKey);
        $legacy = match (true) {
            $status === 'enabled' => ApplicationAccessResult::allowed(),
            $status === 'suspended' && $request->isMethodSafe() => ApplicationAccessResult::readOnly(ApplicationAccessReason::APPLICATION_SUSPENDED_READ_ONLY),
            default => ApplicationAccessResult::denied(ApplicationAccessReason::APPLICATION_DISABLED),
        };
        $this->shadow->observe($request, $applicationKey, $this->operations->classify($request), $legacy);

        if ($status === 'enabled') {
            return;
        }

        if ($status === 'suspended' && $request->isMethodSafe()) {
            return;
        }

        abort(403, $status === 'suspended'
            ? 'هذه القدرة معلّقة (قراءة فقط) — أعد تفعيلها لإجراء تغييرات جديدة.'
            : 'هذه القدرة غير مفعّلة لهذه المؤسسة.');
    }

    private function assertSupportedOperation(string $operation): void
    {
        if (! in_array($operation, self::SUPPORTED_OPERATIONS, true)) {
            abort(403, 'العملية المطلوبة غير متاحة لهذه المؤسسة.');
        }
    }

    private function typeFor(Request $request, string $operation): ?string
    {
        if ($operation === 'credit-note') {
            return $this->creditNoteTypeFor($request);
        }

        // مسارات مصادر المرتجعات تملك `{type}` صريحاً؛ وهو يسبق `id` الذي يشير
        // هناك إلى الفاتورة/المشتريات المصدر لا إلى ReturnDocument.
        $routeType = $request->route('type');
        if (in_array($routeType, ['sales', 'purchase'], true)) {
            return $routeType;
        }

        // المسارات التي تحمل معرف المستند النهائي لا تثق في query/body؛ الملكية
        // تُستمد من النوع المحفوظ حتى لا يختار العميل حارساً أضعف.
        $id = $request->route('id');
        if (is_string($id) && $id !== '') {
            return match ($operation) {
                'return' => ReturnDocument::findOrFail($id)->type,
                'credit-note' => CreditNote::findOrFail($id)->type,
            };
        }

        $inputType = $request->input('type');

        return in_array($inputType, ['sales', 'purchase'], true) ? $inputType : null;
    }

    /**
     * يفحص إنشاء الإشعار ومثيله المحفوظ بالمحلل نفسه. صف متناقض لا يتحول
     * إلى ملكية مبيعات أو مشتريات بالتخمين، ولا يكشف رسالة داخلية للعميل.
     */
    private function creditNoteTypeFor(Request $request): ?string
    {
        try {
            $id = $request->route('id');
            if (is_string($id) && $id !== '') {
                return $this->creditNoteOwnership->forNote(CreditNote::findOrFail($id));
            }

            $data = [
                'original_purchase_id' => $request->input('original_purchase_id'),
                'original_invoice_id' => $request->input('original_invoice_id'),
                'type' => $request->input('type'),
            ];

            // قائمة مشتركة بلا مرشح تبقى قابلة للقراءة وتستخدم فلتر الإخفاء
            // أدناه؛ وإنشاء مستند مستقل بلا نوع يصل إلى FormRequest ليعيد خطأ
            // التحقق المرتبط بالحقل نفسه، لا افتراضاً ضمنياً.
            if ($data['original_purchase_id'] === null
                && $data['original_invoice_id'] === null
                && $data['type'] === null) {
                return null;
            }

            return $this->creditNoteOwnership->forData($data);
        } catch (ModelNotFoundException $exception) {
            throw $exception;
        } catch (RuntimeException) {
            abort(422, 'مصدر الإشعار غير صالح.');
        }
    }

    public static function hiddenPurchaseAttribute(string $operation): string
    {
        return "application.hidden_purchase.{$operation}";
    }
}
