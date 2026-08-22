<?php

namespace App\Support;

enum EntitlementShadowMismatch: string
{
    case OLD_ALLOWED_NEW_DENIED = 'OLD_ALLOWED_NEW_DENIED';
    case OLD_DENIED_NEW_ALLOWED = 'OLD_DENIED_NEW_ALLOWED';
    case OLD_FULL_NEW_READ_ONLY = 'OLD_FULL_NEW_READ_ONLY';
    case OLD_READ_ONLY_NEW_FULL = 'OLD_READ_ONLY_NEW_FULL';

    public static function between(ApplicationAccessLevel $old, ApplicationAccessLevel $new): ?self
    {
        if ($old === $new) return null;

        return match (true) {
            $old === ApplicationAccessLevel::ALLOWED && $new === ApplicationAccessLevel::DENIED => self::OLD_ALLOWED_NEW_DENIED,
            $old === ApplicationAccessLevel::DENIED && $new !== ApplicationAccessLevel::DENIED => self::OLD_DENIED_NEW_ALLOWED,
            $old === ApplicationAccessLevel::ALLOWED && $new === ApplicationAccessLevel::READ_ONLY => self::OLD_FULL_NEW_READ_ONLY,
            $old === ApplicationAccessLevel::READ_ONLY && $new === ApplicationAccessLevel::ALLOWED => self::OLD_READ_ONLY_NEW_FULL,
            $old === ApplicationAccessLevel::READ_ONLY && $new === ApplicationAccessLevel::DENIED => self::OLD_ALLOWED_NEW_DENIED,
            default => null,
        };
    }
}
