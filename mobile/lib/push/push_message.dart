/// A normalized incoming push notification, decoupled from any specific
/// provider's wire format (FCM's `RemoteMessage`, a raw APNs payload,
/// etc.) — this is the one shape [PushAdapter] guarantees callers, mirroring
/// how `ActionRef` decouples this runtime from any single push transport.
///
/// [data] mirrors FCM's own `RemoteMessage.data` (`Map<String, String>`,
/// the "data message" payload) because that is exactly what
/// `resolvePushPayload` reads to decide navigation — see its own doc
/// comment for why only `data`, never a display title/body string, may
/// ever drive an action.
class PushMessage {
  final Map<String, String> data;
  const PushMessage(this.data);
}
