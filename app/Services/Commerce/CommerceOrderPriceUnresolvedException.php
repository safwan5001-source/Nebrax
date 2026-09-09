<?php

namespace App\Services\Commerce;

use RuntimeException;

/**
 * لا سعر قابل للحسم لهذا السطر (`ResolvedCommercePrice::$resolved === false`)
 * — لا يعني صفراً حقيقياً، ولا يُفترَض له صفر أبداً (Master Plan §6). الطلب
 * لا يُنشأ ولا يُؤكَّد بسطرٍ بلا سعرٍ محسوم؛ الاستدعاء يفشل صراحةً.
 */
class CommerceOrderPriceUnresolvedException extends RuntimeException
{
}
