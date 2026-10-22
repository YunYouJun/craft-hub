import Foundation

/// Immutable release configuration. Local bundles never start an updater, regardless of saved preferences.
public struct NativeUpdateConfiguration: Equatable {
  public let feedURL: URL

  public init?(info: [String: Any]) throws {
    guard info["CraftHubUpdatesEnabled"] as? Bool == true else { return nil }
    guard let feed = info["SUFeedURL"] as? String,
          !feed.unicodeScalars.contains(where: { $0.value <= 32 || $0.value == 127 }),
          let url = URL(string: feed), url.scheme == "https", url.host?.isEmpty == false,
          url.user == nil, url.password == nil, url.fragment == nil,
          let key = info["SUPublicEDKey"] as? String,
          let decoded = Data(base64Encoded: key), decoded.count == 32,
          decoded.base64EncodedString() == key,
          info["SUVerifyUpdateBeforeExtraction"] as? Bool == true,
          info["SURequireSignedFeed"] as? Bool == true else {
      throw ConfigurationError.invalidRelease
    }
    feedURL = url
  }

  public enum ConfigurationError: LocalizedError {
    case invalidRelease
    public var errorDescription: String? { "This release has an invalid software update configuration." }
  }
}

/// Shared by normal quit and Sparkle's installation quit. A relaunch must wait until the child process exits.
public enum NativeTermination {
  @MainActor
  public static func prepare(
    requireIdle: () async throws -> Void,
    confirmInterruption: (Error) -> Bool,
    shutdown: () async -> Void
  ) async -> Bool {
    do { try await requireIdle() }
    catch { if !confirmInterruption(error) { return false } }
    await shutdown()
    return true
  }
}
