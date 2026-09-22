/// AWJ Mobile Runtime — App Schema + compatibility kernel (MOBILE-RUNTIME-2).
///
/// Pure Dart, no Flutter/widget dependency: parses and validates the AWJ App
/// Schema format (horizon MR-04) and resolves it against a runtime's
/// capability manifest (RUNTIME_COMPATIBILITY_V1.md). Rendering the result
/// as actual widgets, and dispatching its actions, is MOBILE-RUNTIME-3's
/// Component + Action Registry.
library;

export 'app_schema.dart';
export 'capability_manifest.dart';
export 'compatibility.dart';
export 'registry_identifiers.dart';
export 'schema_version.dart';
