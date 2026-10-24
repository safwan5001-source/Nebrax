<?php

namespace App\Services;

use App\Models\OnlinePaymentMethodSetting;
use App\Models\OnlinePaymentMethodSettingEvent;
use App\Models\PaymentGateway;
use App\Models\User;
use App\Support\OnlinePaymentMethodCatalog;
use App\Support\PaymentGatewayException;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;

/**
 * ═══════════════════════════════════════════════════════════════
 *  OnlinePaymentMethodSettingsService — وسائل الدفع الإلكتروني (mada/Visa/Mastercard/Apple Pay)
 * ═══════════════════════════════════════════════════════════════
 *  مصدر الحقيقة الواحد لحالة كل وسيلة؛ **لا يخلق مفاتيح ولا اتصالات**: يقرأ اتصالات `PaymentGateway` وقدرات محوّلها.
 *
 *  الحالة المحسوبة (لا تُخزَّن):
 *   • `unsupported`: لا اتصال لدى المؤسسة يعلن محوّله هذه الوسيلة.
 *   • `needs_setup`: يوجد اتصال يعلنها لكن لا اتصال **جاهز** (مفعَّل) أو أنها تحتاج إعداداً لدى المزوّد لا يستطيع أَوْج التحقق منه (Apple Pay، EXT-10).
 *   • `disabled`: مدعومة وجاهزة لكن المؤسسة لم تُظهرها للعميل (الافتراضي).
 *   • `enabled`: مدعومة وجاهزة وأظهرتها المؤسسة ⇒ **وحدها** تُعرض للعميل.
 *
 *  ما يعنيه «التفعيل» هنا بصدق: **إظهار** للعميل + بوابة جاهزية. لا يقيّد ما تقبله صفحة المزوّد المستضافة (واجهة الفواتير لدى Moyasar بلا معامل لتقييد الوسائل؛
 *  الوسائل تُضبط في لوحة المزوّد) ولا يغيّر أي قيد أو سند. والبوابة «الفعلية» تُحسب (أول اتصال جاهز بالاسم) ولا تُخزَّن: لا توجيه متعدد البوابات قبل H2-04.
 */
class OnlinePaymentMethodSettingsService
{
    public function __construct(private readonly PaymentGatewayAdapterRegistry $adapters, private readonly TenantContext $tenant) {}

    /** @return list<array<string, mixed>> */
    public function overview(): array
    {
        $this->requireTenant();
        $gateways = PaymentGateway::query()->where('status', '!=', PaymentGateway::STATUS_REVOKED)->orderBy('name')->orderBy('id')->get();
        $stored = OnlinePaymentMethodSetting::query()->get()->keyBy('method_key');

        return array_map(fn (string $key) => $this->describe($key, $gateways->all(), (bool) ($stored[$key]->enabled ?? false)), OnlinePaymentMethodCatalog::KEYS);
    }

    /**
     * الوسائل التي يجوز عرضها للعميل الآن (حالتها `enabled`)، ومقيَّدة بالاتصال المستعمل إن عُيّن (لا تُعرض وسيلة لا يدعمها اتصال الطلب).
     *
     * @return list<string>
     */
    public function customerVisibleKeys(?string $gatewayId = null): array
    {
        $visible = [];
        foreach ($this->overview() as $row) {
            if ($row['status'] !== 'enabled') {
                continue;
            }
            if ($gatewayId !== null && ! collect($row['connections'])->contains(fn (array $c) => $c['gateway_id'] === $gatewayId && $c['eligible'])) {
                continue;
            }
            $visible[] = $row['key'];
        }

        return $visible;
    }

    /** @return array<string, mixed> */
    public function setEnabled(string $key, bool $enabled, ?User $actor, ?string $reason = null): array
    {
        $tenantId = $this->requireTenant();
        if (! OnlinePaymentMethodCatalog::isKnown($key)) {
            throw new PaymentGatewayException('method.unknown', 'وسيلة دفع غير معروفة.');
        }
        $reason = $reason === null || trim($reason) === '' ? null : trim($reason);
        if ($reason !== null && mb_strlen($reason) > 500) {
            throw new PaymentGatewayException('method.reason_too_long', 'السبب أطول من 500 حرف.');
        }

        DB::transaction(function () use ($key, $enabled, $actor, $reason, $tenantId): void {
            // قفل الاتصالات المرشَّحة قبل الحكم بالجاهزية: لا تفعيل على اتصال يُعلَّق/يُلغى بالتوازي.
            PaymentGateway::query()->where('status', '!=', PaymentGateway::STATUS_REVOKED)->orderBy('id')->lockForUpdate()->get();
            $gateways = PaymentGateway::query()->where('status', '!=', PaymentGateway::STATUS_REVOKED)->orderBy('name')->orderBy('id')->get()->all();
            $row = OnlinePaymentMethodSetting::query()->where('method_key', $key)->lockForUpdate()->first();
            $from = $row === null ? null : (bool) $row->enabled;

            if ($enabled) {
                $status = $this->describe($key, $gateways, $from ?? false)['status'];
                if ($status === 'unsupported') {
                    throw new PaymentGatewayException('method.unsupported', 'لا يوجد اتصال بوابة يدعم هذه الوسيلة؛ أضف اتصالاً مدعوماً أولاً.');
                }
                if ($status === 'needs_setup') {
                    throw new PaymentGatewayException('method.needs_setup', 'الوسيلة غير جاهزة: فعّل اتصال بوابة يدعمها وأكمل إعداد المزوّد المطلوب.');
                }
            }
            if (($from ?? false) === $enabled) {
                return;   // لا تغيير (الغياب = معطّلة) ⇒ لا صف ولا حدث
            }

            if ($row === null) {
                $row = new OnlinePaymentMethodSetting();
                $row->method_key = $key;
            }
            $row->enabled = $enabled;
            $row->updated_by = $actor?->id;
            $row->save();

            $event = new OnlinePaymentMethodSettingEvent();
            $event->method_key = $key;
            $event->enabled_from = $from;
            $event->enabled_to = $enabled;
            $event->actor_id = $actor?->id;
            $event->reason = $reason;
            $event->save();
        });

        return collect($this->overview())->firstWhere('key', $key);
    }

    /**
     * @param  list<PaymentGateway>  $gateways
     * @return array<string, mixed>
     */
    private function describe(string $key, array $gateways, bool $enabled): array
    {
        $connections = [];
        foreach ($gateways as $gateway) {
            if (! $this->adapters->has((string) $gateway->provider)) {
                continue;
            }
            $caps = $this->adapters->for((string) $gateway->provider)->capabilities();
            if (! $caps->supportsMethod($key)) {
                continue;
            }
            $needsProviderSetup = in_array($key, $caps->methodsRequiringProviderSetup, true);
            // جاهز = مفعَّل **ومتحقَّق منه** لمزوّد حقيقي (تدوير الأسرار يصفّر التحقق فيرفض المنسّق كل محاولة جديدة `gateway_unverified`).
            $usable = $gateway->isUsable() && ! ($gateway->requiresVerification() && $gateway->verified_at === null);
            $connections[] = [
                'gateway_id' => (string) $gateway->id,
                'gateway_name' => $gateway->name,
                'provider' => $gateway->provider,
                'environment' => $gateway->environment,
                'usable' => $usable,
                'requires_provider_setup' => $needsProviderSetup,
                'eligible' => $usable && ! $needsProviderSetup,
            ];
        }

        $eligible = array_values(array_filter($connections, fn (array $c) => $c['eligible']));
        $reason = null;
        if ($connections === []) {
            $status = 'unsupported';
        } elseif ($eligible === []) {
            $status = 'needs_setup';
            $reason = collect($connections)->every(fn (array $c) => $c['requires_provider_setup']) ? 'provider_setup_required' : 'no_usable_gateway';
        } else {
            $status = $enabled ? 'enabled' : 'disabled';
        }

        return [
            'key' => $key,
            'status' => $status,
            'reason' => $reason,
            'enabled' => $enabled,
            'customer_visible' => $status === 'enabled',
            'connections' => $connections,
            // البوابة الفعلية محسوبة (أول اتصال جاهز) لا مخزَّنة؛ اختيار الافتراضية غير متاح قبل التوجيه متعدد البوابات (H2-04).
            'effective_gateway' => $eligible === [] ? null : ['id' => $eligible[0]['gateway_id'], 'name' => $eligible[0]['gateway_name']],
            'multiple_eligible_gateways' => count($eligible) > 1,
            'default_gateway_selectable' => false,
            'usage' => ['invoices' => true, 'store' => false],   // الفواتير: رابط الدفع مبنيّ؛ المتجر: H4 غير مبنيّ ⇒ لا يُعرض فيه شيء
        ];
    }

    private function requireTenant(): string
    {
        $id = $this->tenant->id();
        if ($id === null) {
            throw new PaymentGatewayException('method.tenant_required', 'سياق المؤسسة مطلوب.');
        }

        return (string) $id;
    }
}
