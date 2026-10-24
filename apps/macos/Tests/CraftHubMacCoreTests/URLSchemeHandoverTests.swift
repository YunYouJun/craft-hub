import Darwin
import Foundation
import Testing

@testable import CraftHubMacCore

@MainActor private final class LinkRegistryFixture: URLSchemeRegistry {
  let old = LinkApplication(path: "/fixture/Electron.app", identifier: "test.old", revision: "old-1")
  let native = LinkApplication(path: "/fixture/Native.app", identifier: "test.native", revision: "native-1")
  let third = LinkApplication(path: "/fixture/Third.app", identifier: "test.third", revision: "third-1")
  var selected: LinkApplication?
  var applications: [String: LinkApplication] = [:]
  var calls = 0
  var accept = true
  var failAfterWrite = false
  var beforeSet: (() throws -> Void)?
  init() {
    selected = old
    applications = Dictionary(uniqueKeysWithValues: [old, native, third].map { ($0.path, $0) })
  }
  func current(_ scheme: String) throws -> LinkApplication? { selected }
  func inspect(_ url: URL, scheme: String) throws -> LinkApplication {
    guard let application = applications[url.path] else { throw LinkHandoverError.invalidApplication }
    return application
  }
  func set(_ application: LinkApplication, scheme: String) async throws {
    calls += 1
    try beforeSet?()
    if accept { selected = application }
    if failAfterWrite { throw LinkHandoverError.notVerified }
  }
}

private func linkFixtureRoot() throws -> URL {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent("craft-hub-link-test-\(UUID())")
  try FileManager.default.createDirectory(
    at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
  return root
}

@MainActor @Test func publicLinkInspectionRequiresDeclaredSupportAndTracksBinaryReplacement() throws {
  let root = try linkFixtureRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let application = root.appendingPathComponent("Inspect.app")
  let binary = application.appendingPathComponent("Contents/MacOS/fixture")
  try FileManager.default.createDirectory(at: binary.deletingLastPathComponent(), withIntermediateDirectories: true)
  let info: [String: Any] = [
    "CFBundleIdentifier": "dev.craft-hub.link-test", "CFBundleExecutable": "fixture",
    "CFBundleURLTypes": [["CFBundleURLSchemes": ["craft-hub-test"]]],
  ]
  try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0)
    .write(to: application.appendingPathComponent("Contents/Info.plist"))
  try Data("first".utf8).write(to: binary)
  chmod(binary.path, 0o700)
  let registry = WorkspaceURLSchemeRegistry()
  let first = try registry.inspect(application, scheme: "craft-hub-test")
  #expect(throws: LinkHandoverError.self) { try registry.inspect(application, scheme: "craft-hub") }
  let modified = try FileManager.default.attributesOfItem(atPath: binary.path)[.modificationDate]!
  try Data("other".utf8).write(to: binary)
  try FileManager.default.setAttributes([.modificationDate: modified], ofItemAtPath: binary.path)
  #expect(try registry.inspect(application, scheme: "craft-hub-test").revision != first.revision)
  try FileManager.default.removeItem(at: binary)
  try FileManager.default.createSymbolicLink(at: binary, withDestinationURL: URL(fileURLWithPath: "/usr/bin/true"))
  #expect(throws: LinkHandoverError.self) { try registry.inspect(application, scheme: "craft-hub-test") }
}

@MainActor private func handover(
  _ registry: LinkRegistryFixture, _ store: LinkHandoverStore, enabled: Bool = true
) -> URLSchemeHandover {
  URLSchemeHandover(
    scheme: "craft-hub-test", application: registry.native.url, store: store, enabled: enabled, registry: registry)
}

@MainActor @Test func publicLinkReviewIsReadOnlyAndDisabledCandidatesCannotWrite() throws {
  let root = try linkFixtureRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = LinkHandoverStore(root: root.appendingPathComponent("links"))
  let registry = LinkRegistryFixture()
  let review = try handover(registry, store).review(.adopt)
  #expect(review.current == registry.old && review.desired == registry.native)
  #expect(try store.read() == nil && registry.calls == 0)
  #expect(!FileManager.default.fileExists(atPath: store.root.path))
  #expect(throws: LinkHandoverError.self) { try handover(registry, store, enabled: false).review(.adopt) }
  registry.selected = nil
  #expect(throws: LinkHandoverError.self) { try handover(registry, store).review(.adopt) }
}

@MainActor @Test func publicLinkHandoverPersistsBeforeMutationAndRestoresAfterRestart() async throws {
  let root = try linkFixtureRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = LinkHandoverStore(root: root.appendingPathComponent("links"))
  let registry = LinkRegistryFixture()
  registry.beforeSet = {
    let receipt = try #require(try store.read())
    #expect(receipt.previous == registry.old && receipt.requested == registry.native)
    #expect(throws: ProfileLockError.self) { _ = try ProfileLease(paths: [store.root], exclusive: true) }
  }
  let service = handover(registry, store)
  try await service.apply(service.review(.adopt))
  #expect(registry.selected == registry.native && registry.calls == 1)
  let before = try store.read()
  try await service.apply(service.review(.adopt))
  #expect(try registry.calls == 1 && store.read() == before)
  registry.beforeSet = nil
  let restarted = handover(registry, store)
  try await restarted.apply(restarted.review(.restore))
  #expect(registry.selected == registry.old && registry.calls == 2)
  try await restarted.apply(restarted.review(.restore))
  #expect(registry.calls == 2)
  let attributes = try FileManager.default.attributesOfItem(
    atPath: store.root.appendingPathComponent("handover.json").path)
  #expect((attributes[.posixPermissions] as? NSNumber)?.intValue == 0o600)
}

@MainActor @Test func publicLinkApprovalRejectsChangesAndOverlappingWriters() async throws {
  let root = try linkFixtureRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = LinkHandoverStore(root: root.appendingPathComponent("links"))
  let registry = LinkRegistryFixture()
  let service = handover(registry, store)
  let review = try service.review(.adopt)
  registry.selected = registry.third
  await #expect(throws: LinkHandoverError.self) { try await service.apply(review) }
  registry.selected = registry.old
  registry.applications[registry.native.path] = LinkApplication(
    path: registry.native.path, identifier: registry.native.identifier, revision: "new-binary")
  await #expect(throws: LinkHandoverError.self) { try await service.apply(review) }
  registry.applications[registry.native.path] = registry.native
  let lease = try ProfileLease(paths: [store.root], exclusive: true)
  await #expect(throws: ProfileLockError.self) { try await service.apply(review) }
  lease.release()
  #expect(try registry.calls == 0 && store.read() == nil)
  try await service.apply(review)
  let restore = try service.review(.restore)
  try store.write(
    LinkHandoverReceipt(
      version: 1, id: UUID(), scheme: "craft-hub-test", previous: registry.old, requested: registry.native))
  await #expect(throws: LinkHandoverError.self) { try await service.apply(restore) }
  registry.selected = registry.third
  #expect(throws: LinkHandoverError.self) { try service.review(.restore) }
  #expect(registry.calls == 1)
}

@MainActor @Test func publicLinkRecoveryUsesActualSystemStateAndRetainsFailedReceipts() async throws {
  let root = try linkFixtureRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = LinkHandoverStore(root: root.appendingPathComponent("links"))
  let registry = LinkRegistryFixture()
  let service = handover(registry, store)
  registry.accept = false
  await #expect(throws: LinkHandoverError.self) { try await service.apply(service.review(.adopt)) }
  #expect(try store.read()?.previous == registry.old)
  try await service.apply(service.review(.restore))
  #expect(registry.calls == 1)
  registry.accept = true
  registry.failAfterWrite = true
  await #expect(throws: LinkHandoverError.self) { try await service.apply(service.review(.adopt)) }
  #expect(registry.selected == registry.native)
  registry.failAfterWrite = false
  let restarted = handover(registry, store)
  // A legitimate update of the previous app must be reviewed afresh, rather than using stale executable metadata.
  let updated = LinkApplication(path: registry.old.path, identifier: registry.old.identifier, revision: "old-2")
  registry.applications[updated.path] = updated
  try await restarted.apply(restarted.review(.restore))
  #expect(registry.selected == updated)
  registry.applications.removeValue(forKey: registry.old.path)
  #expect(throws: LinkHandoverError.self) { try restarted.review(.restore) }
}

@MainActor @Test func publicLinkRecoveryRefusesMalformedAndLinkedRecords() async throws {
  let root = try linkFixtureRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = LinkHandoverStore(root: root)
  let file = root.appendingPathComponent("handover.json")
  try Data("invalid".utf8).write(to: file)
  chmod(file.path, 0o600)
  #expect(throws: (any Error).self) { try store.read() }
  let alias = root.appendingPathComponent("alias.json")
  try FileManager.default.linkItem(at: file, to: alias)
  #expect(throws: LinkHandoverError.self) { try store.read() }
  try FileManager.default.removeItem(at: alias)
  try FileManager.default.removeItem(at: file)
  try FileManager.default.createSymbolicLink(at: file, withDestinationURL: alias)
  #expect(throws: LinkHandoverError.self) { try store.read() }
}
