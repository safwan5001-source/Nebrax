/// AWJ Mobile Runtime — last-known-good startup decision mechanism
/// (MOBILE-RUNTIME-10, horizon MR-14).
///
/// Pure Dart, no Flutter/widget/network/storage dependency: decides what a
/// boot should render given this attempt's fetch outcome, an optional
/// previously cached Experience, and the installed runtime's capability
/// manifest. Proves the *decision mechanism* only — per this task's owner
/// decision, wiring this into a real remote Published Experience fetch/cache
/// flow is explicitly deferred until that serving infrastructure exists; see
/// `last_known_good.dart`'s own doc comment and this task's implementation
/// report.
library;

export 'integrity_digest.dart';
export 'last_known_good.dart';
