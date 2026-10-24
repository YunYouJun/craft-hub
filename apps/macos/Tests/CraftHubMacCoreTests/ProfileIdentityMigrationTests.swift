import Darwin
import Foundation
import Testing

@testable import CraftHubMacCore

@Test func nativeIdentityParticipantRequiresTheCompleteBindingAndPreservesLaterDevices() async throws {
  let fixture = try FixtureKeychain()
  let root = try ProfileLockLocation.canonical(fixture.root)
  let source = root.appendingPathComponent("source")
  let target = root.appendingPathComponent("target")
  try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
  let identity = try CloudDeviceIdentity.create().registered(as: "fixture-device")
  try JSONSerialization.data(withJSONObject: [
    "schemaVersion": 1, "deviceId": identity.deviceId!, "publicKey": identity.publicKey,
    "encryptedPrivateKey": Data("opaque fixture".utf8).base64EncodedString(),
  ]).write(to: source.appendingPathComponent("personal-cloud-device.json"))
  let endpoint = URL(string: "https://api.example.com")!
  let web = URL(string: "https://cloud.example.com")!
  let transfer = try NativeIdentityTransfer(source: source, target: target, endpoint: endpoint, webOrigin: web)
  let request = transfer.request
  func context(id: String) -> ProfileIdentityContext {
    ProfileIdentityContext(
      transaction: root.appendingPathComponent("transaction").path,
      paths: .init(
        sourceData: request.sourceData, sourceConfig: root.appendingPathComponent("portable").path,
        target: request.targetProfile),
      identity: .init(
        id: id, sourceRevision: request.sourceRevision, publicKey: request.publicKey, deviceId: request.deviceId,
        endpoint: request.endpoint, webOrigin: request.webOrigin))
  }
  let matching = context(id: request.challenge)
  let other = context(id: String(repeating: request.challenge.hasPrefix("a") ? "b" : "a", count: 64))
  let vault = try KeychainDeviceVault(profile: target, endpoint: endpoint, webOrigin: web, keychain: fixture.keychain)
  #expect(try await vault.migrationState(matching) == .empty)
  await #expect(throws: DeviceVaultError.identityChanged) {
    try await vault.stageMigration(identity, request: request, context: other)
  }
  try await vault.stageMigration(identity, request: request, context: matching)
  await #expect(throws: DeviceVaultError.identityChanged) { try await vault.migrationState(other) }
  await #expect(throws: DeviceVaultError.identityChanged) { try await vault.activateMigration(other) }
  await #expect(throws: DeviceVaultError.identityChanged) { try await vault.finishMigration(other) }
  await #expect(throws: DeviceVaultError.identityChanged) { try await vault.rollbackMigration(other) }
  try await vault.activateMigration(matching)
  #expect(try await vault.migrationState(matching) == .activated)
  try await vault.finishMigration(matching)
  try await vault.finishMigration(matching)
  #expect(try await vault.migrationState(matching) == .active)
  try await vault.rollbackMigration(matching)
  try await vault.rollbackMigration(matching)
  #expect(try await vault.load() == nil)
  let later = try await vault.loadOrCreate()
  await #expect(throws: DeviceVaultError.identityChanged) { try await vault.rollbackMigration(matching) }
  let preserved = try await vault.load() == later
  #expect(preserved)
  let differentScope = try KeychainDeviceVault(
    profile: root.appendingPathComponent("other"), endpoint: endpoint, webOrigin: web, keychain: fixture.keychain)
  await #expect(throws: DeviceVaultError.invalidScope) { try await differentScope.migrationState(matching) }
  #expect(!FileManager.default.fileExists(atPath: target.path))
}

@Test(.enabled(if: ProcessInfo.processInfo.environment["CRAFT_HUB_TEST_NODE"] != nil))
func realNodeProfileCoordinatorCommitsRecoversAndRollsBackWithAnIsolatedNativeKeychain() async throws {
  let fixture = try FixtureKeychain()
  let root = try ProfileLockLocation.canonical(fixture.root)
  let source = root.appendingPathComponent("source")
  let target = root.appendingPathComponent("target")
  let endpoint = URL(string: "https://api.example.com")!
  let web = URL(string: "https://cloud.example.com")!
  let child = Process()
  child.executableURL = URL(fileURLWithPath: try #require(ProcessInfo.processInfo.environment["CRAFT_HUB_TEST_NODE"]))
  var repository = URL(fileURLWithPath: #filePath)
  for _ in 0..<5 { repository.deleteLastPathComponent() }
  child.currentDirectoryURL = repository
  child.arguments = ["--import", "tsx", "apps/desktop/test/fixtures/identity-profile-migration.ts", root.path]
  let input = Pipe()
  let output = Pipe()
  child.standardInput = input
  child.standardOutput = output
  child.standardError = FileHandle.nullDevice
  let watchdog = DispatchWorkItem { if child.isRunning { kill(child.processIdentifier, SIGKILL) } }
  defer {
    watchdog.cancel()
    if child.isRunning { kill(child.processIdentifier, SIGKILL) }
    child.waitUntilExit()
    try? input.fileHandleForWriting.close()
    try? output.fileHandleForReading.close()
    // Fixture-only cleanup on failures. SQLite lock files are never removed.
    for path in [
      source, root.appendingPathComponent("portable"), target, target.appendingPathComponent("runtime"),
      target.appendingPathComponent("config"),
    ] {
      let name = ProfileLockLocation.digest(path.path) + ".migration.json"
      for directory in [try? ProfileLockLocation.guardDirectory(), try? ProfileLockLocation.directory()].compactMap({
        $0
      }) {
        try? FileManager.default.removeItem(at: directory.appendingPathComponent(name))
      }
    }
  }
  try child.run()
  DispatchQueue.global().asyncAfter(deadline: .now() + 30, execute: watchdog)
  var buffer = Data()
  func readLine() async throws -> Data {
    while buffer.firstIndex(of: 10) == nil {
      let chunk = await readFixturePipe(output.fileHandleForReading)
      guard !chunk.isEmpty, buffer.count + chunk.count <= 32768 else { throw NativeHostChannelError.invalidFrame }
      buffer.append(chunk)
    }
    let newline = buffer.firstIndex(of: 10)!
    let value = Data(buffer[..<newline])
    buffer.removeSubrange(...newline)
    return value
  }
  #expect(try await readLine() == Data("ready".utf8))
  let vault = try KeychainDeviceVault(profile: target, endpoint: endpoint, webOrigin: web, keychain: fixture.keychain)
  var authentications = 0
  func session() -> IdentityMaintenanceSession {
    IdentityMaintenanceSession(
      authenticate: { authentications += 1 },
      makeVault: { try KeychainDeviceVault(profile: $0, endpoint: $1, webOrigin: $2, keychain: fixture.keychain) })
  }
  var recipient = session()
  try input.fileHandleForWriting.write(contentsOf: await recipient.ready())
  struct Frame: Decodable {
    let operation: String?
    let testControl: String?
  }
  var operations: [String] = []
  while true {
    let data = try await readLine()
    let frame = try JSONDecoder().decode(Frame.self, from: data)
    if frame.testControl == "done" { break }
    if frame.testControl == "reopen" {
      operations.append("reopen")
      await recipient.close()
      recipient = session()
      await #expect(throws: DeviceVaultError.migrationPending) { try await vault.load() }
      try input.fileHandleForWriting.write(contentsOf: await recipient.ready())
      continue
    }
    let operation = try #require(frame.operation)
    operations.append(operation)
    let response = try await recipient.accept(data)
    if operation == "stage" || operation == "activate" {
      await #expect(throws: DeviceVaultError.migrationPending) { try await vault.load() }
    }
    try input.fileHandleForWriting.write(contentsOf: response)
  }
  await recipient.close()
  try input.fileHandleForWriting.close()
  try await waitForFixtureProcess(child)
  #expect(child.terminationStatus == 0)
  #expect(operations.filter { $0 == "stage" }.count == 1)
  #expect(operations.contains("reopen") && operations.contains("finish") && operations.contains("rollback"))
  #expect(authentications >= operations.count * 2)
  #expect(try await vault.load() == nil)
  #expect(try await vault.transferState() == nil)
}
