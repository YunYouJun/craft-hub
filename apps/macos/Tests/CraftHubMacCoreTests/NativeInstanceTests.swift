import Darwin
import Foundation
import Testing

@testable import CraftHubMacCore

private func instanceFixture() throws -> URL {
  let root = FileManager.default.temporaryDirectory.appendingPathComponent("native-instance-\(UUID())")
  try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
  return root
}

private func nodeContract(_ code: String, arguments: [String], environment: [String: String] = [:]) throws -> Int32 {
  let node = try #require(ProcessInfo.processInfo.environment["CRAFT_HUB_TEST_NODE"])
  var repository = URL(fileURLWithPath: #filePath)
  for _ in 0..<5 { repository.deleteLastPathComponent() }
  let process = Process()
  process.executableURL = URL(fileURLWithPath: node)
  process.arguments = ["--import", "tsx", "--input-type=module", "-e", code] + arguments
  process.currentDirectoryURL = repository
  process.environment = ["PATH": "/usr/bin:/bin", "TMPDIR": "/tmp"].merging(environment) { _, value in value }
  process.standardOutput = FileHandle.nullDevice
  process.standardError = FileHandle.standardError
  try process.run()
  let deadline = Date().addingTimeInterval(10)
  while process.isRunning, Date() < deadline { Thread.sleep(forTimeInterval: 0.01) }
  if process.isRunning {
    kill(process.processIdentifier, SIGKILL)
    process.waitUntilExit()
    throw ProfileLockError.handoffFailed
  }
  process.waitUntilExit()
  return process.terminationStatus
}

private let migrationProbe = """
  import {acquireProfileLease} from './packages/craft-hub/src/profile-lease.ts';
  try { const lease=await acquireProfileLease([process.argv[1]], 'migration');lease.release(); }
  catch { process.exitCode=23; }
  """

@Test(.enabled(if: ProcessInfo.processInfo.environment["CRAFT_HUB_TEST_NODE"] != nil))
func durableNodeGuardBlocksNativeStartupAfterProcessExitAndLegacyMarkerLoss() throws {
  let root = try ProfileLockLocation.canonical(instanceFixture())
  let profile = root.appendingPathComponent("profile")
  let transaction = root.appendingPathComponent("transaction")
  let name = ProfileLockLocation.digest(profile.path) + ".migration.json"
  let durable = try ProfileLockLocation.guardDirectory().appendingPathComponent(name)
  let legacy = try ProfileLockLocation.directory().appendingPathComponent(name)
  defer {
    // Remove only this fixture's marker copies, never SQLite lease files or shared directories.
    try? FileManager.default.removeItem(at: legacy)
    try? FileManager.default.removeItem(at: durable)
    try? FileManager.default.removeItem(at: root)
  }
  let result = try nodeContract(
    """
    import assert from 'node:assert/strict'; import {rm} from 'node:fs/promises';
    import {acquireProfileLease,setProfileMigrationGuard,profileMigrationGuardPath} from './packages/craft-hub/src/profile-lease.ts';
    const [profile,transaction,durable,legacy]=process.argv.slice(1);
    assert.equal(await profileMigrationGuardPath(profile),durable);
    const lease=await acquireProfileLease([profile],'migration');
    try { await setProfileMigrationGuard(lease,profile,transaction); } finally { lease.release(); }
    await rm(legacy);
    """, arguments: [profile.path, transaction.path, durable.path, legacy.path],
    environment: ["HOME": root.appendingPathComponent("isolated-home").path, "TMPDIR": root.path])
  #expect(result == 0)
  #expect(FileManager.default.fileExists(atPath: durable.path))
  #expect(!FileManager.default.fileExists(atPath: legacy.path))
  #expect(throws: ProfileLockError.migrationPending) { try ProfileLease(paths: [profile]) }
  #expect(throws: ProfileLockError.migrationPending) { try ProfileLease(paths: [profile], exclusive: true) }
  #expect(throws: ProfileLockError.migrationPending) { try NativeInstance(profile: profile) }
  #expect(!FileManager.default.fileExists(atPath: profile.path))
  #expect(try nodeContract(migrationProbe, arguments: [profile.path]) == 23)
  let recovered = try nodeContract(
    """
    import {acquireProfileLease,clearProfileMigrationGuard} from './packages/craft-hub/src/profile-lease.ts';
    const [profile,transaction]=process.argv.slice(1);
    const lease=await acquireProfileLease([profile],'migration',transaction);
    try { await clearProfileMigrationGuard(lease,profile,transaction); } finally { lease.release(); }
    """, arguments: [profile.path, transaction.path])
  #expect(recovered == 0)
  #expect(!FileManager.default.fileExists(atPath: durable.path))
  let reopened = try NativeInstance(profile: profile)
  defer { reopened.close() }
  #expect(reopened.isPrimary)
  #expect(!FileManager.default.fileExists(atPath: profile.path))
}

@Test(.enabled(if: ProcessInfo.processInfo.environment["CRAFT_HUB_TEST_NODE"] != nil))
func swiftProfileLeasesExcludeRealNodeMigrationAcrossTemporaryDirectories() throws {
  let root = try instanceFixture()
  defer { try? FileManager.default.removeItem(at: root) }
  let profile = root.appendingPathComponent("profile")
  let first = try ProfileLease(paths: [profile])
  let second = try ProfileLease(paths: [profile])
  defer {
    first.release()
    second.release()
  }
  #expect(try nodeContract(migrationProbe, arguments: [profile.path]) == 23)
  first.release()
  #expect(try nodeContract(migrationProbe, arguments: [profile.path]) == 23)
  second.release()
  #expect(try nodeContract(migrationProbe, arguments: [profile.path]) == 0)
  #expect(!FileManager.default.fileExists(atPath: profile.path))
}

@Test func nativeInstanceKeepsProfilesSeparateAndForwardsOnlyBoundedNavigationOnce() throws {
  let root = try instanceFixture()
  defer { try? FileManager.default.removeItem(at: root) }
  let profile = root.appendingPathComponent("profile")
  let primary = try NativeInstance(profile: profile)
  let secondary = try NativeInstance(profile: ProfileLockLocation.canonical(profile))
  let independent = try NativeInstance(profile: root.appendingPathComponent("another"))
  defer {
    primary.close()
    secondary.close()
    independent.close()
  }
  #expect(primary.isPrimary && !secondary.isPrimary && independent.isPrimary)
  let id = UUID()
  let request = NativeOpenRequest.urls([URL(string: "craft-hub-native://open?v=1&view=marketplace")!])
  try secondary.forward(request, id: id)
  try secondary.forward(request, id: id)
  try secondary.forward(.capture)
  try secondary.forward(.project("fixture"))
  let observed = DispatchSemaphore(value: 0)
  primary.observe { observed.signal() }
  #expect(observed.wait(timeout: .now() + 1) == .success)
  #expect(primary.drain() == [request, .capture, .project("fixture")])
  #expect(independent.drain().isEmpty)
  #expect(throws: ProfileLockError.self) { try secondary.forward(.urls([URL(string: "https://example.com")!])) }
  #expect(throws: ProfileLockError.self) { try secondary.forward(.project("invalid\nquery")) }
  #expect(throws: ProfileLockError.self) {
    try secondary.forward(.urls(Array(repeating: URL(string: "craft-hub-native://open?v=1")!, count: 101)))
  }
  #expect(primary.drain().isEmpty)
  #expect(!FileManager.default.fileExists(atPath: profile.path))
}

@Test func migrationPreventsNativeStartupBeforeAnyProfileIsCreated() async throws {
  let root = try instanceFixture()
  defer { try? FileManager.default.removeItem(at: root) }
  let profile = root.appendingPathComponent("profile")
  let migration = try ProfileLease(paths: [profile], exclusive: true)
  defer { migration.release() }
  #expect(throws: ProfileLockError.self) { try NativeInstance(profile: profile) }
  #expect(!FileManager.default.fileExists(atPath: profile.path))
  migration.release()
  // Concurrent process launches and dispatch cancellation can briefly retain ownership. Require bounded recovery.
  var primary: NativeInstance?
  let startupDeadline = Date().addingTimeInterval(2)
  while Date() < startupDeadline {
    let candidate = try NativeInstance(profile: profile)
    if candidate.isPrimary {
      primary = candidate
      break
    }
    try await Task.sleep(for: .milliseconds(20))
  }
  #expect(primary?.isPrimary == true)
  primary = nil
  let deadline = Date().addingTimeInterval(2)
  var reclaimed = false
  while Date() < deadline {
    let replacement = try NativeInstance(profile: profile)
    if replacement.isPrimary {
      reclaimed = true
      replacement.close()
      break
    }
    try await Task.sleep(for: .milliseconds(20))
  }
  #expect(reclaimed)
}

@Test func nativeInstanceCapsItsStartupQueueAndRetainsAcceptedRequests() throws {
  let root = try instanceFixture()
  defer { try? FileManager.default.removeItem(at: root) }
  let primary = try NativeInstance(profile: root)
  let secondary = try NativeInstance(profile: root)
  defer {
    primary.close()
    secondary.close()
  }
  for _ in 0..<64 { try secondary.forward(.activate) }
  #expect(throws: ProfileLockError.self) { try secondary.forward(.capture, timeout: 0.1) }
  #expect(primary.drain().count == 64)
  try secondary.forward(.capture)
  #expect(primary.drain() == [.capture])
}

@Test(.enabled(if: ProcessInfo.processInfo.environment["CRAFT_HUB_TEST_NODE"] != nil))
func nativeInstanceRejectsMalformedCrossProcessPacketsAndKeepsItsProfileLockedWithoutNode() throws {
  let root = try instanceFixture()
  defer { try? FileManager.default.removeItem(at: root) }
  let primary = try NativeInstance(profile: root)
  defer { primary.close() }
  #expect(try nodeContract(migrationProbe, arguments: [root.path]) == 23)
  let canonical = try ProfileLockLocation.canonical(root)
  let endpoint = try ProfileLockLocation.directory().appendingPathComponent(
    "i-\(ProfileLockLocation.digest(canonical.path).prefix(32)).sock")
  let result = try nodeContract(
    """
    import net from 'node:net'; import assert from 'node:assert/strict'; import {randomUUID} from 'node:crypto';
    async function send(payload){return await new Promise((resolve,reject)=>{
      const socket=net.connect(process.argv[1]);let output='';socket.setTimeout(3000,()=>socket.destroy());
      socket.on('connect',()=>socket.end(payload+'\\n'));socket.on('data',data=>output+=data);
      socket.on('error',()=>{});socket.on('close',()=>resolve(output));
    })}
    for(const packet of ['{invalid', 'x'.repeat(17000), JSON.stringify({version:2,id:randomUUID(),request:{activate:{}}}),
      JSON.stringify({version:1,id:randomUUID(),request:{execute:{command:'never-run'}}}),
      JSON.stringify({version:1,id:randomUUID(),request:{urls:{_0:['https://example.com']}}})]) {
      assert.equal(await send(packet),'');
    }
    const id=randomUUID(); const ack=JSON.parse(await send(JSON.stringify({version:1,id,request:{activate:{}}})));
    assert.equal(ack.id.toLowerCase(),id);assert.equal(ack.accepted,true);
    """, arguments: [endpoint.path])
  #expect(result == 0)
  #expect(primary.drain() == [.activate])
}
