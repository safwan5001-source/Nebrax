<?php

namespace App\Models;

use App\Tenancy\BelongsToTenant;
use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

abstract class BaseModel extends Model
{
    use HasUuids;
    use BelongsToTenant;

    public $incrementing = false;
    protected $keyType = 'string';
}
