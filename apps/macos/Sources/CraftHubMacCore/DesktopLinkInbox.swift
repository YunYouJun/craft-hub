import Foundation

/// Bounded, memory-only transport queue. The shared desktop parser owns validation and project resolution.
public struct DesktopLinkInbox {
  private var pending: [String: String] = [:]
  public init() {}

  /// Keep independent callback lanes and only the newest navigation during startup or a sidecar restart.
  @discardableResult public mutating func accept(_ url: URL) -> Bool {
    let raw = url.absoluteString
    guard ["craft-hub", "craft-hub-native"].contains(url.scheme), raw.utf8.count <= 2048,
      !raw.unicodeScalars.contains(where: { $0.value <= 32 || $0.value == 127 })
    else { return false }
    let host = url.host ?? ""
    let lane = ["cloud", "marketplace", "celebrate"].contains(host) ? host : "navigation"
    pending[lane] = raw
    return true
  }

  public mutating func drain() -> [String] {
    let values = ["cloud", "marketplace", "celebrate", "navigation"].compactMap { pending[$0] }
    pending = [:]
    return values
  }
}
