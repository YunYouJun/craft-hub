import CraftHubMacCore
import Observation

/// Native display settings edit the same revisioned runtime preferences as the web settings sheet.
@MainActor @Observable final class NativeSettingsModel {
  private(set) var available = false
  private(set) var saving = false
  var error: String?
  @ObservationIgnored private var client: RuntimeAPIClient?
  func connect(_ client: RuntimeAPIClient?) {
    self.client = client
    available = client != nil
    saving = false
    error = nil
  }
  func update(theme: RuntimePreferences.Theme? = nil, language: RuntimePreferences.Language? = nil) async {
    guard let client, !saving else { return }
    saving = true
    error = nil
    defer { if self.client === client { saving = false } }
    do {
      _ = try await client.updatePreferences(theme: theme, language: language)
      guard self.client === client else { return }
      NativePreferences.shared.refresh(client)
    } catch {
      if self.client === client { self.error = error.localizedDescription }
    }
  }
}
