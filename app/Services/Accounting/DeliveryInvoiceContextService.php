<?php

namespace App\Services\Accounting;

use App\Models\DeliveryInvoiceContext;
use App\Models\DeliveryPlatformProfile;
use App\Models\Invoice;
use App\Models\User;
use App\Services\DeliveryPlatformConfigService;
use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * يثبّت سياق منصة توصيل على فاتورة — DLV-ACCOUNTING-1 (DG-2).
 *
 * **تسجيل فقط**: لا يُنشئ فاتورة ولا سند قبض ولا قيداً. يستهلك الإعداد
 * المعتمد فعلاً عبر `DeliveryPlatformConfigService::resolve()` (DLV-FOUNDATION-1)
 * فيثبّت لقطة الفرع/القناة/الملف/النسخة لحظة التسجيل — لا مرجعاً حيّاً.
 *
 * **idempotent**: `record()` لفاتورة تحمل سياقاً مسجَّلاً مسبقاً بنفس الملف
 * والنسخة تعيد الصف القائم (لا صفّ ثانٍ، لا خطأ) — إعادة محاولة بعد استجابة
 * ملتبسة آمنة. تعارض صريح (ملف/نسخة مختلفة) يُرفض؛ السياق لا يُعدَّل أبداً.
 */
class DeliveryInvoiceContextService
{
    public function __construct(private readonly DeliveryPlatformConfigService $configService) {}

    /**
     * @param  array{sales_channel_id?:string,version_id?:string,external_order_reference?:?string}  $options
     */
    public function record(
        Invoice $invoice,
        DeliveryPlatformProfile $profile,
        array $options = [],
        ?User $actor = null,
    ): DeliveryInvoiceContext {
        return DB::transaction(function () use ($invoice, $profile, $options, $actor) {
            $locked = Invoice::query()->whereKey($invoice->getKey())->lockForUpdate()->first();
            if ($locked === null) {
                throw new RuntimeException('الفاتورة يجب أن تخص المستأجر النشط.');
            }

            $existing = DeliveryInvoiceContext::query()->where('invoice_id', $locked->id)->first();

            $resolved = $this->configService->resolve($profile, $locked->branch_id, $options['version_id'] ?? null);
            if ($resolved === null) {
                throw new RuntimeException('منصة التوصيل بلا نسخة تكوين فعّالة.');
            }

            if ($existing !== null) {
                if ((string) $existing->delivery_platform_profile_id !== (string) $profile->id
                    || (string) $existing->delivery_platform_profile_version_id !== (string) $resolved['version_id']) {
                    throw new RuntimeException('الفاتورة مرتبطة بسياق منصة توصيل مختلف مسبقاً — السياق لا يُعدَّل.');
                }

                return $existing;
            }

            try {
                return DeliveryInvoiceContext::create([
                    'invoice_id' => $locked->id,
                    'sales_channel_id' => $resolved['sales_channel_id'],
                    'delivery_platform_profile_id' => $profile->id,
                    'delivery_platform_profile_version_id' => $resolved['version_id'],
                    'collection_mode' => $resolved['collection_mode'],
                    'external_order_reference' => $options['external_order_reference'] ?? null,
                    'created_by' => $actor?->id,
                ]);
            } catch (QueryException $e) {
                // سباق: سياق أُنشئ بين الفحص والإدراج (unique(invoice_id)) — يُعامَل كمتكرر إن لم يتعارض.
                $race = DeliveryInvoiceContext::query()->where('invoice_id', $locked->id)->first();
                if ($race !== null
                    && (string) $race->delivery_platform_profile_id === (string) $profile->id
                    && (string) $race->delivery_platform_profile_version_id === (string) $resolved['version_id']) {
                    return $race;
                }

                throw $e;
            }
        });
    }
}
