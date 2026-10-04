<?php

namespace App\Services\Commerce;

use App\Models\CommerceFacet;
use App\Models\CommerceFacetValue;
use App\Models\CommerceGiftSetting;
use App\Models\CommerceProductAddon;
use App\Models\CommerceProductContentBlock;
use App\Models\CommerceProductPersonalizationField;
use App\Models\CommerceDeliveryScheduleSetting;
use App\Models\CommerceDeliverySlot;
use App\Models\Storefront;
use App\Models\StorefrontBusinessProfile;
use App\Models\StorefrontPresentation;
use App\Support\Commerce\BusinessVertical;
use App\Support\Commerce\FlowersStarterCatalog;
use App\Support\Commerce\StorefrontPresentationNormalizer;
use App\Support\Commerce\VerticalCapability;
use App\Tenancy\TenantContext;
use Illuminate\Support\Facades\DB;
use RuntimeException;

/**
 * FLOWERS-H14 / ADR-25 — تهيئة ما بعد اختيار ملف «الهدايا والورود».
 *
 * **لا تفرض شيئاً ولا تحذف شيئاً.** ما تفعله خدمتان منفصلتان:
 *  1. `status()` — قراءة فقط: لكل قدرة موصى بها، هل هي مهيَّأة فعلاً في هذا المتجر؟ تُشتقّ الحالة من
 *     الإعداد الحقيقي (سياسة الإهداء، جدولة التسليم، عدد المنتجات ذات التخصيص/الإضافات/المحتوى،
 *     أقسام الصفحة الرئيسية…) لا من علَم مخزَّن، فلا تكذب إن غيّر التاجر شيئاً بنفسه.
 *  2. `previewStarters()` / `applyStarters()` — إضافة قيم المناسبات والمُهدى إليه المبدئية. إضافيٌّ بحت
 *     ومثاليّ التكرار: بُعد/قيمة موجودة (بالـslug أو الاسم، فعّالة أو معطّلة، حتى لو أعاد التاجر
 *     تسميتها) **تبقى كما هي**؛ لا إعادة تفعيل ولا تعديل ولا حذف. الكتابة عبر `CommerceFacetService`
 *     نفسه (قيوده وحدوده)، فلا مسار موازٍ.
 *
 * سياسة الإهداء وجدولة التسليم والإضافات والتخصيص **تبقى قرارات تاجر** (سياسة تُضبط لا تُفرض) —
 * هذه الخدمة تعرض حالتها ولا تفعّلها. أقسام الصفحة الرئيسية كذلك: المُنشئ يملك مسودة المظهر ومراجعاتها.
 * تغيير الملف لا يمسّ أيّاً مما سبق (انظر `StorefrontBusinessProfileService`).
 */
final class StorefrontVerticalSetupService
{
    public function __construct(private readonly CommerceFacetService $facets) {}

    /**
     * @return array{vertical: string, items: list<array<string, mixed>>}
     */
    public function status(Storefront $storefront): array
    {
        $this->assertOwned($storefront);
        $vertical = $this->verticalOf($storefront);
        if ($vertical !== BusinessVertical::FlowersGifts) {
            return ['vertical' => $vertical->value, 'items' => []];
        }

        $channelId = $storefront->sales_channel_id;
        $facetValues = fn (string $systemKey): int => CommerceFacetValue::query()
            ->where('is_active', true)
            ->whereIn('commerce_facet_id', CommerceFacet::query()->where('system_key', $systemKey)->where('is_active', true)->select('id'))
            ->count();

        $gift = CommerceGiftSetting::query()->where('sales_channel_id', $channelId)->first();
        $schedule = CommerceDeliveryScheduleSetting::query()->where('sales_channel_id', $channelId)->first();
        $slots = $schedule?->is_enabled
            ? CommerceDeliverySlot::query()->where('sales_channel_id', $channelId)->where('is_active', true)->count()
            : 0;
        $scheduleOn = (bool) ($schedule?->is_enabled ?? false);
        $sections = $this->dataSectionCounts($storefront);

        $count = [
            VerticalCapability::Occasions->value => $facetValues('occasion'),
            VerticalCapability::Recipients->value => $facetValues('recipient'),
            VerticalCapability::GiftMessage->value => (bool) ($gift?->is_enabled ?? false) ? 1 : 0,
            VerticalCapability::Personalization->value => CommerceProductPersonalizationField::query()->where('is_active', true)->distinct()->count('product_id'),
            VerticalCapability::AddOns->value => CommerceProductAddon::query()->where('is_active', true)->distinct()->count('product_id'),
            VerticalCapability::DeliveryScheduling->value => $scheduleOn && $slots > 0 ? $slots : 0,
            // «يصل اليوم» يُشتقّ (ADR-20) من جدولة مفعّلة بنوافذ فعلية **ومخزن تنفيذ معيَّن للقناة** (ATS) — بدون
            // سياسة تنفيذ يقول الوعد `not_configured` لكل منتج، فلا نُظهرها مهيَّأة (FLOWERS-H16: وجدها اختبار الرحلة الكاملة).
            VerticalCapability::SameDayDelivery->value => $scheduleOn && $slots > 0 && $this->hasFulfillmentWarehouse($channelId) ? $slots : 0,
            VerticalCapability::StructuredContent->value => CommerceProductContentBlock::query()->where('is_active', true)->distinct()->count('product_id'),
            VerticalCapability::VerticalSections->value => $sections['draft'],
        ];

        // أين يضبطها التاجر — مفتاح واجهة لا رابط (الواجهة تعرف مساراتها).
        $manageIn = [
            VerticalCapability::Occasions->value => 'merchandising',
            VerticalCapability::Recipients->value => 'merchandising',
            VerticalCapability::GiftMessage->value => 'gift_settings',
            VerticalCapability::Personalization->value => 'products',
            VerticalCapability::AddOns->value => 'products',
            VerticalCapability::DeliveryScheduling->value => 'delivery_schedule',
            VerticalCapability::SameDayDelivery->value => 'delivery_schedule',
            VerticalCapability::StructuredContent->value => 'products',
            VerticalCapability::VerticalSections->value => 'store_builder',
        ];

        $items = [];
        foreach ($vertical->recommendedCapabilities() as $capability) {
            $n = $count[$capability->value];
            $item = [
                'key' => $capability->value,
                'available' => $capability->isAvailable(),
                'state' => $n > 0 ? 'configured' : 'not_configured',
                'count' => $n,
                'manage_in' => $manageIn[$capability->value],
            ];
            if ($capability === VerticalCapability::VerticalSections) {
                $item['published_count'] = $sections['published'];
            }
            $items[] = $item;
        }

        return ['vertical' => $vertical->value, 'items' => $items];
    }

    /**
     * ما سيُضاف لو طُبِّقت القيم المبدئية الآن. قراءة فقط.
     *
     * @return array{facets: list<array<string, mixed>>, would_create: int}
     */
    public function previewStarters(Storefront $storefront): array
    {
        $this->assertFlowersStore($storefront);

        return $this->summarize($this->plan());
    }

    /**
     * يضيف القيم المبدئية الناقصة فقط. مثاليّ التكرار؛ لا يعدّل ولا يحذف ولا يعيد تفعيل شيء قائم.
     *
     * @return array{facets: list<array<string, mixed>>, created: int}
     */
    public function applyStarters(Storefront $storefront): array
    {
        $this->assertFlowersStore($storefront);
        $tenantId = $this->tenantId();

        return DB::transaction(function () use ($tenantId) {
            // قفل صفّ المستأجر يُسلسل تطبيقين متزامنين، فلا يتنافسان على إنشاء البُعد نفسه.
            \App\Models\Tenant::query()->whereKey($tenantId)->lockForUpdate()->first();

            $created = 0;
            $report = [];
            foreach ($this->plan() as $facetPlan) {
                $facetId = $facetPlan['facet_id'];
                $row = [
                    'system_key' => $facetPlan['system_key'],
                    'facet' => $facetPlan['facet'],
                    'created_facet' => false,
                    'created_values' => [],
                    'existing_values' => $facetPlan['existing_values'],
                    'skipped_values' => [],
                ];

                if ($facetPlan['facet'] === 'blocked') {
                    $row['blocked_reason'] = 'key_taken';
                    $report[] = $row;

                    continue;
                }

                if ($facetPlan['facet'] === 'missing') {
                    $facet = $this->facets->createFacet([
                        'key' => $facetPlan['key'],
                        'system_key' => $facetPlan['system_key'],
                        'name' => $facetPlan['name'],
                        'name_en' => $facetPlan['name_en'],
                    ]);
                    $facetId = $facet['id'];
                    $row['facet'] = 'existing';
                    $row['created_facet'] = true;
                }

                $order = (int) (CommerceFacetValue::query()->where('commerce_facet_id', $facetId)->max('sort_order') ?? 0);
                foreach ($facetPlan['missing_values'] as $value) {
                    $order += 10;
                    try {
                        $this->facets->createValue($facetId, [
                            'slug' => $value['slug'],
                            'name' => $value['name'],
                            'name_en' => $value['name_en'],
                            'sort_order' => $order,
                        ]);
                        $row['created_values'][] = $value['slug'];
                        $created++;
                    } catch (CommerceTaxonomyConflictException $e) {
                        // حدّ القيم أو تعارض اسم/slug لم يظهر في الخطة (سباق): نتخطّى ونُبلغ، لا نفشل الكل.
                        $row['skipped_values'][] = ['slug' => $value['slug'], 'reason' => 'conflict'];
                    }
                }
                $report[] = $row;
            }

            return ['facets' => $report, 'created' => $created];
        });
    }

    /**
     * @return list<array<string, mixed>>
     */
    private function plan(): array
    {
        $plan = [];
        foreach (FlowersStarterCatalog::facets() as $starter) {
            $facet = CommerceFacet::query()->where('system_key', $starter['system_key'])->first();
            $state = 'existing';
            if ($facet === null) {
                // المفتاح النصي محجوز لبُعد غير نظامي للتاجر: لا نعيد تسميته ولا نصادر نظاميّته.
                $state = CommerceFacet::query()->where('key', $starter['key'])->exists() ? 'blocked' : 'missing';
            }

            $existingValues = [];
            $missing = [];
            $taken = ['slugs' => [], 'names' => []];
            if ($facet !== null) {
                foreach (CommerceFacetValue::query()->where('commerce_facet_id', $facet->id)->get(['slug', 'name', 'name_en']) as $v) {
                    $taken['slugs'][mb_strtolower(trim($v->slug))] = true;
                    foreach ([$v->name, $v->name_en] as $n) {
                        if ($n !== null && trim($n) !== '') {
                            $taken['names'][mb_strtolower(trim($n))] = true;
                        }
                    }
                }
            }

            if ($state !== 'blocked') {
                foreach ($starter['values'] as $value) {
                    $exists = isset($taken['slugs'][mb_strtolower($value['slug'])])
                        || isset($taken['names'][mb_strtolower($value['name'])])
                        || isset($taken['names'][mb_strtolower($value['name_en'])]);
                    if ($exists) {
                        $existingValues[] = $value['slug'];
                    } else {
                        $missing[] = $value;
                    }
                }
            }

            $plan[] = [
                'system_key' => $starter['system_key'],
                'key' => $starter['key'],
                'name' => $starter['name'],
                'name_en' => $starter['name_en'],
                'facet' => $state,
                'facet_id' => $facet?->id,
                'existing_values' => $existingValues,
                'missing_values' => $missing,
            ];
        }

        return $plan;
    }

    /**
     * @param  list<array<string, mixed>>  $plan
     * @return array{facets: list<array<string, mixed>>, would_create: int}
     */
    private function summarize(array $plan): array
    {
        $total = 0;
        $facets = [];
        foreach ($plan as $p) {
            $missing = array_map(static fn (array $v) => ['slug' => $v['slug'], 'name' => $v['name'], 'name_en' => $v['name_en']], $p['missing_values']);
            $total += count($missing);
            $row = [
                'system_key' => $p['system_key'],
                'facet' => $p['facet'],
                'name' => $p['name'],
                'name_en' => $p['name_en'],
                'missing_values' => $missing,
                'existing_values' => $p['existing_values'],
            ];
            if ($p['facet'] === 'blocked') {
                $row['blocked_reason'] = 'key_taken';
            }
            $facets[] = $row;
        }

        return ['facets' => $facets, 'would_create' => $total];
    }

    private function hasFulfillmentWarehouse(string $salesChannelId): bool
    {
        try {
            app(FulfillmentPolicyService::class)->resolveWarehouseFor($salesChannelId);

            return true;
        } catch (FulfillmentPolicyNotConfiguredException) {
            return false;
        }
    }

    /** @return array{draft: int, published: int} */
    private function dataSectionCounts(Storefront $storefront): array
    {
        $presentation = StorefrontPresentation::query()->where('storefront_id', $storefront->id)->first();
        $count = static function (mixed $config): int {
            $sections = is_array($config) ? ($config['homepage']['sections'] ?? []) : [];
            $n = 0;
            foreach (is_array($sections) ? $sections : [] as $section) {
                if (is_array($section)
                    && in_array($section['type'] ?? ($section['key'] ?? null), StorefrontPresentationNormalizer::HOME_DATA_SECTION_KEYS, true)
                    && ($section['visible'] ?? false) === true) {
                    $n++;
                }
            }

            return $n;
        };

        return [
            'draft' => $count($presentation?->draft_config),
            'published' => $count($presentation?->published_config),
        ];
    }

    private function verticalOf(Storefront $storefront): BusinessVertical
    {
        return BusinessVertical::fromStored(
            StorefrontBusinessProfile::query()->where('storefront_id', $storefront->id)->value('vertical'),
        );
    }

    private function assertFlowersStore(Storefront $storefront): void
    {
        $this->assertOwned($storefront);
        if ($this->verticalOf($storefront) !== BusinessVertical::FlowersGifts) {
            throw new \DomainException('اختر نشاط «الهدايا والورود» لهذا المتجر أولاً.');
        }
    }

    private function assertOwned(Storefront $storefront): void
    {
        if ($storefront->tenant_id !== $this->tenantId()) {
            throw new RuntimeException('المتجر غير موجود لهذا المستأجر.');
        }
    }

    private function tenantId(): string
    {
        $id = app(TenantContext::class)->id();
        if ($id === null) {
            throw new RuntimeException('لا سياق مستأجر نشط.');
        }

        return $id;
    }
}
