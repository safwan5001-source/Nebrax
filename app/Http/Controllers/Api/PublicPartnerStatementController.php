<?php

namespace App\Http\Controllers\Api;

use App\Services\Reporting\ReportService;
use App\Support\PartnerStatementEnvelope;
use App\Support\PublicApiErrorCode;
use App\Support\PublicApiResponse;
use App\Support\PublicMoney;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Log;
use Illuminate\Validation\ValidationException;

/**
 * Public API — كشف حساب طرف (عميل/مورد)، قراءة فقط.
 *
 * يُغلّف `ReportService::partnerStatement()` القائمة كما هي (لا منطق محاسبي موازٍ):
 * القيود المرحَّلة وحدها، رصيد جارٍ موجب = الطرف مدين لنا. النطاق على مستوى المستأجر
 * (كل الفروع) كبقية موارد الـ Public. المبالغ بالوحدات الصغرى. لا كتابة ولا أثر جانبي.
 *
 * AIA-0.1 — غلاف السلامة المالية: حقول **إضافية** (إجماليات من الصفوف الأصلية بأعداد صحيحة، اتجاه الرصيد،
 * نصوص العرض، فحوص السلامة، `report_status`) بعد الحقول القديمة التي تبقى حرفياً. الاتجاه لا يُقلب في الحقول القديمة.
 * SAR وحدها مدعومة (D-12 الخيار C)؛ لغيرها `report_status=unsupported` بلا `display`.
 *
 * سقف صفوف صلب: الاستجابة غير مقسّمة (الرصيد الجاري يحتاج التسلسل كاملاً)، فتجاوز
 * السقف يُرفض 422 ويُطلب تضييق الفترة — بدل اقتطاع صامت يفسد الرصيد الختامي.
 */
class PublicPartnerStatementController extends PublicApiController
{
    public const MAX_ROWS = 2000;

    public function show(Request $request, string $id, ReportService $reports): JsonResponse
    {
        $filters = $request->validate([
            'from' => ['sometimes', 'nullable', 'date_format:Y-m-d'],
            'to'   => ['sometimes', 'nullable', 'date_format:Y-m-d', 'after_or_equal:from'],
            'role' => ['sometimes', 'nullable', 'in:customer,supplier'],
        ]);

        // الطرف غير الموجود في مستأجر العميل ⇒ ModelNotFoundException ⇒ 404 موحّد.
        $statement = $reports->partnerStatement($id, array_filter([
            'from'         => $filters['from'] ?? null,
            'to'           => $filters['to'] ?? null,
            'partner_role' => $filters['role'] ?? null,
        ]));

        if (count($statement['rows']) > self::MAX_ROWS) {
            throw ValidationException::withMessages([
                'from' => 'الكشف يتجاوز '.self::MAX_ROWS.' حركة؛ ضيّق الفترة عبر from/to.',
            ]);
        }

        $rows = array_map(static fn (array $r): array => [
            'date'          => $r['date'],
            'number'        => $r['number'],
            'description'   => $r['description'],
            'debit_minor'   => PublicMoney::minor($r['debit']),
            'credit_minor'  => PublicMoney::minor($r['credit']),
            'balance_minor' => PublicMoney::minor($r['balance']),
            'source'        => $r['source'] ? ['kind' => $r['source']['kind'], 'id' => $r['source']['id']] : null,
        ], $statement['rows']);

        $currency = PublicMoney::currency($request);
        $envelope = PartnerStatementEnvelope::build($statement, $filters['role'] ?? null, $currency);

        if ($envelope['integrity']['status'] === 'failed') {
            // لا قيم ولا أسماء أطراف في السجل: معرّف الفحوص الفاشلة فقط.
            Log::error('public_api.statement_integrity_failed', [
                'request_id' => PublicApiResponse::requestId($request),
                'failed'     => $envelope['integrity']['failed_checks'] ?? [],
            ]);

            if (config('public_api.statement_reject_on_integrity_failure')) {
                return PublicApiResponse::error(
                    $request,
                    PublicApiErrorCode::INTERNAL_ERROR,
                    'Statement integrity verification failed; no data is returned.',
                    500,
                    ['reason' => 'report_integrity_failed'],
                );
            }
        }

        return PublicApiResponse::success($request, [
            'partner'               => $statement['partner'],
            'currency'              => $currency,
            'from'                  => $filters['from'] ?? null,
            'to'                    => $filters['to'] ?? null,
            'opening_balance_minor' => PublicMoney::minor($statement['opening_balance']),
            'rows'                  => $rows,
            'closing_balance_minor' => PublicMoney::minor($statement['closing_balance']),
        ] + $envelope);
    }
}
