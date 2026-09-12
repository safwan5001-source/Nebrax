<?php

namespace App\Support\Inventory;

use App\Models\User;

interface MovementSourceHandler
{
    public function sourceType(): string;

    /**
     * @param  list<string>  $ids
     * @return array<string, MovementSource> keyed by source_id
     */
    public function resolve(array $ids, ?User $user): array;
}
