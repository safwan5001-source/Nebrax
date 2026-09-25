/// AWJ Mobile Runtime — last-known-good startup decision mechanism
/// (MOBILE-RUNTIME-10, horizon MR-14).
///
/// `last_known_good.dart`'s `resolveStartup` is pure Dart, no Flutter/
/// widget/network/storage dependency: it decides what a boot should render
/// given this attempt's fetch outcome, an optional previously cached
/// Experience, and the installed runtime's capability manifest.
///
/// `experience_fetcher.dart`/`experience_cache.dart` (APP-BUILDER-19) are
/// the real I/O this decision mechanism always sat behind — a real
/// `commerce/v1` fetch and a real on-device cache — wired without changing
/// `resolveStartup` itself at all.
library;

export 'experience_cache.dart';
export 'experience_fetcher.dart';
export 'integrity_digest.dart';
export 'last_known_good.dart';
