import CraftHubMacCore
import Foundation
import Observation

/// Keeps the inspected revision and local edits across refreshes; conflicts require an explicit new draft.
@MainActor @Observable final class ConfigurationRegistryDraft: Identifiable {
  let id = UUID()
  let entryID: String
  let revision: String
  let category: String
  let originalSource: ConfigurationRegistry.Source?
  let originalTarget: ConfigurationRegistry.Target?
  var source: ConfigurationRegistry.Source
  var target: ConfigurationRegistry.Target
  init(entryID: String, registry: ConfigurationRegistry, source: ConfigurationRegistry.Source? = nil) {
    self.entryID = entryID
    revision = registry.revision
    category = "source"
    originalSource = source
    originalTarget = nil
    self.source = source ?? .init()
    target = .init()
  }
  init(entryID: String, registry: ConfigurationRegistry, target: ConfigurationRegistry.Target?) {
    self.entryID = entryID
    revision = registry.revision
    category = "target"
    originalTarget = target
    originalSource = nil
    self.target = target ?? .init()
    source = .init()
  }
  func mutation(eligibleSourceIDs: [String]) -> ConfigurationRegistryMutation {
    var result = ConfigurationRegistryMutation(
      action: category == "source" ? "save-source" : "save-target", revision: revision)
    if category == "source" {
      var value = source
      if value.kind != "overlay" { value.manifest = nil }
      result.source = value
    } else {
      var value = target
      if value.root?.isEmpty == true { value.root = nil }
      value.sourceIds = value.driver == "external" ? [] : value.sourceIds.filter { eligibleSourceIDs.contains($0) }
      if value.driver == "external" { value.keyEnvironment = nil }
      result.target = value
    }
    return result
  }
}
