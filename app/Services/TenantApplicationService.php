<?php

namespace App\Services;

use App\Models\TenantApplicationEvent;
use App\Models\TenantApplicationState;
use App\Models\User;
use App\Support\ApplicationCatalog;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * قرار كل مستأجر بتفعيل/إيقاف قدرة من ApplicationCatalog، مع فحص الاعتماديات
 * والإلزامية وسجل تدقيق. لا تتحكم هذه الخدمة في التنقل أو الصلاحيات — ذلك
 * إنفاذ لاحق منفصل عمداً (P2).
 */
class TenantApplicationService
{
    /**
     * دمج الكتالوج الثابت مع حالة المستأجر الحالية.
     *
     * @return array<string, array{group:string,maturity:string,mandatory:bool,dependencies:list<string>,enabled:bool,status:string,changed_by:?string,changed_at:?string,reason:?string}>
     */
    public function stateFor(): array
    {
        $rows = TenantApplicationState::query()->get()->keyBy('application_key');

        $result = [];
        foreach (ApplicationCatalog::all() as $key => $application) {
            $row = $rows->get($key);

            $result[$key] = [
                ...$application,
                'enabled' => $this->isEnabled($key, $application, $rows),
                'status' => $row?->status ?? 'disabled',
                'changed_by' => $row?->changed_by,
                'changed_at' => $row?->updated_at?->toIso8601String(),
                'reason' => $row?->reason,
            ];
        }

        return $result;
    }

    public function enable(string $key, ?User $actor, ?string $reason = null): TenantApplicationState
    {
        if (! ApplicationCatalog::exists($key)) {
            throw new RuntimeException('مفتاح تطبيق غير معروف.');
        }

        if (! ApplicationCatalog::isActivatable($key)) {
            throw new RuntimeException('هذه القدرة غير مبنية بعد ولا يمكن تفعيلها.');
        }

        $rows = TenantApplicationState::query()->get()->keyBy('application_key');
        $missing = array_values(array_filter(
            ApplicationCatalog::dependenciesFor($key),
            fn (string $dependency) => ! $this->isEnabled($dependency, ApplicationCatalog::find($dependency), $rows),
        ));

        if ($missing !== []) {
            throw new RuntimeException('اعتماديات غير مفعّلة: ' . implode('، ', $missing));
        }

        return DB::transaction(function () use ($key, $actor, $reason) {
            $state = TenantApplicationState::updateOrCreate(
                ['application_key' => $key],
                ['requested_enabled' => true, 'status' => 'enabled', 'changed_by' => $actor?->id, 'reason' => $reason],
            );

            TenantApplicationEvent::create([
                'application_key' => $key,
                'action' => 'enabled',
                'changed_by' => $actor?->id,
                'reason' => $reason,
            ]);

            return $state;
        });
    }

    public function disable(string $key, ?User $actor, ?string $reason = null): TenantApplicationState
    {
        $application = ApplicationCatalog::find($key);
        if ($application === null) {
            throw new RuntimeException('مفتاح تطبيق غير معروف.');
        }

        if ($application['mandatory']) {
            throw new RuntimeException('هذه القدرة إلزامية ولا يمكن إيقافها.');
        }

        $rows = TenantApplicationState::query()->get()->keyBy('application_key');
        $enabledKeys = array_keys(array_filter(
            ApplicationCatalog::all(),
            fn (array $app, string $appKey) => $this->isEnabled($appKey, $app, $rows),
            ARRAY_FILTER_USE_BOTH,
        ));

        $dependents = self::dependentsCurrentlyEnabled($key, ApplicationCatalog::all(), $enabledKeys);
        if ($dependents !== []) {
            throw new RuntimeException('توابع مفعّلة تعتمد على هذه القدرة: ' . implode('، ', $dependents));
        }

        return DB::transaction(function () use ($key, $actor, $reason) {
            $state = TenantApplicationState::updateOrCreate(
                ['application_key' => $key],
                ['requested_enabled' => false, 'status' => 'disabled', 'changed_by' => $actor?->id, 'reason' => $reason],
            );

            TenantApplicationEvent::create([
                'application_key' => $key,
                'action' => 'disabled',
                'changed_by' => $actor?->id,
                'reason' => $reason,
            ]);

            return $state;
        });
    }

    /**
     * منطق نقي معزول عن قاعدة البيانات وبيانات الكتالوج الحقيقية عمداً — يبقى
     * قابلاً للاختبار المباشر حتى لو لم يوجد اليوم مساران حقيقيان في الكتالوج
     * ينتجان مساراً إيجابياً هنا (كل اعتماديات القدرات غير الإلزامية اليوم
     * تنتهي عند قدرة إلزامية، فيُحجب الإيقاف بفحص `mandatory` أولاً).
     *
     * @param  array<string, array{dependencies:list<string>}>  $catalog
     * @param  list<string>  $enabledKeys
     * @return list<string>
     */
    public static function dependentsCurrentlyEnabled(string $key, array $catalog, array $enabledKeys): array
    {
        $enabled = array_flip($enabledKeys);

        return array_values(array_filter(
            array_keys($catalog),
            fn (string $candidate) => $candidate !== $key
                && isset($enabled[$candidate])
                && in_array($key, $catalog[$candidate]['dependencies'], true),
        ));
    }

    /** @param array{mandatory:bool}|null $application */
    private function isEnabled(string $key, ?array $application, $rows): bool
    {
        if ($application === null) {
            return false;
        }

        if ($application['mandatory']) {
            return true;
        }

        $row = $rows->get($key);

        return $row !== null && $row->requested_enabled;
    }
}
