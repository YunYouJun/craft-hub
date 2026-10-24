import Foundation
import Testing

@testable import CraftHubMacCore

private func maintenanceFrame(_ operation: String, id: Any = 1, _ extra: [String: Any] = [:]) throws -> Data {
  try JSONSerialization.data(
    withJSONObject: ["version": 1, "id": id, "operation": operation].merging(extra) { _, new in new })
}

private struct MaintenanceFixture {
  let keychain: FixtureKeychain
  let root: URL
  let paths: [String: String]
  let identity: CloudDeviceIdentity
  init() throws {
    keychain = try FixtureKeychain()
    root = try ProfileLockLocation.canonical(keychain.root)
    paths = [
      "sourceData": root.appendingPathComponent("source").path,
      "sourceConfig": root.appendingPathComponent("config").path, "target": root.appendingPathComponent("native").path,
    ]
    try FileManager.default.createDirectory(atPath: paths["sourceData"]!, withIntermediateDirectories: true)
    identity = try CloudDeviceIdentity.create().registered(as: "fixture")
    try JSONSerialization.data(withJSONObject: [
      "schemaVersion": 1, "deviceId": identity.deviceId!, "publicKey": identity.publicKey,
      "encryptedPrivateKey": Data("opaque fixture".utf8).base64EncodedString(),
    ])
    .write(to: URL(fileURLWithPath: paths["sourceData"]!).appendingPathComponent("personal-cloud-device.json"))
  }
  func prepare() throws -> Data {
    try maintenanceFrame(
      "prepare", ["paths": paths, "endpoint": "https://api.example.com", "webOrigin": "https://cloud.example.com"])
  }
  func session() -> IdentityMaintenanceSession {
    IdentityMaintenanceSession(
      authenticate: {},
      makeVault: { try KeychainDeviceVault(profile: $0, endpoint: $1, webOrigin: $2, keychain: keychain.keychain) })
  }
}

@Test func identityMaintenanceDispatchRejectsMalformedModesBeforeNormalStartup() {
  let flag = IdentityMaintenanceEntry.argument
  #expect(IdentityMaintenanceEntry.mode(arguments: ["app"]) == .application)
  #expect(IdentityMaintenanceEntry.mode(arguments: ["app", "-psn_0"]) == .application)
  #expect(IdentityMaintenanceEntry.mode(arguments: ["app", flag]) == .recipient)
  for arguments in [
    ["app", flag, "--extra"], ["app", flag, flag], ["app", flag + "=true"],
    ["app", "--craft-hub-native-identity-unknown"],
  ] {
    #expect(IdentityMaintenanceEntry.mode(arguments: arguments) == .rejected)
  }
}

@Test func identityMaintenanceAuthenticatesBeforeVaultConstructionAndBeforeReturningARecipientKey() async throws {
  let fixture = try MaintenanceFixture()
  var factories = 0
  let rejected = IdentityMaintenanceSession(
    authenticate: { throw IdentityTransferError.rejected },
    makeVault: { _, _, _ in
      factories += 1
      throw IdentityTransferError.rejected
    })
  await #expect(throws: IdentityTransferError.self) { try await rejected.ready() }
  await #expect(throws: IdentityTransferError.self) { try await rejected.accept(fixture.prepare()) }
  #expect(factories == 0)
  var valid = true
  let lostParent = IdentityMaintenanceSession(
    authenticate: {
      if !valid { throw IdentityTransferError.rejected }
    },
    makeVault: {
      valid = false
      return try KeychainDeviceVault(profile: $0, endpoint: $1, webOrigin: $2, keychain: fixture.keychain.keychain)
    })
  await #expect(throws: IdentityTransferError.self) { try await lostParent.accept(fixture.prepare()) }
  #expect(await lostParent.isClosed)
  #expect(!FileManager.default.fileExists(atPath: fixture.paths["target"]!))
}

@Test func identityMaintenanceRejectsReplayUnknownFieldsAndChangedTransactionBindings() async throws {
  let fixture = try MaintenanceFixture()
  let session = fixture.session()
  let response = try await session.accept(fixture.prepare())
  let decoded = try #require(try JSONSerialization.jsonObject(with: response) as? [String: Any])
  let value = try #require(decoded["value"] as? [String: Any])
  let request = try JSONDecoder().decode(
    IdentityTransferRequest.self, from: JSONSerialization.data(withJSONObject: value["request"]!))
  #expect(!String(decoding: response, as: UTF8.self).contains(fixture.identity.privateKey))
  let binding: [String: Any] = [
    "id": request.challenge, "sourceRevision": request.sourceRevision, "publicKey": request.publicKey,
    "deviceId": request.deviceId!, "endpoint": request.endpoint, "webOrigin": request.webOrigin,
  ]
  var context: [String: Any] = [
    "transaction": fixture.root.appendingPathComponent(".native.migration-\(UUID().uuidString.lowercased())").path,
    "paths": fixture.paths, "identity": binding,
  ]
  _ = try await session.accept(maintenanceFrame("inspect", id: 2, ["context": context]))
  context["transaction"] =
    fixture.root.appendingPathComponent(".native.migration-\(UUID().uuidString.lowercased())").path
  await #expect(throws: IdentityTransferError.self) {
    try await session.accept(maintenanceFrame("inspect", id: 3, ["context": context]))
  }
  #expect(await session.isClosed)
  for invalid in [
    try maintenanceFrame("close", id: true), try maintenanceFrame("close", id: 2),
    try maintenanceFrame("close", ["privateKey": "caller-selected"]), Data("{invalid".utf8),
  ] {
    let fresh = fixture.session()
    await #expect(throws: IdentityTransferError.self) { try await fresh.accept(invalid) }
    await #expect(throws: IdentityTransferError.self) { try await fresh.accept(maintenanceFrame("close")) }
  }
  #expect(!FileManager.default.fileExists(atPath: fixture.paths["target"]!))
}

@Test func identityMaintenanceRejectsOverlappingPathsAndNoncanonicalOrigins() async throws {
  let fixture = try MaintenanceFixture()
  for extra: [String: Any] in [
    [
      "paths": [
        "sourceData": fixture.paths["sourceData"]!, "sourceConfig": fixture.paths["sourceData"]!,
        "target": fixture.paths["target"]!,
      ], "endpoint": "https://api.example.com", "webOrigin": "https://cloud.example.com",
    ],
    ["paths": fixture.paths, "endpoint": "https://api.example.com/path", "webOrigin": "https://cloud.example.com"],
    [
      "paths": fixture.paths, "endpoint": "https://user:password@api.example.com",
      "webOrigin": "https://cloud.example.com",
    ],
  ] {
    let session = fixture.session()
    await #expect(throws: IdentityTransferError.self) { try await session.accept(maintenanceFrame("prepare", extra)) }
  }
}

@Test func identityMaintenanceInputBoundsFragmentsEOFAndStalledWriters() async throws {
  let pipe = Pipe()
  defer {
    try? pipe.fileHandleForWriting.close()
    try? pipe.fileHandleForReading.close()
  }
  // Successful fragmentation must tolerate scheduling alongside the process/Keychain fixtures.
  // Test the short idle deadline separately, on an empty pipe with no expected successful reply.
  let reader = try IdentityMaintenanceInput(handle: pipe.fileHandleForReading, timeout: .seconds(2))
  try pipe.fileHandleForWriting.write(contentsOf: Data("{\"par".utf8))
  let pending = Task { try await reader.next() }
  try await Task.sleep(for: .milliseconds(10))
  try pipe.fileHandleForWriting.write(contentsOf: Data("t\":true}\n{}\n".utf8))
  #expect(try await pending.value == Data("{\"part\":true}".utf8))
  #expect(try await reader.next() == Data("{}".utf8))
  let stalled = Pipe()
  defer {
    try? stalled.fileHandleForWriting.close()
    try? stalled.fileHandleForReading.close()
  }
  let idleReader = try IdentityMaintenanceInput(handle: stalled.fileHandleForReading, timeout: .milliseconds(30))
  await #expect(throws: IdentityTransferError.self) { try await idleReader.next() }
  try pipe.fileHandleForWriting.write(contentsOf: Data("truncated".utf8))
  try pipe.fileHandleForWriting.close()
  await #expect(throws: IdentityTransferError.self) { try await reader.next() }
  #expect(throws: IdentityTransferError.self) { try IdentityMaintenanceInput(handle: .nullDevice) }
}

@Test func identityMaintenanceTransportClosesWithoutLeakingAnUntrustedHandshake() async throws {
  let input = Pipe()
  let output = Pipe()
  defer {
    for handle in [
      input.fileHandleForReading, input.fileHandleForWriting, output.fileHandleForReading, output.fileHandleForWriting,
    ] { try? handle.close() }
  }
  let refused = IdentityMaintenanceSession(authenticate: { throw IdentityTransferError.rejected })
  #expect(
    await runIdentityMaintenance(
      session: refused, input: input.fileHandleForReading, output: output.fileHandleForWriting) == 1)
  try output.fileHandleForWriting.close()
  #expect(output.fileHandleForReading.readDataToEndOfFile().isEmpty)
  #expect(await refused.isClosed)
}

@Test func identityMaintenanceTransportHonorsCloseAndRejectsOversizedFrames() async throws {
  for oversized in [false, true] {
    let input = Pipe()
    let output = Pipe()
    defer {
      for handle in [
        input.fileHandleForReading, input.fileHandleForWriting, output.fileHandleForReading,
        output.fileHandleForWriting,
      ] { try? handle.close() }
    }
    let session = IdentityMaintenanceSession(authenticate: {})
    let running = Task {
      await runIdentityMaintenance(
        session: session, input: input.fileHandleForReading, output: output.fileHandleForWriting)
    }
    let responses = try IdentityMaintenanceInput(handle: output.fileHandleForReading, timeout: .seconds(2))
    let ready = try #require(try await responses.next())
    #expect(String(decoding: ready, as: UTF8.self).contains("identity-recipient-ready"))
    if oversized {
      // Concurrent writes avoid filling a pipe before the reader has a chance to reject the bounded frame.
      let writer = try NativePipeWriter(handle: input.fileHandleForWriting)
      for _ in 0..<5 { try await writer.send(Data(repeating: 65, count: 16 * 1024)) }
      await writer.close()
      #expect(await running.value == 1)
    } else {
      try input.fileHandleForWriting.write(contentsOf: maintenanceFrame("close") + Data([10]))
      let reply = try #require(try await responses.next())
      let object = try #require(try JSONSerialization.jsonObject(with: reply) as? [String: Any])
      #expect((object["value"] as? [String: Bool]) == ["closed": true])
      #expect(await running.value == 0)
    }
    #expect(await session.isClosed)
  }
}
