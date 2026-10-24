import Darwin
import Foundation
import Testing

@testable import CraftHubMacCore

private func temporaryRoot() throws -> URL {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent(
    "craft-hub-private-node-test-" + UUID().uuidString)
  try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
  return root
}
private func writeNode(
  _ path: URL, version: String = "v24.22.1", architecture: String = NodeRuntimeInfo.hostArchitecture,
  startupDelay: Int = 0
) throws {
  try FileManager.default.createDirectory(at: path.deletingLastPathComponent(), withIntermediateDirectories: true)
  let delay = startupDelay > 0 ? "/bin/sleep \(startupDelay)\n" : ""
  try Data("#!/bin/sh\n\(delay)printf '%s' '{\"version\":\"\(version)\",\"arch\":\"\(architecture)\"}'\n".utf8).write(
    to: path)
  try FileManager.default.setAttributes([.posixPermissions: 0o755], ofItemAtPath: path.path)
}
private func installedReceipt(_ store: PrivateNodeStore, version: String = "v24.11.0") throws -> PrivateNodeReceipt {
  let receipt = PrivateNodeReceipt(
    directory: "\(version)-\(NodeRuntimeInfo.hostArchitecture)-\(UUID().uuidString)", version: version,
    architecture: NodeRuntimeInfo.hostArchitecture, archiveSHA256: String(repeating: "a", count: 64))
  try writeNode(store.executable(receipt), version: version)
  return receipt
}
private func fixtureArchive(_ root: URL, startupDelay: Int = 0) throws -> (PrivateNodeRelease, URL) {
  let pin = try PrivateNodeRelease.pinned()
  let archive = root.appendingPathComponent("fixture.tar.gz")
  try writeNode(root.appendingPathComponent(pin.directoryName + "/bin/node"), startupDelay: startupDelay)
  try Data("Fixture license".utf8).write(to: root.appendingPathComponent(pin.directoryName + "/LICENSE"))
  _ = try ExecutableProbe.run(
    path: "/usr/bin/tar", arguments: ["-czf", archive.path, "-C", root.path, pin.directoryName], timeout: 10
  ).get()
  return (
    PrivateNodeRelease(
      version: pin.version, architecture: pin.architecture, sha256: try PrivateNodeInstaller.hash(archive)), archive
  )
}
private func fixtureDownload(_ release: PrivateNodeRelease, _ archive: URL, corrupt: Bool = false)
  -> PrivateNodeInstaller.Download
{
  { source, destination, _, _ in
    if source == release.manifestURL {
      try Data("\(release.sha256)  \(release.filename)\n".utf8).write(to: destination)
    } else if corrupt {
      try Data("Corrupt archive".utf8).write(to: destination)
    } else {
      try FileManager.default.copyItem(at: archive, to: destination)
    }
  }
}

@Test func privateNodePinsAnExactSupportedReleaseForEachArchitecture() throws {
  for architecture in ["arm64", "x64"] {
    let release = try PrivateNodeRelease.pinned(architecture: architecture)
    #expect(release.version.isSupportedByRuntime)
    #expect(release.version.description == "v24.22.1")
    #expect(
      release.archiveURL.absoluteString
        == "https://nodejs.org/dist/v24.22.1/node-v24.22.1-darwin-\(architecture).tar.gz")
    #expect(release.sha256.count == 64)
    try release.verifyManifest(Data("\(release.sha256)  \(release.filename)\n".utf8))
    for manifest in [
      "", "\(String(repeating: "0", count: 64))  \(release.filename)\n", "\(release.sha256)  ../\(release.filename)\n",
      "\(release.sha256)  \(release.filename)\n\(release.sha256)  \(release.filename)\n",
    ] {
      #expect(throws: PrivateNodeError.self) { try release.verifyManifest(Data(manifest.utf8)) }
    }
  }
  #expect(throws: PrivateNodeError.self) { try PrivateNodeRelease.pinned(architecture: "unknown") }
}

@Test func privateNodeArchiveMustContainOnlyTheExpectedRootAndItsExecutable() throws {
  let root = "node-v24.22.1-darwin-arm64"
  try PrivateNodeInstaller.validateListing(Data("\(root)/\n\(root)/bin/node\n\(root)/LICENSE\n".utf8), root: root)
  for path in ["/tmp/escape", "\(root)/../escape", "other/bin/node", "\(root)/bad\rname"] {
    #expect(throws: PrivateNodeError.self) {
      try PrivateNodeInstaller.validateListing(Data("\(root)/bin/node\n\(path)\n".utf8), root: root)
    }
  }
  #expect(throws: PrivateNodeError.self) {
    try PrivateNodeInstaller.validateListing(Data("\(root)/LICENSE\n".utf8), root: root)
  }
}

@Test func privateNodeChecksumAndPreflightFailuresPreserveThePreviousSelection() async throws {
  let root = try temporaryRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = PrivateNodeStore(root: root.appendingPathComponent("private"))
  try store.prepare()
  let old = try installedReceipt(store)
  try store.write(.init(version: 1, current: old, previous: nil))
  let (release, archive) = try fixtureArchive(root)
  let corrupted = PrivateNodeInstaller(store: store, download: fixtureDownload(release, archive, corrupt: true))
  await #expect(throws: PrivateNodeError.self) {
    try await corrupted.install(
      release: release, validate: { _ in Issue.record("Unverified bytes reached the executable probe") })
  }
  #expect(try store.state()?.current == old)
  let installer = PrivateNodeInstaller(store: store, download: fixtureDownload(release, archive))
  await #expect(throws: PrivateNodeError.self) {
    try await installer.install(release: release, validate: { _ in throw PrivateNodeError.startupFailed })
  }
  #expect(try store.state()?.current == old)
  #expect(
    try FileManager.default.contentsOfDirectory(atPath: store.root.appendingPathComponent("staging").path).isEmpty)
  #expect(
    try FileManager.default.contentsOfDirectory(atPath: store.root.appendingPathComponent("releases").path) == [
      old.directory
    ])
}

@Test func privateNodeActivationFollowsPreflightAndRollbackRetainsBothVersions() async throws {
  let root = try temporaryRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = PrivateNodeStore(root: root.appendingPathComponent("private"))
  try store.prepare()
  let old = try installedReceipt(store)
  try store.write(.init(version: 1, current: old, previous: nil))
  let (release, archive) = try fixtureArchive(root)
  let installer = PrivateNodeInstaller(store: store, download: fixtureDownload(release, archive))
  let current = try await installer.install(
    release: release,
    validate: { node in
      let before = try store.state()
      #expect(before?.current == old)
      #expect(node.version == release.version && !node.explicit)
    })
  #expect(try store.state()?.current == current && store.state()?.previous == old)
  #expect(FileManager.default.isExecutableFile(atPath: try store.executable(current).path))
  let permission =
    try FileManager.default.attributesOfItem(atPath: store.root.appendingPathComponent("state.json").path)[
      .posixPermissions] as? NSNumber
  #expect(permission?.intValue == 0o600)
  let restored = try store.rollback()
  #expect(restored.current == old && restored.previous == current)
  #expect(FileManager.default.fileExists(atPath: try store.executable(current).path))
}

@Test func privateNodeAllowsFirstLaunchPreparationAfterVerifiedExtraction() async throws {
  let root = try temporaryRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = PrivateNodeStore(root: root.appendingPathComponent("private"))
  // Longer than the ordinary three-second discovery deadline, as observed with newly extracted x64 Node.
  let (release, archive) = try fixtureArchive(root, startupDelay: 4)
  let installer = PrivateNodeInstaller(store: store, download: fixtureDownload(release, archive))
  let receipt = try await installer.install(
    release: release,
    validate: { node in
      #expect(node.version == release.version && node.architecture == release.architecture)
      #expect(node.path.hasPrefix(store.root.appendingPathComponent("releases").path + "/"))
      #expect(FileManager.default.isExecutableFile(atPath: node.path))
      let before = try store.state()
      #expect(before == nil)
    })
  #expect(try store.state()?.current == receipt)
}

@Test func privateNodeNeverTakesPriorityOverExplicitOrSystemNode() throws {
  let root = try temporaryRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = PrivateNodeStore(root: root)
  try store.prepare()
  let receipt = try installedReceipt(store)
  try store.write(.init(version: 1, current: receipt, previous: nil))
  let version = NodeVersion("v24.11.0")!
  let system = NodeLocator(
    home: "/fixture", environment: ["PATH": "/machine/bin"], listDirectory: { _ in [] },
    isExecutable: { $0 == "/machine/bin/node" || $0 == "/chosen/node" },
    inspect: { _ in .success(.init(version: version)) })
  #expect(system.resolveWithPrivateFallback(explicitPath: "/chosen/node", store: store).node?.path == "/chosen/node")
  #expect(system.resolveWithPrivateFallback(explicitPath: nil, store: store).node?.path == "/machine/bin/node")
  let empty = NodeLocator(
    home: "/fixture", environment: [:], listDirectory: { _ in [] }, isExecutable: { _ in false },
    inspect: { _ in .success(.init(version: version)) })
  let fallback = empty.resolveWithPrivateFallback(explicitPath: "/missing/node", store: store)
  #expect(fallback.node?.path == (try store.executable(receipt).path))
  #expect(fallback.rejectedPreference?.path == "/missing/node")
  #expect(fallback.node?.explicit == false)
}

@Test func privateNodeLeaseAndPathValidationPreventConcurrentOrEscapingWrites() throws {
  let root = try temporaryRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = PrivateNodeStore(root: root)
  try store.prepare()
  let lease = try PrivateNodeLease(root: root)
  #expect(throws: PrivateNodeError.self) { try PrivateNodeLease(root: root) }
  lease.release()
  try PrivateNodeLease(root: root).release()
  let escaping = PrivateNodeReceipt(
    directory: "../outside", version: "v24.11.0", architecture: NodeRuntimeInfo.hostArchitecture,
    archiveSHA256: String(repeating: "a", count: 64))
  #expect(throws: PrivateNodeError.self) { try store.executable(escaping) }
  let linked = root.appendingPathComponent("linked")
  try FileManager.default.createSymbolicLink(at: linked, withDestinationURL: root)
  #expect(throws: PrivateNodeError.self) { try PrivateNodeStore(root: linked).prepare() }
}

@Test func cancellingPrivateNodeDownloadCleansStagingWithoutChangingSelection() async throws {
  let root = try temporaryRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = PrivateNodeStore(root: root.appendingPathComponent("private"))
  let release = try PrivateNodeRelease.pinned()
  let started = root.appendingPathComponent("started")
  let installer = PrivateNodeInstaller(
    store: store,
    download: { _, _, _, _ in
      try Data().write(to: started)
      try await Task.sleep(for: .seconds(10))
    })
  let task = Task {
    try await installer.install(
      release: release, validate: { _ in Issue.record("Cancelled transfer reached validation") })
  }
  for _ in 0..<100 {
    if FileManager.default.fileExists(atPath: started.path) { break }
    try await Task.sleep(for: .milliseconds(5))
  }
  task.cancel()
  await #expect(throws: CancellationError.self) { try await task.value }
  #expect(try store.state() == nil)
  #expect(
    try FileManager.default.contentsOfDirectory(atPath: store.root.appendingPathComponent("staging").path).isEmpty)
}

@Test func privateNodeLeaseReleaseUnlocksEvenWhileADuplicateRetainsItsOpenFileDescription() throws {
  let root = try temporaryRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let store = PrivateNodeStore(root: root)
  try store.prepare()
  let lease = try PrivateNodeLease(root: root)
  defer { lease.release() }
  var file = stat()
  guard stat(root.appendingPathComponent("install.lock").path, &file) == 0 else {
    Issue.record("Could not inspect the fixture lock")
    return
  }
  // Locate only this test's unique lock by inode, without opening/reading unrelated files or exposing a test-only API.
  let descriptor = (0..<getdtablesize()).first { descriptor in
    var info = stat()
    return fstat(descriptor, &info) == 0 && info.st_dev == file.st_dev && info.st_ino == file.st_ino
  }
  guard let descriptor else {
    Issue.record("Could not locate the fixture lock descriptor")
    return
  }
  // dup models the shared open file description inherited across fork, without forking a Swift process.
  let duplicate = dup(descriptor)
  guard duplicate >= 0 else {
    Issue.record("Could not duplicate the fixture descriptor")
    return
  }
  defer { close(duplicate) }
  lease.release()
  // The duplicate still retains the lock FD; closing only the original cannot permit this new lease.
  try PrivateNodeLease(root: root).release()
}

@Test(.enabled(if: ProcessInfo.processInfo.environment["CRAFT_HUB_TEST_PRIVATE_NODE_DOWNLOAD"] == "1"))
func officialPrivateNodeDownloadPassesBundledSidecarBeforeActivation() async throws {
  let environment = ProcessInfo.processInfo.environment
  let backend = try #require(environment["CRAFT_HUB_TEST_SIDECAR"])
  let root = try temporaryRoot()
  let store = PrivateNodeStore(root: root.appendingPathComponent("private"))
  defer { if environment["CRAFT_HUB_TEST_PRIVATE_NODE_KEEP"] != "1" { try? FileManager.default.removeItem(at: root) } }
  let release = try PrivateNodeRelease.pinned()
  let receipt = try await PrivateNodeInstaller(store: store).install(
    release: release,
    validate: { node in
      try PrivateNodePreflight.validate(
        node: node, backend: URL(fileURLWithPath: backend), temporaryDirectory: root.appendingPathComponent("preflight")
      )
    })
  #expect(store.resolve()?.version == release.version)
  #expect(try store.state()?.current == receipt)
  if environment["CRAFT_HUB_TEST_PRIVATE_NODE_KEEP"] == "1" {
    try Data(store.executable(receipt).path.utf8).write(
      to: URL(fileURLWithPath: "/tmp/craft-hub-private-node-tested-path.txt"))
  }
}

@Test(.enabled(if: ProcessInfo.processInfo.environment["CRAFT_HUB_TEST_NODE"] != nil))
func privateNodePreflightRequiresAValidHandshakeAndCleanShutdown() throws {
  let root = try temporaryRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let nodePath = try #require(ProcessInfo.processInfo.environment["CRAFT_HUB_TEST_NODE"])
  let node = ResolvedNode(path: nodePath, version: NodeVersion(major: 24, minor: 22, patch: 1), explicit: false)
  let backend = root.appendingPathComponent("backend.mjs")
  let temporary = root.appendingPathComponent("probe")
  let token = String(repeating: "a", count: 64)
  let valid =
    "process.stdout.write(JSON.stringify({version:1,url:'http://127.0.0.1:4318/__craft_hub_host/bootstrap?token=\(token)',nativeApiToken:'\(token)'})+'\\n');process.stdin.resume();process.stdin.on('end',()=>process.exit(0));"
  try Data(valid.utf8).write(to: backend)
  try PrivateNodePreflight.validate(node: node, backend: backend, temporaryDirectory: temporary)
  #expect(!FileManager.default.fileExists(atPath: temporary.path))
  for script in [
    valid.replacingOccurrences(of: "version:1", with: "version:99"),
    valid.replacingOccurrences(of: "process.exit(0)", with: "process.exit(1)"),
  ] {
    try Data(script.utf8).write(to: backend)
    #expect(throws: PrivateNodeError.self) {
      try PrivateNodePreflight.validate(node: node, backend: backend, temporaryDirectory: temporary)
    }
    #expect(!FileManager.default.fileExists(atPath: temporary.path))
  }
}

@Test(.enabled(if: ProcessInfo.processInfo.environment["CRAFT_HUB_TEST_NODE"] != nil))
func cancellingPrivateNodePreflightStopsItsProcessGroupPromptly() async throws {
  let root = try temporaryRoot()
  defer { try? FileManager.default.removeItem(at: root) }
  let nodePath = try #require(ProcessInfo.processInfo.environment["CRAFT_HUB_TEST_NODE"])
  let node = ResolvedNode(path: nodePath, version: NodeVersion(major: 24, minor: 22, patch: 1), explicit: false)
  let backend = root.appendingPathComponent("backend.mjs")
  try Data("setInterval(() => {}, 1000);".utf8).write(to: backend)
  let temporary = root.appendingPathComponent("probe")
  let task = Task.detached {
    try PrivateNodePreflight.validate(node: node, backend: backend, temporaryDirectory: temporary)
  }
  for _ in 0..<100 {
    if FileManager.default.fileExists(atPath: temporary.path) { break }
    try await Task.sleep(for: .milliseconds(5))
  }
  let start = Date()
  task.cancel()
  await #expect(throws: PrivateNodeError.self) { try await task.value }
  #expect(Date().timeIntervalSince(start) < 5)
  #expect(!FileManager.default.fileExists(atPath: temporary.path))
}
