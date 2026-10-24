import Foundation

/// The two runtime-owned preferences applied to native windows and menus as well as the web workbench.
public struct RuntimePreferences: Decodable, Equatable, Sendable {
  public enum Theme: String, Decodable, Sendable { case system, light, dark }
  public enum Language: String, Decodable, Sendable {
    case english = "en"
    case chinese = "zh-CN"
  }
  public let theme: Theme
  public let language: Language

  public init(theme: Theme, language: Language) {
    self.theme = theme
    self.language = language
  }

  private enum CodingKeys: String, CodingKey {
    case theme = "workbench.theme"
    case language = "workbench.locale"
  }
}

extension RuntimeAPIClient {
  private struct PreferencesSnapshot: Decodable {
    let revision: String
    let settings: RuntimePreferences
  }
  /// Read a narrow projection of settings without retaining unrelated paths, commands, or credentials.
  public func preferences() async throws -> RuntimePreferences {
    struct Snapshot: Decodable { let settings: RuntimePreferences }
    let snapshot: Snapshot = try await fetch(path: "/api/settings")
    return snapshot.settings
  }

  /// Change only display preferences using the runtime's revision check; concurrent edits must be retried explicitly.
  public func updatePreferences(theme: RuntimePreferences.Theme? = nil, language: RuntimePreferences.Language? = nil)
    async throws -> RuntimePreferences
  {
    var settings: [String: String] = [:]
    if let theme { settings["workbench.theme"] = theme.rawValue }
    if let language { settings["workbench.locale"] = language.rawValue }
    guard !settings.isEmpty else { throw RuntimeAPIError.invalidResponse }
    let current: PreferencesSnapshot = try await fetch(path: "/api/settings")
    let body = try JSONSerialization.data(withJSONObject: ["revision": current.revision, "settings": settings])
    let result: PreferencesSnapshot = try await fetch(path: "/api/settings", body: body, method: "PATCH")
    return result.settings
  }
}
