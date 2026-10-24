import CryptoKit
import Darwin
import Foundation
import Security
import Testing

@testable import CraftHubMacCore

@Suite(.serialized) struct IdentityTransferTests {
  private let endpoint = URL(string: "https://api.example.com")!
  private let web = URL(string: "https://cloud.example.com")!

  private func source(_ fixture: FixtureKeychain, identity: CloudDeviceIdentity) throws -> URL {
    let source = fixture.root.appendingPathComponent("源资料")
    try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
    let value: [String: Any] = [
      "schemaVersion": 1, "deviceId": identity.deviceId!, "publicKey": identity.publicKey,
      "encryptedPrivateKey": Data("opaque fixture ciphertext".utf8).base64EncodedString(),
    ]
    try JSONSerialization.data(withJSONObject: value).write(
      to: source.appendingPathComponent("personal-cloud-device.json"))
    return source
  }

  private func seal(_ request: IdentityTransferRequest, identity: CloudDeviceIdentity) throws -> Data {
    let sender = Curve25519.KeyAgreement.PrivateKey()
    let secret = try sender.sharedSecretFromKeyAgreement(
      with: Curve25519.KeyAgreement.PublicKey(rawRepresentation: Data(base64Encoded: request.recipientKey)!))
    let salt = Data(
      stride(from: 0, to: request.challenge.count, by: 2).map { offset in
        let start = request.challenge.index(request.challenge.startIndex, offsetBy: offset)
        return UInt8(request.challenge[start..<request.challenge.index(start, offsetBy: 2)], radix: 16)!
      })
    let key = secret.hkdfDerivedSymmetricKey(
      using: SHA256.self, salt: salt, sharedInfo: Data("CRAFT-HUB-IDENTITY-TRANSFER-V1".utf8), outputByteCount: 32)
    let sealed = try AES.GCM.seal(JSONEncoder().encode(identity), using: key, authenticating: request.context)
    return try JSONSerialization.data(withJSONObject: [
      "version": 1, "challenge": request.challenge,
      "senderKey": sender.publicKey.rawRepresentation.base64EncodedString(),
      "sealed": sealed.combined!.base64EncodedString(),
    ])
  }

  @Test func transferIsSingleUseAndRejectsExpirySourceChangesAndSubstitutedDeviceKeys() async throws {
    let fixture = try FixtureKeychain()
    let identity = try CloudDeviceIdentity.create().registered(as: "fixture-device")
    let source = try source(fixture, identity: identity)
    let target = fixture.root.appendingPathComponent("目标资料")
    let session = try NativeIdentityTransfer(source: source, target: target, endpoint: endpoint, webOrigin: web)
    let envelope = try seal(session.request, identity: identity)
    let received = try await session.receive(envelope)
    #expect(received == identity)
    await #expect(throws: IdentityTransferError.self) { try await session.receive(envelope) }

    let expired = try NativeIdentityTransfer(source: source, target: target, endpoint: endpoint, webOrigin: web)
    await #expect(throws: IdentityTransferError.self) {
      try await expired.receive(seal(expired.request, identity: identity), now: Date().addingTimeInterval(121))
    }
    let wrong = try NativeIdentityTransfer(source: source, target: target, endpoint: endpoint, webOrigin: web)
    let unrelated = try CloudDeviceIdentity.create().registered(as: "fixture-device")
    await #expect(throws: IdentityTransferError.self) {
      try await wrong.receive(seal(wrong.request, identity: unrelated))
    }
    await #expect(throws: IdentityTransferError.self) {
      try await wrong.receive(seal(wrong.request, identity: identity))
    }

    let changed = try NativeIdentityTransfer(source: source, target: target, endpoint: endpoint, webOrigin: web)
    let changedEnvelope = try seal(changed.request, identity: identity)
    let file = source.appendingPathComponent("personal-cloud-device.json")
    var bytes = try Data(contentsOf: file)
    bytes.append(10)
    try bytes.write(to: file)
    await #expect(throws: IdentityTransferError.self) { try await changed.receive(changedEnvelope) }
    #expect(!FileManager.default.fileExists(atPath: target.path))
    try FileManager.default.removeItem(at: file)
    #expect(mkfifo(file.path, 0o600) == 0)
    #expect(throws: IdentityTransferError.self) {
      try NativeIdentityTransfer(source: source, target: target, endpoint: endpoint, webOrigin: web)
    }
  }

  @Test func keychainReservationSurvivesRecreationAndBlocksAccountsUntilCommitOrAbort() async throws {
    let fixture = try FixtureKeychain()
    let identity = try CloudDeviceIdentity.create().registered(as: "fixture-device")
    let source = try source(fixture, identity: identity)
    let target = fixture.root.appendingPathComponent("target")
    let session = try NativeIdentityTransfer(source: source, target: target, endpoint: endpoint, webOrigin: web)
    let vault = try KeychainDeviceVault(profile: target, endpoint: endpoint, webOrigin: web, keychain: fixture.keychain)
    try await vault.stageTransfer(identity, request: session.request)
    try await vault.stageTransfer(identity, request: session.request)
    await #expect(throws: DeviceVaultError.migrationPending) { try await vault.load() }
    await #expect(throws: DeviceVaultError.migrationPending) { try await vault.loadOrCreate() }
    await #expect(throws: DeviceVaultError.identityChanged) { try await vault.abortTransfer(id: "wrong") }
    let restarted = try KeychainDeviceVault(
      profile: target, endpoint: endpoint, webOrigin: web, keychain: fixture.keychain)
    #expect(try await restarted.transferState()?.request == session.request)
    await #expect(throws: DeviceVaultError.identityChanged) {
      try await restarted.finishTransfer(id: session.request.challenge)
    }
    try await restarted.activateTransfer(id: session.request.challenge)
    try await restarted.activateTransfer(id: session.request.challenge)
    await #expect(throws: DeviceVaultError.migrationPending) { try await restarted.load() }
    try await restarted.abortTransfer(id: session.request.challenge)
    #expect(try await restarted.load() == nil)
    #expect(try await restarted.transferState() == nil)
    try await restarted.stageTransfer(identity, request: session.request)
    try await restarted.activateTransfer(id: session.request.challenge)
    try await restarted.finishTransfer(id: session.request.challenge)
    #expect(try await restarted.load() == identity)
    await #expect(throws: DeviceVaultError.identityChanged) {
      try await restarted.stageTransfer(identity, request: session.request)
    }
    let wrongScope = try KeychainDeviceVault(
      profile: fixture.root.appendingPathComponent("other"), endpoint: endpoint, webOrigin: web,
      keychain: fixture.keychain)
    await #expect(throws: DeviceVaultError.invalidScope) {
      try await wrongScope.stageTransfer(identity, request: session.request)
    }
    #expect(!FileManager.default.fileExists(atPath: target.path))
  }

  @Test func recoveryRefusesOtherTransfersAndUnrelatedDestinationKeys() async throws {
    let fixture = try FixtureKeychain()
    let identity = try CloudDeviceIdentity.create().registered(as: "fixture-device")
    let source = try source(fixture, identity: identity)
    let target = fixture.root.appendingPathComponent("target")
    let session = try NativeIdentityTransfer(source: source, target: target, endpoint: endpoint, webOrigin: web)
    let other = try NativeIdentityTransfer(source: source, target: target, endpoint: endpoint, webOrigin: web)
    let vault = try KeychainDeviceVault(profile: target, endpoint: endpoint, webOrigin: web, keychain: fixture.keychain)
    try await vault.stageTransfer(identity, request: session.request)
    await #expect(throws: DeviceVaultError.migrationPending) {
      try await vault.stageTransfer(identity, request: other.request)
    }
    try await vault.activateTransfer(id: session.request.challenge)
    let scope = String(
      decoding: try JSONEncoder().encode([
        session.request.targetProfile, session.request.endpoint, session.request.webOrigin,
      ]),
      as: UTF8.self)
    var selector: [String: Any] = [
      kSecClass as String: kSecClassGenericPassword,
      kSecAttrService as String: "dev.craft-hub.macos-prototype.personal-cloud." + ProfileLockLocation.digest(scope),
      kSecAttrAccount as String: "device-v1", kSecMatchSearchList as String: [fixture.keychain],
    ]
    let unrelated = try CloudDeviceIdentity.create().registered(as: "later-device")
    #expect(
      SecItemUpdate(
        selector as CFDictionary, [kSecValueData as String: try JSONEncoder().encode(unrelated)] as CFDictionary)
        == errSecSuccess)
    await #expect(throws: DeviceVaultError.identityChanged) {
      try await vault.abortTransfer(id: session.request.challenge)
    }
    await #expect(throws: DeviceVaultError.identityChanged) {
      try await vault.finishTransfer(id: session.request.challenge)
    }
    #expect(try await vault.transferState()?.request.challenge == session.request.challenge)
    selector[kSecReturnData as String] = true
    var retained: CFTypeRef?
    #expect(SecItemCopyMatching(selector as CFDictionary, &retained) == errSecSuccess)
    let preserved = try JSONDecoder().decode(CloudDeviceIdentity.self, from: #require(retained as? Data)) == unrelated
    #expect(preserved)
    #expect(SecKeychainLock(fixture.keychain) == errSecSuccess)
    let started = ContinuousClock.now
    await #expect(throws: DeviceVaultError.unavailable) { try await vault.transferState() }
    #expect(started.duration(to: .now) < .seconds(2))
    try fixture.unlock()
  }

  @Test(.enabled(if: ProcessInfo.processInfo.environment["CRAFT_HUB_TEST_NODE"] != nil))
  func realNodeVaultEncryptsForSwiftRecipientWithoutWritingTransferredSecrets() async throws {
    let fixture = try FixtureKeychain()
    let source = fixture.root.appendingPathComponent("源资料")
    let target = fixture.root.appendingPathComponent("目标资料")
    let child = Process()
    child.executableURL = URL(fileURLWithPath: try #require(ProcessInfo.processInfo.environment["CRAFT_HUB_TEST_NODE"]))
    let repository = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
    child.currentDirectoryURL = repository
    child.arguments = ["--import", "tsx", "apps/desktop/test/fixtures/identity-transfer.ts", source.path]
    let input = Pipe()
    let output = Pipe()
    child.standardInput = input
    child.standardOutput = output
    child.standardError = FileHandle.nullDevice
    let watchdog = DispatchWorkItem { if child.isRunning { child.terminate() } }
    defer {
      watchdog.cancel()
      if child.isRunning { child.terminate() }
      child.waitUntilExit()
      try? input.fileHandleForWriting.close()
      try? output.fileHandleForReading.close()
    }
    try child.run()
    DispatchQueue.global().asyncAfter(deadline: .now() + 20, execute: watchdog)
    #expect(output.fileHandleForReading.availableData == Data("ready\n".utf8))
    let original = try Data(contentsOf: source.appendingPathComponent("personal-cloud-device.json"))
    let session = try NativeIdentityTransfer(source: source, target: target, endpoint: endpoint, webOrigin: web)
    try input.fileHandleForWriting.write(contentsOf: JSONEncoder().encode(session.request))
    try input.fileHandleForWriting.close()
    let envelope = try #require(try output.fileHandleForReading.readToEnd())
    child.waitUntilExit()
    #expect(child.terminationStatus == 0)
    let identity = try await session.receive(envelope)
    #expect(identity.deviceId == "fixture-source-device")
    let vault = try KeychainDeviceVault(profile: target, endpoint: endpoint, webOrigin: web, keychain: fixture.keychain)
    try await vault.stageTransfer(identity, request: session.request)
    try await vault.activateTransfer(id: session.request.challenge)
    try await vault.finishTransfer(id: session.request.challenge)
    #expect(try await vault.load() == identity)
    let current = try Data(contentsOf: source.appendingPathComponent("personal-cloud-device.json"))
    #expect(current == original)
    let secretAbsent =
      !String(decoding: current, as: UTF8.self).contains(identity.privateKey)
      && !String(decoding: envelope, as: UTF8.self).contains(identity.privateKey)
    #expect(secretAbsent)
    #expect(!FileManager.default.fileExists(atPath: target.path))
    try await vault.clear(expected: identity)
  }
}
