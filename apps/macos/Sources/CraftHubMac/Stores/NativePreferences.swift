import AppKit
import CraftHubMacCore
import Observation

/// Mirrors runtime settings; cached display preferences keep launch chrome consistent before the sidecar is ready.
@MainActor
@Observable
final class NativePreferences {
  static let shared = NativePreferences()
  private(set) var theme: RuntimePreferences.Theme
  private(set) var language: RuntimePreferences.Language
  @ObservationIgnored private let defaults: UserDefaults
  @ObservationIgnored private let applyAppearance: @MainActor (RuntimePreferences.Theme) -> Void
  @ObservationIgnored private var request: Task<Void, Never>?
  @ObservationIgnored private var generation = UUID()

  init(
    defaults: UserDefaults = NativeStorage.defaults,
    applyAppearance: @escaping @MainActor (RuntimePreferences.Theme) -> Void = { theme in
      switch theme {
      case .system: NSApp.appearance = nil
      case .light: NSApp.appearance = NSAppearance(named: .aqua)
      case .dark: NSApp.appearance = NSAppearance(named: .darkAqua)
      }
    }
  ) {
    self.defaults = defaults
    self.applyAppearance = applyAppearance
    theme = defaults.string(forKey: "nativeTheme").flatMap(RuntimePreferences.Theme.init(rawValue:)) ?? .system
    language =
      defaults.string(forKey: "nativeLanguage").flatMap(RuntimePreferences.Language.init(rawValue:))
      ?? (Locale.preferredLanguages.first?.hasPrefix("zh") == true ? .chinese : .english)
  }

  func start() { applyAppearance(theme) }

  func refresh(_ client: RuntimeAPIClient?) {
    cancel()
    guard let client else { return }
    let attempt = generation
    request = Task { [weak self] in
      guard let snapshot = try? await client.preferences(), !Task.isCancelled,
        let self, generation == attempt
      else { return }
      theme = snapshot.theme
      language = snapshot.language
      persist()
    }
  }

  func setTheme(_ value: RuntimePreferences.Theme) {
    cancel()
    theme = value
    persist()
  }

  func setLanguage(_ value: RuntimePreferences.Language) {
    cancel()
    language = value
    persist()
  }

  private func persist() {
    defaults.set(theme.rawValue, forKey: "nativeTheme")
    defaults.set(language.rawValue, forKey: "nativeLanguage")
    applyAppearance(theme)
  }

  private func cancel() {
    generation = UUID()
    request?.cancel()
    request = nil
  }
}
