<?php

namespace App\Support;

use App\Models\User;

/**
 * AI-ACTIONS-04: purchase price is cost data. Whoever lacks `products.view_cost`
 * never receives it from any AI Actions payload (review, versions, extraction,
 * preview) and cannot write it either. Redaction happens only at presentation:
 * the stored proposal and the service-internal copies keep the real value, so a
 * redacted echo can never overwrite a cost.
 */
final class AiActionCostVisibility
{
    public const PERMISSION = 'products.view_cost';
    public const FIELD = 'purchase_price';

    public static function allows(?User $user): bool
    {
        return $user !== null && Rbac::allows((string) $user->role, self::PERMISSION);
    }

    /** @param array<string,mixed> $proposal @return array<string,mixed> */
    public static function redactProposal(array $proposal): array
    {
        if (is_array($proposal['rows'] ?? null)) {
            $proposal['rows'] = self::redactRows($proposal['rows']);
        }

        return $proposal;
    }

    /** @param array<string,mixed> $manifest @return array<string,mixed> */
    public static function redactManifest(array $manifest): array
    {
        return self::redactProposal($manifest);
    }

    /** @param array<int,mixed> $rows @return array<int,mixed> */
    public static function redactRows(array $rows): array
    {
        foreach ($rows as $index => $row) {
            if (is_array($row) && isset($row['fields'][self::FIELD])) {
                // Same shape as a missing value so a client echoing it back stays schema-valid.
                $rows[$index]['fields'][self::FIELD] = ['value' => null, 'origin' => 'missing', 'confidence' => null];
            }
        }

        return $rows;
    }

    /** True when any row carries a non-null purchase price. @param array<string,mixed> $proposal */
    public static function carriesCost(array $proposal): bool
    {
        foreach ($proposal['rows'] ?? [] as $row) {
            if (is_array($row) && ($row['fields'][self::FIELD]['value'] ?? null) !== null) {
                return true;
            }
        }

        return false;
    }

    /**
     * Keeps the stored purchase price of rows that already exist, so a write by someone who cannot
     * see costs neither reads nor wipes them. Rows without a stored value keep what was sent (null).
     *
     * @param  array<string,mixed>  $submitted
     * @param  array<int,mixed>  $previousRows
     * @return array<string,mixed>
     */
    public static function carryForward(array $submitted, array $previousRows): array
    {
        $previous = [];
        foreach ($previousRows as $row) {
            if (is_array($row) && isset($row['row_id'], $row['fields'][self::FIELD])) {
                $previous[(string) $row['row_id']] = $row['fields'][self::FIELD];
            }
        }
        foreach ($submitted['rows'] ?? [] as $index => $row) {
            $id = is_array($row) ? (string) ($row['row_id'] ?? '') : '';
            if (isset($previous[$id])) {
                $submitted['rows'][$index]['fields'][self::FIELD] = $previous[$id];
            }
        }

        return $submitted;
    }
}
