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
 *  البوابة «الفعلية»: الافتراضية التي اختارها التاجر (`default_gateway_id`) إن جهزت، وإلا — حين لا اختيار — أول اتصال جاهز بالاسم. لا توجيه متعدد البوابات ولا تحويل تلقائي (H2-04).
 *  أماكن الاستخدام (`use_in_invoices`/`use_in_store`) مخزَّنة وتُفرض فعلاً؛ POS لا تكامل له فلا إعداد.
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

        return array_map(fn (string $key) => $this->describe($key, $gateways->all(), $stored[$key] ?? null), OnlinePaymentMethodCatalog::KEYS);
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
            if (! $row['enabled'] || ! $row['usage']['invoices']) {
                continue;
            }
            // مع اتصال محدَّد (رابط الدفع) يكفي أن يكون هو مؤهلاً للوسيلة؛ بدونه نشترط جاهزية الوسيلة.
            $eligible = $gatewayId === null
                ? $row['ready']
                : collect($row['connections'])->contains(fn (array $c) => $c['gateway_id'] === $gatewayId && $c['eligible']);
            if ($eligible) {
                $visible[] = $row['key'];
            }
        }

        return $visible;
    }

    /**
     * الوسائل التي اختار التاجر إظهارها **في المتجر** (`enabled` و`use_in_store`) بصرف النظر عن الجاهزية، بترتيب الكتالوج. الجاهزية في `ready`.
     *
     * @return list<array<string, mixed>>
     */
    public function storeRows(): array
    {
        return array_values(array_filter($this->overview(), fn (array $row): bool => $row['enabled'] === true && $row['usage']['store'] === true));
    }

    /** @return array<string, mixed> */
    public function setEnabled(string $key, bool $enabled, ?User $actor, ?string $reason = null): array
    {
        return $this->updateSettings($key, ['enabled' => $enabled], $actor, $reason);
    }

    /**
     * يحفظ إعدادات «إدارة» الوسيلة فعلياً: `enabled` · `default_gateway_id` (null ⇒ تلقائي) · `use_in_invoices` · `use_in_store`. المفاتيح الغائبة لا تتغيّر.
     * لا إعداد وهمي: POS غير مدعوم بالتكامل فلا مفتاح له. البوابة الافتراضية يجب أن تكون اتصالاً غير ملغى **يعلن** الوسيلة؛ لا يشترط جاهزيته (Beta)،
     * لكنها إن لم تجهز فالوسيلة غير جاهزة ولا يُحوَّل التحصيل تلقائياً إلى بوابة أخرى. التغيير الفعلي وحده يُدقَّق (مرة واحدة).
     *
     * @param  array{enabled?: bool, default_gateway_id?: string|null, use_in_invoices?: bool, use_in_store?: bool}  $changes
     * @return array<string, mixed>
     */
    public function updateSettings(string $key, array $changes, ?User $actor, ?string $reason = null): array
    {
        $tenantId = $this->requireTenant();
        if (! OnlinePaymentMethodCatalog::isKnown($key)) {
            throw new PaymentGatewayException('method.unknown', 'وسيلة دفع غير معروفة.');
        }
        $reason = $reason === null || trim($reason) === '' ? null : trim($reason);
        if ($reason !== null && mb_strlen($reason) > 500) {
            throw new PaymentGatewayException('method.reason_too_long', 'السبب أطول من 500 حرف.');
        }

        DB::transaction(function () use ($key, $changes, $actor, $reason, $tenantId): void {
            // مرساة المستأجر أولاً: تسلسل أول تفعيل متزامن لنفس الوسيلة (قفل صف غير موجود لا يحمي) فلا انتهاك فريد 500.
            Tenant::query()->whereKey($tenantId)->lockForUpdate()->first();
            $row = OnlinePaymentMethodSetting::query()->where('method_key', $key)->lockForUpdate()->first();
            $existed = $row !== null;

            $current = [
                'enabled' => $row === null ? false : (bool) $row->enabled,
                'default_gateway_id' => $row?->default_gateway_id,
                'use_in_invoices' => $row === null ? true : (bool) $row->use_in_invoices,
                'use_in_store' => $row === null ? true : (bool) $row->use_in_store,
            ];
            $next = $current;
            foreach (array_keys($current) as $field) {
                if (array_key_exists($field, $changes)) {
                    $next[$field] = $changes[$field];
                }
            }

            if ($next['default_gateway_id'] !== null && $next['default_gateway_id'] !== $current['default_gateway_id']) {
                $this->assertSupportingConnection($key, (string) $next['default_gateway_id']);
            }

            $diff = array_filter(
                array_diff_key($next, ['enabled' => true]),
                fn ($value, $field) => $value !== $current[$field],
                ARRAY_FILTER_USE_BOTH,
            );
            if ($next['enabled'] === $current['enabled'] && $diff === []) {
                return;   // لا تغيير (الغياب = القيم الافتراضية) ⇒ لا صف ولا حدث
            }

            if ($row === null) {
                $row = new OnlinePaymentMethodSetting();
                $row->method_key = $key;
            }
            $row->enabled = $next['enabled'];
            $row->default_gateway_id = $next['default_gateway_id'];
            $row->use_in_invoices = $next['use_in_invoices'];
            $row->use_in_store = $next['use_in_store'];
            $row->updated_by = $actor?->id;
            $row->save();

            $event = new OnlinePaymentMethodSettingEvent();
            $event->method_key = $key;
            $event->enabled_from = $existed ? $current['enabled'] : null;
            $event->enabled_to = $next['enabled'];
            $event->actor_id = $actor?->id;
            $event->reason = $reason;
            $event->changes = $diff === [] ? null : json_encode(
                collect(array_keys($diff))->mapWithKeys(fn (string $field) => [$field => ['from' => $current[$field], 'to' => $next[$field]]])->all(),
                JSON_UNESCAPED_UNICODE,
            );
            $event->save();
        });

        return collect($this->overview())->firstWhere('key', $key);
    }

    /** الاتصال المختار غير ملغى ويعلن محوّله الوسيلة (من مستأجرنا حصراً: الاستعلام تحت نطاق المستأجر). */
    private function assertSupportingConnection(string $key, string $gatewayId): void
    {
        $gateway = PaymentGateway::query()->where('status', '!=', PaymentGateway::STATUS_REVOKED)->whereKey($gatewayId)->lockForUpdate()->first();
        if ($gateway === null || ! $this->adapters->has((string) $gateway->provider)
            || ! $this->adapters->for((string) $gateway->provider)->capabilities()->supportsMethod($key)) {
            throw new PaymentGatewayException('method.default_gateway_invalid', 'البوابة المختارة غير موجودة أو لا تدعم هذه الوسيلة.');
        }
    }

    /**
     * @param  list<PaymentGateway>  $gateways
     * @return array<string, mixed>
     */
    private function describe(string $key, array $gateways, ?OnlinePaymentMethodSetting $setting): array
    {
        $enabled = $setting !== null && (bool) $setting->enabled;
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

        // البوابة الافتراضية المخزَّنة تُحترم فقط إن بقي اتصالها قائماً ويعلن الوسيلة؛ وإن لم تجهز فالوسيلة غير جاهزة (لا تحويل تلقائي إلى بوابة أخرى).
        $storedDefault = $setting?->default_gateway_id;
        $default = $storedDefault === null ? null : collect($connections)->firstWhere('gateway_id', (string) $storedDefault);
        $candidates = $default !== null ? [$default] : $connections;
        $eligible = array_values(array_filter($candidates, fn (array $c) => $c['eligible']));
        $ready = $eligible !== [];
        $reason = null;
        if (! $ready) {
            $reason = match (true) {
                $connections === [] => 'no_gateway',
                collect($candidates)->every(fn (array $c) => $c['requires_provider_setup']) => 'provider_setup_required',
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
            // البوابة الفعلية: الافتراضية المختارة إن جهزت، وإلا (حين لا اختيار) أول اتصال جاهز بالاسم. لا توجيه متعدد البوابات قبل H2-04.
            'effective_gateway' => $eligible === [] ? null : ['id' => $eligible[0]['gateway_id'], 'name' => $eligible[0]['gateway_name']],
            'default_gateway_id' => $default['gateway_id'] ?? null,
            'multiple_eligible_gateways' => $default === null && count($eligible) > 1,
            'default_gateway_selectable' => $connections !== [],
            // أماكن الاستخدام المحفوظة فعلاً؛ `supported` ما يملك تكاملاً حقيقياً (POS لا تكامل له بعد فلا مفتاح).
            'usage' => [
                'invoices' => $setting === null ? true : (bool) $setting->use_in_invoices,
                'store' => $setting === null ? true : (bool) $setting->use_in_store,
                'pos' => false,
            ],
            'usage_supported' => ['invoices' => true, 'store' => true, 'pos' => false],
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
