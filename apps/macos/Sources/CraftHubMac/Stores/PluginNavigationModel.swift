import CraftHubMacCore
import Foundation
import Observation

/// Native sidebar declarations are cached per connection and refreshed only on relevant changes.
@MainActor @Observable final class PluginNavigationModel {
  private(set) var workbenches: [PluginWorkbench] = []
  private(set) var loading = false
  private(set) var error: String?
  @ObservationIgnored private var client: RuntimeAPIClient?
  @ObservationIgnored private var request: Task<Void, Never>?
  @ObservationIgnored private var generation = UUID()
  @ObservationIgnored private var revision = 0
  @ObservationIgnored private var loadedRevision = -1
  @ObservationIgnored private var locale = ""

  var canOpen: Bool { client != nil && loadedRevision == revision && !loading && error == nil }

  func connect(_ client: RuntimeAPIClient?) {
    request?.cancel()
    request = nil
    generation = UUID()
    self.client = client
    workbenches = []
    loading = false
    error = nil
    revision += 1
  }

  @discardableResult func invalidate(_ changes: Set<RuntimeChange>) -> Bool {
    guard !changes.isDisjoint(with: [.plugins, .pluginUpdate, .settings, .userConfig, .configurationSync]) else {
      return false
    }
    revision += 1
    return true
  }

  func load(locale: String, force: Bool = false) async {
    if self.locale != locale {
      self.locale = locale
      revision += 1
    }
    if force { revision += 1 }
    if let request {
      await request.value
      return
    }
    guard let client, loadedRevision != revision else { return }
    let attempt = generation
    loading = true
    error = nil
    request = Task {
      defer {
        if generation == attempt {
          loading = false
          request = nil
        }
      }
      repeat {
        let version = revision
        let language = self.locale
        do {
          let result = try await client.pluginWorkbenches(locale: language)
          guard attempt == generation, !Task.isCancelled else { return }
          if version == revision {
            workbenches = result
            loadedRevision = version
            error = nil
          }
        } catch {
          guard attempt == generation, !Task.isCancelled else { return }
          if version == revision {
            self.error = error.localizedDescription
            return
          }
        }
      } while loadedRevision != revision && !Task.isCancelled
    }
    await request?.value
  }
}
