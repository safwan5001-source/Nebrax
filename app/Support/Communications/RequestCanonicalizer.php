<?php

namespace App\Support\Communications;

/**
 * AWJ-COMMS-02-B — التمثيل القياسي المُصدَّر (v1) لطلب الإرسال، أساس بصمة منع التكرار. دالة نقيّة بلا Laravel.
 *
 * كل حقل يُكتب بطول مسبق (`<بايتات>:<قيمة>;`) لا بفاصل، فلا يلتبس `"ab","c"` بـ`"a","bc"`. الترتيب ثابت:
 *
 *   الوسم `awj.comms.req.v1` · القناة · التصنيف · عنوان المستلم المُطبَّع · قالب · مصدر · سياسة المتغيرات · المتغيرات
 *
 *  - التطبيع: البريد بحروف صغيرة؛ الهاتف/المعرّف كما هو (تحقّق `MessageRecipient` أنه E.164 صالح).
 *  - المتغيرات مرتبة بالمفتاح (ترتيب بايتات)، فلا يؤثر ترتيب الإدخال في البصمة.
 *  - **OTP تستثني المتغيرات** (سياسة `excluded`): فضاء الرمز 10⁶، وأي بصمة محفوظة له مُخمِّنٌ للرمز لمن يملك المفتاح.
 *  - `source` مُضمَّن: إعادة استعمال المفتاح من منتِج آخر تُعدّ تعارضاً.
 *  - المستأجر **ليس** جزءاً من النص: يدخل بالاشتقاق (HKDF بملح المستأجر) فتختلف البصمات بين المستأجرين.
 *
 * أي تغيير في الصيغة أو التطبيع = وسم إصدار جديد، ولا تُقارَن بصمات صيغتين مختلفتين.
 */
final class RequestCanonicalizer
{
    public const VERSION_TAG = 'awj.comms.req.v1';

    public static function canonicalize(MessageIntent $intent): string
    {
        $address = $intent->recipient->address;
        if ($intent->channel() === CommunicationChannel::Email) {
            $address = mb_strtolower($address, 'UTF-8');
        }

        $parts = [
            self::VERSION_TAG,
            $intent->channel()->value,
            $intent->classification->value,
            $address,
            $intent->templateKey,
            $intent->source,
        ];

        if ($intent->classification === MessageClassification::Otp) {
            $parts[] = 'vars:excluded';
        } else {
            $parts[] = 'vars:included';
            $variables = $intent->variables;
            ksort($variables, SORT_STRING);
            $parts[] = (string) count($variables);
            foreach ($variables as $name => $value) {
                $parts[] = (string) $name;
                $parts[] = $value;
            }
        }

        return implode('', array_map(static fn (string $part): string => strlen($part).':'.$part.';', $parts));
    }
}
