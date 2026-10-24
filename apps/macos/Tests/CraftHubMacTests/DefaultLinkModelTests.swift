import Foundation
import Testing

@testable import CraftHubMac
@testable import CraftHubMacCore

@MainActor private final class ModelLinkRegistry: URLSchemeRegistry {
  let old = LinkApplication(path: "/fixture/Old.app", identifier: "test.old", revision: "one")
  let target = LinkApplication(path: "/fixture/New.app", identifier: "test.new", revision: "one")
  var currentApp: LinkApplication?
  var writes = 0
  var accept = true
  init() { currentApp = old }
  func current(_ scheme: String) throws -> LinkApplication? { currentApp }
  func inspect(_ url: URL, scheme: String) throws -> LinkApplication { url == old.url ? old : target }
  func set(_ application: LinkApplication, scheme: String) async throws {
    writes += 1
    if accept { currentApp = application }
  }
}

@MainActor @Test func defaultLinkUIRequiresExplicitConsentAndKeepsUncertainResultsVisible() async throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent("craft-hub-link-model-\(UUID())")
  defer { try? FileManager.default.removeItem(at: root) }
  let registry = ModelLinkRegistry()
  let store = LinkHandoverStore(root: root)
  let service = URLSchemeHandover(
    scheme: "craft-hub-test", application: registry.target.url, store: store, enabled: true, registry: registry)
  let model = DefaultLinkModel(service: service, available: true)
  model.refresh()
  await model.change(.adopt) { review in
    #expect(review.current == registry.old && model.busy)
    return false
  }
  #expect(registry.writes == 0 && !model.busy && model.message == nil)
  #expect(!FileManager.default.fileExists(atPath: root.path))
  registry.accept = false
  await model.change(.adopt) { _ in true }
  #expect(model.current == registry.old && model.error != nil && model.message == nil)
  #expect(model.previous == registry.old)
  registry.accept = true
  await model.change(.adopt) { _ in true }
  #expect(model.current == registry.target && model.error == nil && model.message != nil)
  await model.change(.restore) { _ in true }
  #expect(model.current == registry.old && registry.writes == 3)
}

@MainActor @Test func defaultLinkUILateOrConcurrentConfirmationCannotApplyAStaleSelection() async throws {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent("craft-hub-link-model-\(UUID())")
  defer { try? FileManager.default.removeItem(at: root) }
  let registry = ModelLinkRegistry()
  let service = URLSchemeHandover(
    scheme: "craft-hub-test", application: registry.target.url, store: LinkHandoverStore(root: root),
    enabled: true, registry: registry)
  let model = DefaultLinkModel(service: service, available: true)
  var confirmation: CheckedContinuation<Bool, Never>?
  let operation = Task {
    await model.change(.adopt) { _ in await withCheckedContinuation { confirmation = $0 } }
  }
  for _ in 0..<100 {
    if confirmation != nil { break }
    await Task.yield()
  }
  #expect(confirmation != nil && model.busy)
  await model.change(.adopt) { _ in
    Issue.record("Overlapping review")
    return true
  }
  operation.cancel()
  confirmation?.resume(returning: true)
  await operation.value
  #expect(!model.busy && registry.writes == 0)
  await model.change(.adopt) { _ in
    registry.currentApp = registry.target
    return true
  }
  #expect(model.error != nil && registry.writes == 0)
  let disabled = DefaultLinkModel(service: service, available: false)
  await disabled.change(.adopt) { _ in
    Issue.record("Disabled build reviewed a change")
    return true
  }
  #expect(registry.writes == 0)
}
