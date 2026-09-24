<?php

namespace Tests\Feature;

use App\Services\AppBuilder\ChildrenRule;
use App\Services\AppBuilder\ComponentRegistry;
use App\Services\AppBuilder\PropDefinition;
use App\Services\AppBuilder\RuntimeCapabilities;
use Tests\TestCase;

/**
 * APP-BUILDER-3 — سجلّ بيانات المكوّنات، بلا قاعدة بيانات ولا HTTP.
 *
 * تشغيل: php artisan test --filter=ComponentRegistryTest
 */
class ComponentRegistryTest extends TestCase
{
    public function test_definitions_key_set_matches_runtime_capabilities_components_exactly(): void
    {
        $this->assertSame(
            array_keys(RuntimeCapabilities::COMPONENTS),
            array_keys(ComponentRegistry::definitions()),
            'سجلّ بيانات المكوّنات يجب أن يصف كل هوية مكوّن مدعومة فعلياً — لا أكثر ولا أقل.'
        );
    }

    public function test_every_definition_reports_its_own_type_and_the_shared_runtime_version(): void
    {
        foreach (ComponentRegistry::definitions() as $type => $definition) {
            $this->assertSame($type, $definition->type);
            $this->assertSame(RuntimeCapabilities::COMPONENTS[$type], $definition->version);
        }
    }

    public function test_every_prop_definition_key_is_unique_within_its_component(): void
    {
        foreach (ComponentRegistry::definitions() as $type => $definition) {
            $keys = array_map(fn (PropDefinition $prop) => $prop->key, $definition->props);
            $this->assertSame($keys, array_unique($keys), "مفاتيح خصائص {$type} يجب ألا تتكرر.");
        }
    }

    public function test_quantity_is_the_only_component_that_injects_a_runtime_action_param(): void
    {
        $definitions = ComponentRegistry::definitions();

        foreach ($definitions as $type => $definition) {
            if ($type === 'Quantity') {
                $this->assertSame(['quantity'], $definition->injectedRuntimeActionParams);

                continue;
            }
            $this->assertSame([], $definition->injectedRuntimeActionParams, "{$type} لا يُفترض أن يُلحق معاملات وقت تشغيل.");
        }
    }

    public function test_product_card_and_product_detail_and_product_list_and_cart_list_and_page_and_section_children_rules_match_evidence(): void
    {
        $definitions = ComponentRegistry::definitions();

        $this->assertSame(ChildrenRule::NONE, $definitions['ProductCard']->childrenRule->kind, 'ProductCard لا يرسم node.children إطلاقاً.');
        $this->assertSame(ChildrenRule::UNBOUNDED_ANY, $definitions['ProductDetail']->childrenRule->kind);
        $this->assertSame(ChildrenRule::UNBOUNDED_ANY, $definitions['ProductList']->childrenRule->kind);
        $this->assertSame(ChildrenRule::UNBOUNDED_ANY, $definitions['CartList']->childrenRule->kind);
        $this->assertSame(ChildrenRule::UNBOUNDED_ANY, $definitions['Page']->childrenRule->kind);
        $this->assertSame(ChildrenRule::UNBOUNDED_ANY, $definitions['Section']->childrenRule->kind);
    }

    public function test_variant_selector_is_not_actionable_despite_accepting_an_attached_action_at_schema_level(): void
    {
        $this->assertFalse(
            ComponentRegistry::definitions()['VariantSelector']->actionable,
            'buildVariantSelector يتجاهل node.action إطلاقاً — إجراء مرفق له بلا أثر تشغيلي.'
        );
    }

    public function test_actionable_components_match_the_widgets_that_read_node_action(): void
    {
        $expectedActionable = [
            'ProductCard', 'Quantity', 'AddToCart', 'Button', 'NavigationTarget',
        ];

        foreach (ComponentRegistry::definitions() as $type => $definition) {
            $this->assertSame(
                in_array($type, $expectedActionable, true),
                $definition->actionable,
                "actionable لـ{$type} لا يطابق قراءة component_widgets.dart."
            );
        }
    }

    /** APP-BUILDER-21 — كل مكوّن وكل خاصية يحملان تسمية بشرية ثنائية اللغة، ولا تُغيَّر أي هوية داخلية. */
    public function test_every_component_and_prop_declares_a_non_empty_bilingual_label(): void
    {
        foreach (ComponentRegistry::definitions() as $type => $definition) {
            $this->assertNotSame('', trim($definition->label->ar), "{$type}: تسمية عربية فارغة.");
            $this->assertNotSame('', trim($definition->label->en), "{$type}: English label is empty.");
            $this->assertNotSame($type, $definition->label->ar, "{$type}: التسمية يجب أن تكون بشرية لا مطابقة للمعرّف الداخلي.");

            foreach ($definition->props as $prop) {
                $this->assertNotSame('', trim($prop->label->ar), "{$type}.{$prop->key}: تسمية عربية فارغة.");
                $this->assertNotSame('', trim($prop->label->en), "{$type}.{$prop->key}: English label is empty.");
            }
        }
    }

    /** ADR-01 (APP-BUILDER-14) — نطاق V1 المُقفَل لمكوّنات الربط فقط. */
    public function test_only_the_four_adr_01_components_declare_bindable_resources(): void
    {
        $expected = [
            'ProductList' => ['commerce.products'],
            'ProductDetail' => ['commerce.products'],
            'CartList' => ['commerce.cart'],
            'CartSummary' => ['commerce.cart'],
        ];

        foreach (ComponentRegistry::definitions() as $type => $definition) {
            $this->assertSame(
                $expected[$type] ?? [],
                $definition->bindableResources,
                "bindableResources لـ{$type} خارج نطاق ADR-01 V1."
            );
        }
    }
}
