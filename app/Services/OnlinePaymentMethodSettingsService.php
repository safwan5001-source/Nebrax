<?php

namespace App\Services;

use App\Models\OnlinePaymentMethodSetting;
use App\Models\OnlinePaymentMethodSettingEvent;
use App\Models\PaymentGateway;
use App\Models\Tenant;
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
 *  **مفهومان منفصلان (Beta):**
 *   • `enabled` = اختيار التاجر (مخزَّن): هل تُعرض الوسيلة للعميل؟ يجوز تفعيلها قبل جاهزية أي بوابة.
 *   • `ready` = جاهزية التحصيل (محسوبة، لا تُخزَّن): يوجد اتصال يعلن محوّله الوسيلة وهو نشط ومتحقَّق منه ولا يحتاج إعداداً غير قابل للتحقق (Apple Pay، EXT-10).
 *  التفعيل لا يجعل الوسيلة قابلة للتحصيل؛ والتحصيل لا يجري إلا بـ`ready` (يفرضه مسار الدفع نفسه، لا هذه الخدمة).
 *
 *  الحالة المحسوبة (`status`):
 *   • `enabled`: مفعَّلة وجاهزة ⇒ تُعرض وتُحصَّل.
 *   • `enabled_not_ready`: مفعَّلة لكن غير جاهزة ⇒ تُعرض للعميل، وأي محاولة دفع بها تُرفض قبل أي محاولة تحصيل (`reason` يشرح السبب).
 *   • `disabled`: غير مفعَّلة وجاهزة (الافتراضي).
 *   • `needs_setup` / `unsupported`: غير مفعَّلة وغير جاهزة (يوجد اتصال يعلنها لكنه غير جاهز / لا اتصال يعلنها).
 *
 *  «التفعيل» لا يقيّد ما تقبله صفحة المزوّد المستضافة (واجهة الفواتير لدى Moyasar بلا معامل لتقييد الوسائل؛ الوسائل تُضبط في لوحة المزوّد) ولا يغيّر أي قيد أو سند.
 *  والبوابة «الفعلية» تُحسب (أول اتصال جاهز بالاسم) ولا تُخزَّن: لا توجيه متعدد البوابات قبل H2-04.
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
     * الوسائل **القابلة للتحصيل** الآن (مفعَّلة **وجاهزة**، حالتها `enabled`)، ومقيَّدة بالاتصال المستعمل إن عُيّن (لا تُعرض وسيلة لا يدعمها اتصال الطلب).
     * هذا مسار رابط الدفع: له اتصال محدَّد فلا معنى لعرض وسيلة غير جاهزة. أما المتجر فيعرض المفعَّلة وإن لم تجهز (انظر `enabledKeys`).
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

    /**
     * كل الوسائل التي اختار التاجر إظهارها (`enabled`) بصرف النظر عن الجاهزية، بترتيب الكتالوج. الجاهزية في `overview()` (`ready`).
     *
     * @return list<array<string, mixed>>
     */
    public function enabledRows(): array
    {
        return array_values(array_filter($this->overview(), fn (array $row): bool => $row['enabled'] === true));
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
            // مرساة المستأجر أولاً: تسلسل أول تفعيل متزامن لنفس الوسيلة (قفل صف غير موجود لا يحمي) فلا انتهاك فريد 500.
            Tenant::query()->whereKey($tenantId)->lockForUpdate()->first();
            $row = OnlinePaymentMethodSetting::query()->where('method_key', $key)->lockForUpdate()->first();
            $from = $row === null ? null : (bool) $row->enabled;

            // Beta: التفعيل اختيار تاجر لا يشترط جاهزية بوابة (الجاهزية تُفرض عند التحصيل لا هنا).
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
        $ready = $eligible !== [];
        $reason = null;
        if (! $ready) {
            $reason = match (true) {
                $connections === [] => 'no_gateway',
                collect($connections)->every(fn (array $c) => $c['requires_provider_setup']) => 'provider_setup_required',
                default => 'no_usable_gateway',
            };
        }
        $status = match (true) {
            $enabled && $ready => 'enabled',
            $enabled => 'enabled_not_ready',
            $ready => 'disabled',
            $connections === [] => 'unsupported',
            default => 'needs_setup',
        };

        return [
            'key' => $key,
            'status' => $status,
            'reason' => $reason,
            'enabled' => $enabled,
            'ready' => $ready,
            // المفعَّلة تُعرض للعميل (المتجر) وإن لم تجهز؛ التحصيل مشروط بـ`ready` فقط.
            'customer_visible' => $enabled,
            'connections' => $connections,
            // البوابة الفعلية محسوبة (أول اتصال جاهز) لا مخزَّنة؛ اختيار الافتراضية غير متاح قبل التوجيه متعدد البوابات (H2-04).
            'effective_gateway' => $eligible === [] ? null : ['id' => $eligible[0]['gateway_id'], 'name' => $eligible[0]['gateway_name']],
            'multiple_eligible_gateways' => count($eligible) > 1,
            'default_gateway_selectable' => false,
            'usage' => ['invoices' => true, 'store' => true],   // الفواتير: رابط الدفع؛ المتجر: تُعرض المفعَّلة في Checkout (التحصيل مشروط بالجاهزية)
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
