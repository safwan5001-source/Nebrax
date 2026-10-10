<?php

namespace App\Services\DeliveryHub;

/**
 * عدد JSON صحيح لا يتسع في PHP_INT_MAX. يبقى حرفياً حتى لا ينهار
 * مع عددٍ آخر، ولا يُعامل كنصٍّ عند بناء البصمة المرجعية.
 */
final class DeliveryConnectorJsonInteger
{
    public function __construct(public readonly string $literal) {}
}
