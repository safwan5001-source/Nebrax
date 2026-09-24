<?php

namespace App\Http\Controllers\Api;

use App\Services\AppBuilder\ActionDefinition;
use App\Services\AppBuilder\ActionRegistry;
use App\Services\AppBuilder\ComponentDefinition;
use App\Services\AppBuilder\ComponentRegistry;
use App\Services\AppBuilder\Label;
use Illuminate\Http\JsonResponse;

/**
 * APP-BUILDER-5 — يُسلسِل `ComponentRegistry`/`ActionRegistry` (APP-BUILDER-3) إلى JSON
 * للمستهلك الحقيقي الأول: Inspector في مساحة عمل الـ Builder. بيانات منصّة ثابتة
 * (لا تُخصَّص لكل مستأجر) — بلا `TenantScope`، بلا `BaseModel`؛ صنفا القيمة
 * (`ComponentDefinition`/`ActionDefinition`) ليسا نموذجَي Eloquent فيُبنى الشكل هنا
 * مباشرةً بدل `JsonResource` (المصمَّم لموارد Eloquent).
 */
class AppBuilderRegistryController extends ApiController
{
    public function index(): JsonResponse
    {
        return response()->json([
            'data' => [
                'components' => array_map(
                    $this->componentToArray(...),
                    ComponentRegistry::definitions()
                ),
                'actions' => array_map(
                    $this->actionToArray(...),
                    ActionRegistry::definitions()
                ),
            ],
        ]);
    }

    private function componentToArray(ComponentDefinition $definition): array
    {
        return [
            'type' => $definition->type,
            'version' => $definition->version,
            'category' => $definition->category,
            'label' => $this->labelToArray($definition->label),
            'props' => array_map(fn ($prop) => [
                'key' => $prop->key,
                'type' => $prop->type,
                'required' => $prop->required,
                'label' => $this->labelToArray($prop->label),
                'default' => $prop->default,
                'enum_values' => $prop->enumValues,
            ], $definition->props),
            'children_rule' => [
                'kind' => $definition->childrenRule->kind,
                'suggested_child_type' => $definition->childrenRule->suggestedChildType,
            ],
            'actionable' => $definition->actionable,
            'injected_runtime_action_params' => $definition->injectedRuntimeActionParams,
            'bindable_resources' => $definition->bindableResources,
            'notes' => $definition->notes,
        ];
    }

    private function actionToArray(ActionDefinition $definition): array
    {
        return [
            'type' => $definition->type,
            'version' => $definition->version,
            'risk_class' => $definition->riskClass,
            'label' => $this->labelToArray($definition->label),
            'params' => array_map(fn ($param) => [
                'key' => $param->key,
                'type' => $param->type,
                'required' => $param->required,
                'label' => $this->labelToArray($param->label),
                'nullable' => $param->nullable,
                'default' => $param->default,
                'min_value' => $param->minValue,
            ], $definition->params),
            'dispatch_status' => $definition->dispatchStatus,
            'notes' => $definition->notes,
        ];
    }

    private function labelToArray(Label $label): array
    {
        return ['ar' => $label->ar, 'en' => $label->en];
    }
}
