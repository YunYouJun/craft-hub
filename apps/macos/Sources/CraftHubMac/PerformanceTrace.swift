import Foundation
import OSLog

/// Fixed, payload-free readiness markers. Signposts are available to Instruments; JSON export is explicitly opt-in.
@MainActor
enum PerformanceTrace {
  enum Event: String {
    case appLaunched = "app-launched"
    case sidebarAppeared = "sidebar-appeared"
    case nodeResolved = "node-resolved"
    case runtimeReady = "runtime-ready"
    case webReady = "web-ready"
    case paletteRequested = "palette-requested"
    case palettePresented = "palette-presented"
    case captureRequested = "capture-requested"
    case capturePresented = "capture-presented"
    case pageRequested = "page-requested"
    case nativePageAppeared = "native-page-appeared"
    case instancePrimary = "instance-primary"
    case instanceReceived = "instance-received"
    case instanceForwarded = "instance-forwarded"
    case instanceBlocked = "instance-blocked"
  }
  private static let logger = Logger(
    subsystem: Bundle.main.bundleIdentifier ?? "dev.craft-hub.macos-prototype", category: "Performance")
  private static let signposter = OSSignposter(logger: logger)

  static func mark(_ event: Event) {
    signposter.emitEvent("Readiness", "\(event.rawValue, privacy: .public)")
    logger.debug("Readiness: \(event.rawValue, privacy: .public)")
    guard let path = ProcessInfo.processInfo.environment["CRAFT_HUB_PERFORMANCE_TRACE"], path.hasPrefix("/") else {
      return
    }
    let record: [String: Any] = [
      "host": "macos", "event": event.rawValue, "pid": ProcessInfo.processInfo.processIdentifier,
      "wallTimeMs": Date().timeIntervalSince1970 * 1000,
      "uptimeMs": ProcessInfo.processInfo.systemUptime * 1000,
    ]
    guard var data = try? JSONSerialization.data(withJSONObject: record, options: [.sortedKeys]) else { return }
    data.append(0x0a)
    let descriptor = open(path, O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC | O_NOFOLLOW, 0o600)
    guard descriptor >= 0 else { return }
    defer { close(descriptor) }
    data.withUnsafeBytes { buffer in _ = write(descriptor, buffer.baseAddress, buffer.count) }
  }
}
