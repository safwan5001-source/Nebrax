<?php

namespace App\Services\DeliveryHub;

/**
 * لفظ JSON عددي كما وصل. لا يُحوَّل إلى float حتى لا تتطابق
 * قيم موقعة مختلفة على نفس البصمة.
 */
final class DeliveryConnectorJsonNumber
{
    public function __construct(public readonly string $literal) {}
}
