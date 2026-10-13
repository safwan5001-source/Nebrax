<?php

namespace App\Services\DeliveryHub;

use App\Support\DeliveryProviderReadiness;

/**
 * حارس خادم لبوابة جاهزية المزوّد (INT-READY-1، R-GATE-2).
 *
 * أي مسار مستقبلي يبدأ تفويضاً أو ربط حساب تاجر أو مزامنة طلبات لمزوّد يجب أن
 * يستدعي هذا الحارس أولاً، فيُرفض بـ`409 provider_not_ready` مهما أرسل العميل.
 * الواجهة مجاملة لا ضابط.
 *
 * **غير موصول اليوم بأي مسار عمداً.** لا يوجد مسار تفويض/ربط/مزامنة لمزوّد، ولا
 * يُستدعى من `DeliveryConnectorAccountService::create` — نقطة الاستقبال الموقّعة
 * من أَوْج (HMAC) قدرة مختلفة وليست ربطاً بمزوّد، وتبقى كما هي. تحويل الحارس إلى
 * HTTP مسؤولية المستدعي بالاتفاق نفسه في `DeliveryConnectorAccountController::failure`
 * (`{message, error_code}` + `status`).
 *
 * فشل مغلق: مفتاح غير معروف = غير جاهز بالرمز نفسه (لا كشف ولا استثناء مختلف).
 * لا يقرأ بيانات مستأجر ولا يكتب شيئاً.
 */
class DeliveryProviderReadinessGate
{
    public const ERROR_CODE = 'provider_not_ready';

    /** @var array<string, array<string, mixed>> */
    private array $rows;

    /**
     * `$rows` للاختبار فقط (مسار الجاهزية الإيجابي). الإنتاج يستعمل السجلّ الثابت.
     * الصفوف تُتحقَّق عند البناء، فسجلّ متناقض لا يُنشئ حارساً.
     *
     * @param  array<string, array<string, mixed>>|null  $rows
     */
    public function __construct(?array $rows = null)
    {
        $this->rows = $rows ?? DeliveryProviderReadiness::all();
        DeliveryProviderReadiness::validate($this->rows);
    }

    public function canConnect(string $platformKey): bool
    {
        return ($this->rows[$platformKey]['connect_enabled'] ?? false) === true;
    }

    /** المزامنة تتطلب الربط أيضاً: `sync_enabled` وحدها لا تكفي. */
    public function canSync(string $platformKey): bool
    {
        return $this->canConnect($platformKey)
            && ($this->rows[$platformKey]['sync_enabled'] ?? false) === true;
    }

    public function assertConnectable(string $platformKey): void
    {
        if (! $this->canConnect($platformKey)) {
            throw $this->notReady();
        }
    }

    public function assertSyncable(string $platformKey): void
    {
        if (! $this->canSync($platformKey)) {
            throw $this->notReady();
        }
    }

    private function notReady(): DeliveryConnectorException
    {
        return new DeliveryConnectorException(self::ERROR_CODE, 'هذا التكامل غير متاح بعد.', 409);
    }
}
