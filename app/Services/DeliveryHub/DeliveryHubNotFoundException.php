<?php

namespace App\Services\DeliveryHub;

use RuntimeException;

/** الصف أو الوجهة خارج النطاق. الرد 404 بلا جسم يسرّب بيانات. */
class DeliveryHubNotFoundException extends RuntimeException
{
}
