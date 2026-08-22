<?php

namespace App\Http\Middleware;

use App\Models\CreditNote;
use App\Models\ReturnDocument;
use App\Services\TenantApplicationService;
use Closure;
use Illuminate\Http\Request;
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

    public function __construct(private TenantApplicationService $applications) {}

    public function handle(Request $request, Closure $next, string $operation): Response
    {
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
        $status = $this->applications->statusFor($applicationKey);

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

    private function typeFor(Request $request, string $operation): ?string
    {
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
                default => throw new \LogicException("عملية تطبيق مشتركة غير معروفة: {$operation}"),
            };
        }

        $inputType = $request->input('type');

        return in_array($inputType, ['sales', 'purchase'], true) ? $inputType : null;
    }

    public static function hiddenPurchaseAttribute(string $operation): string
    {
        return "application.hidden_purchase.{$operation}";
    }
}
