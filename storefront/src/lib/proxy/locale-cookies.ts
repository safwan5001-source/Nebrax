/**
 * Country / locale cookies the storefront proxy keeps in step with the URL.
 *
 * `awj_country` / `awj_locale` are the current names. The proxy still READS the legacy names an earlier integration
 * used (`spree_country` / `spree_locale`) so a returning visitor keeps their market and language, and expires them as
 * soon as the new pair is written. Drop `LEGACY_*` (and the fallback read) one release after this ships.
 */
export const COUNTRY_COOKIE = "awj_country";
export const LOCALE_COOKIE = "awj_locale";
export const LEGACY_COUNTRY_COOKIE = "spree_country";
export const LEGACY_LOCALE_COOKIE = "spree_locale";
