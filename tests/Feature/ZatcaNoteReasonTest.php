<?php

namespace Tests\Feature;

use App\Support\ZatcaNoteReason;
use InvalidArgumentException;
use PHPUnit\Framework\TestCase;

/**
 * REM-18a — كتالوج أسباب الإشعار (KSA-10). النصوص هنا مكتوبة يدوياً من قاموس بيانات ZATCA لا مشتقة من الصنف المختبَر،
 * والنصّان المطابقان لعيّنات SDK الرسمية مثبّتان حرفياً.
 */
class ZatcaNoteReasonTest extends TestCase
{
    public function test_the_catalogue_has_exactly_the_five_official_instances(): void
    {
        $this->assertSame([
            'supply_cancelled_or_suspended', 'supply_materially_changed', 'supply_value_amended_by_agreement',
            'goods_or_services_refund', 'party_details_changed',
        ], ZatcaNoteReason::codes());
    }

    public function test_the_two_strings_proven_by_official_sdk_samples_are_reproduced_verbatim(): void
    {
        $this->assertSame(
            'In case of goods or services refund | عند ترجيع السلع أو الخدمات',
            ZatcaNoteReason::instructionNote('goods_or_services_refund'),
        );
        $this->assertSame(
            'Amendment of the supply value which is pre-agreed upon between the supplier and consumer | تم الاتفاق على تعديل قيمة التوريد مسبقاً',
            ZatcaNoteReason::instructionNote('supply_value_amended_by_agreement'),
        );
    }

    public function test_every_reason_is_bilingual_and_within_the_1000_character_dictionary_limit(): void
    {
        foreach (ZatcaNoteReason::codes() as $code) {
            $text = ZatcaNoteReason::instructionNote($code);
            [$en, $ar] = explode(' | ', $text);
            $this->assertMatchesRegularExpression('/^[\x20-\x7E]+$/', $en, $code);
            $this->assertMatchesRegularExpression('/\p{Arabic}/u', $ar, $code);
            $this->assertGreaterThanOrEqual(1, mb_strlen($text));
            $this->assertLessThanOrEqual(1000, mb_strlen($text), $code);
            $this->assertSame($text, trim($text));
        }
    }

    public function test_unknown_free_text_and_non_string_codes_are_rejected_not_guessed(): void
    {
        foreach (['', 'refund', 'GOODS_OR_SERVICES_REFUND', 'In case of goods or services refund', ' goods_or_services_refund', null, 4, ['x']] as $code) {
            $this->assertFalse(ZatcaNoteReason::isKnown($code));
            try {
                ZatcaNoteReason::instructionNote($code);
                $this->fail('must reject '.var_export($code, true));
            } catch (InvalidArgumentException $e) {
                $this->assertStringContainsString('KSA-10', $e->getMessage());
            }
        }
    }
}
