<?php

namespace App\Http\Controllers\Api;

use App\Services\AppBuilder\ActionDefinition;
use App\Services\AppBuilder\ActionRegistry;
use App\Services\AppBuilder\ComponentDefinition;
use App\Services\AppBuilder\ComponentRegistry;
use App\Services\AppBuilder\DataResourceRegistry;
use App\Services\AppBuilder\Label;
use App\Services\AppBuilder\ResourceDefinition;
use App\Services\AppBuilder\VisibilityOperator;
use App\Services\AppBuilder\VisibilitySignal;
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
                'resources' => array_map(
                    $this->resourceToArray(...),
                    DataResourceRegistry::definitions()
                ),
                'visibility_signals' => VisibilitySignal::ALL,
                'visibility_operators' => array_map(
                    $this->visibilityOperatorToArray(...),
                    VisibilityOperator::ALL
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
            'notes' => $definition->notes,
            'bindable_resources' => $definition->bindableResources,
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

    private function resourceToArray(ResourceDefinition $definition): array
    {
        return [
            'id' => $definition->id,
            'version' => $definition->version,
            'shape' => $definition->shape,
            'paginated' => $definition->paginated,
            'fields' => array_map(fn ($field) => [
                'key' => $field->key,
                'type' => $field->type,
                'localized' => $field->localized,
            ], $definition->fields),
            'query_params' => array_map(fn ($param) => [
                'key' => $param->key,
                'kind' => $param->kind,
            ], $definition->queryParams),
        ];
    }

    private function visibilityOperatorToArray(string $operator): array
    {
        $valueArity = 'single';
        if (in_array($operator, VisibilityOperator::NO_VALUE, true)) {
            $valueArity = 'none';
        } elseif (in_array($operator, VisibilityOperator::LIST_VALUE, true)) {
            $valueArity = 'list';
        }

        return [
            'type' => $operator,
            'value_arity' => $valueArity,
        ];
    }

    private function labelToArray(Label $label): array
    {
        return ['ar' => $label->ar, 'en' => $label->en];
    }
}
