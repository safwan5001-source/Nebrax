<?php

namespace App\Services;

use RuntimeException;

/**
 * FUEL-B5.1: التكلفة تغيّرت بين مراجعة المعتمِد واعتماده. استثناء مستقل (يرث RuntimeException) ليُحوَّل إلى 409 لا 422
 * في `FuelSupplyReceivingController::approveDelivery`.
 */
class FuelDeliveryCostChangedException extends RuntimeException {}
