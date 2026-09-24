<?php

namespace Tests\Feature;

use App\Services\AppBuilder\ActionDefinition;
use App\Services\AppBuilder\ActionRegistry;
use App\Services\AppBuilder\RuntimeCapabilities;
use Tests\TestCase;

/**
 * APP-BUILDER-3 — سجلّ بيانات الإجراءات، بلا قاعدة بيانات ولا HTTP. يطابق
 * تسمية/حالات `mobile/test/actions/app_action_test.dart` عمداً — نفس مصفوفة
 * (إلزامي/اختياري/حد أدنى) التي يفحصها `decodeAction()` فعلياً.
 *
 * تشغيل: php artisan test --filter=ActionRegistryTest
 */
class ActionRegistryTest extends TestCase
{
    public function test_definitions_key_set_matches_runtime_capabilities_actions_exactly(): void
    {
        $this->assertSame(
            array_keys(RuntimeCapabilities::ACTIONS),
            array_keys(ActionRegistry::definitions()),
            'سجلّ بيانات الإجراءات يجب أن يصف كل هوية إجراء مدعومة فعلياً — لا أكثر ولا أقل.'
        );
    }

    public function test_every_definition_reports_its_own_type_and_the_shared_runtime_version(): void
    {
        foreach (ActionRegistry::definitions() as $type => $definition) {
            $this->assertSame($type, $definition->type);
            $this->assertSame(RuntimeCapabilities::ACTIONS[$type], $definition->version);
        }
    }

    public function test_no_action_has_a_proven_business_effect_yet(): void
    {
        foreach (ActionRegistry::definitions() as $type => $definition) {
            $this->assertSame(
                ActionDefinition::DISPATCH_PROVEN_NOOP,
                $definition->dispatchStatus,
                "{$type}: NoopActionHandler هو المُنفِّذ الوحيد المُثبَت اليوم — لا إجراء له أثر تجاري فعلي."
            );
        }
    }

    public function test_required_param_keys_match_decode_action_evidence(): void
    {
        $definitions = ActionRegistry::definitions();

        $requiredKeysOf = function (string $type) use ($definitions): array {
            $required = array_filter($definitions[$type]->params, fn ($p) => $p->required);

            return array_map(fn ($p) => $p->key, $required);
        };

        $this->assertSame(['pageId'], $requiredKeysOf('navigate'));
        $this->assertSame(['productId'], $requiredKeysOf('openProduct'));
        $this->assertSame(['productId'], $requiredKeysOf('addToCart'));
        $this->assertSame(['cartItemId', 'quantity'], $requiredKeysOf('updateCartQuantity'));
        $this->assertSame(['cartItemId'], $requiredKeysOf('removeCartItem'));
        $this->assertSame([], $requiredKeysOf('refresh'));
    }

    public function test_add_to_cart_quantity_default_and_minimum_match_decode_action(): void
    {
        $quantity = collect(ActionRegistry::definitions()['addToCart']->params)
            ->firstWhere('key', 'quantity');

        $this->assertNotNull($quantity);
        $this->assertFalse($quantity->required);
        $this->assertSame(1, $quantity->default);
        $this->assertSame(1, $quantity->minValue, 'decodeAction يرفض quantity <= 0 لـaddToCart.');
    }

    public function test_update_cart_quantity_allows_zero_but_not_negative(): void
    {
        $quantity = collect(ActionRegistry::definitions()['updateCartQuantity']->params)
            ->firstWhere('key', 'quantity');

        $this->assertNotNull($quantity);
        $this->assertTrue($quantity->required);
        $this->assertSame(0, $quantity->minValue, 'decodeAction يقبل quantity == 0 صراحة لـupdateCartQuantity.');
    }

    /** APP-BUILDER-21 — كل إجراء وكل معامل يحملان تسمية بشرية ثنائية اللغة. */
    public function test_every_action_and_param_declares_a_non_empty_bilingual_label(): void
    {
        foreach (ActionRegistry::definitions() as $type => $definition) {
            $this->assertNotSame('', trim($definition->label->ar), "{$type}: تسمية عربية فارغة.");
            $this->assertNotSame('', trim($definition->label->en), "{$type}: English label is empty.");
            $this->assertNotSame($type, $definition->label->ar, "{$type}: التسمية يجب أن تكون بشرية لا مطابقة للمعرّف الداخلي.");

            foreach ($definition->params as $param) {
                $this->assertNotSame('', trim($param->label->ar), "{$type}.{$param->key}: تسمية عربية فارغة.");
                $this->assertNotSame('', trim($param->label->en), "{$type}.{$param->key}: English label is empty.");
            }
        }
    }
}
