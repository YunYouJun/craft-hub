import CryptoKit
import Foundation
import Security
import Testing

@testable import CraftHubMacCore

/// Uses only a newly created, password-protected keychain; deleting it also removes its search-list entry.
final class FixtureKeychain {
  let root: URL
  let keychain: SecKeychain
  private let password = Array(UUID().uuidString.utf8)

  init() throws {
    root = FileManager.default.temporaryDirectory.appendingPathComponent("craft-hub-keychain-fixture-\(UUID())")
    try FileManager.default.createDirectory(
      at: root, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
    let keychainPath = root.appendingPathComponent("fixture.keychain").path
    var created: SecKeychain?
    let status = password.withUnsafeBytes { bytes in
      SecKeychainCreate(
        keychainPath, UInt32(bytes.count), bytes.baseAddress, false, nil,
        &created)
    }
    guard status == errSecSuccess, let created else {
      try? FileManager.default.removeItem(at: root)
      throw DeviceVaultError.unavailable
    }
    keychain = created
  }

  func unlock() throws {
    let status = password.withUnsafeBytes { bytes in
      SecKeychainUnlock(keychain, UInt32(bytes.count), bytes.baseAddress, true)
    }
    try #require(status == errSecSuccess)
  }

  deinit {
    SecKeychainDelete(keychain)
    try? FileManager.default.removeItem(at: root)
  }
}

@Suite(.serialized) struct KeychainDeviceVaultTests {
  @Test func storesAndRegistersOnlyInTheScopedKeychainAndPreservesStaleIdentities() async throws {
    let fixture = try FixtureKeychain()
    let profile = fixture.root.appendingPathComponent("profile")
    let endpoint = URL(string: "https://api.example.com")!
    let web = URL(string: "https://cloud.example.com")!
    let vault = try KeychainDeviceVault(
      profile: profile, endpoint: endpoint, webOrigin: web, keychain: fixture.keychain)
    #expect(try await vault.load() == nil)
    #expect(!FileManager.default.fileExists(atPath: profile.path))
    let identity = try await vault.loadOrCreate()
    try identity.validate()
    let repeated = try await vault.loadOrCreate()
    let retained = identity == repeated
    #expect(retained)
    let registered = try await vault.register(expected: identity, deviceId: "fixture-device")
    #expect(registered.deviceId == "fixture-device")
    let keyUnchanged = registered.privateKey == identity.privateKey && registered.publicKey == identity.publicKey
    #expect(keyUnchanged)
    await #expect(throws: DeviceVaultError.identityChanged) {
      try await vault.register(expected: identity, deviceId: "stale-registration")
    }
    await #expect(throws: DeviceVaultError.identityChanged) { try await vault.clear(expected: identity) }
    let restored = try KeychainDeviceVault(
      profile: profile, endpoint: endpoint, webOrigin: web, keychain: fixture.keychain)
    #expect(try await restored.load()?.deviceId == "fixture-device")
    let separate = try KeychainDeviceVault(
      profile: fixture.root.appendingPathComponent("other"), endpoint: endpoint, webOrigin: web,
      keychain: fixture.keychain)
    #expect(try await separate.load() == nil)
    let otherCloud = try KeychainDeviceVault(
      profile: profile, endpoint: URL(string: "https://other.example.com")!, webOrigin: web, keychain: fixture.keychain)
    #expect(try await otherCloud.load() == nil)
    try await vault.clear(expected: registered)
    #expect(try await vault.load() == nil)
    #expect(!FileManager.default.fileExists(atPath: profile.path))
  }

  @Test func lockedKeychainReadsFailWithoutPromptOrPlaintextFallback() async throws {
    let fixture = try FixtureKeychain()
    let vault = try KeychainDeviceVault(
      profile: fixture.root, endpoint: URL(string: "https://api.example.com")!,
      webOrigin: URL(string: "https://cloud.example.com")!, keychain: fixture.keychain)
    let original = try await vault.loadOrCreate()
    #expect(SecKeychainLock(fixture.keychain) == errSecSuccess)
    let started = ContinuousClock.now
    await #expect(throws: DeviceVaultError.unavailable) { try await vault.load() }
    #expect(started.duration(to: .now) < .seconds(2))
    try fixture.unlock()
    let restored = try await vault.load()
    let same = original == restored
    #expect(same)
  }

  @Test func noninteractiveKeychainAccessRestoresPolicyAfterThrownOperations() throws {
    func interactionAllowed() throws -> DarwinBoolean {
      var allowed: DarwinBoolean = false
      try #require(SecKeychainGetUserInteractionAllowed(&allowed) == errSecSuccess)
      return allowed
    }
    let before = try FileKeychainAccess.perform(interactive: true) { try interactionAllowed() }
    #expect(throws: DeviceVaultError.unavailable) {
      try FileKeychainAccess.perform(interactive: false) {
        #expect(try interactionAllowed().boolValue == false)
        throw DeviceVaultError.unavailable
      }
    }
    let after = try FileKeychainAccess.perform(interactive: true) { try interactionAllowed() }
    #expect(before.boolValue == after.boolValue)
  }

  @Test func rejectsUnsupportedAndMismatchedIdentityMaterial() throws {
    let first = try CloudDeviceIdentity.create()
    let second = try CloudDeviceIdentity.create()
    #expect(throws: DeviceVaultError.invalidIdentity) {
      try CloudDeviceIdentity(privateKey: first.privateKey, publicKey: second.publicKey)
    }
    #expect(throws: DeviceVaultError.invalidIdentity) { try first.registered(as: "invalid\r\nheader") }
    #expect(throws: DeviceVaultError.invalidIdentity) {
      try CloudDeviceIdentity(privateKey: "private-fixture-invalid", publicKey: first.publicKey)
    }
    #expect(throws: DeviceVaultError.invalidScope) {
      try KeychainDeviceVault(
        profile: URL(fileURLWithPath: "/tmp/fixture"), endpoint: URL(string: "http://api.example.com")!,
        webOrigin: URL(string: "https://cloud.example.com")!)
    }
    #expect(throws: DeviceVaultError.invalidScope) {
      try KeychainDeviceVault(
        profile: URL(fileURLWithPath: "/tmp/fixture"), endpoint: URL(string: "https://user:secret@example.com")!,
        webOrigin: URL(string: "https://cloud.example.com")!)
    }
  }

  @Test(.enabled(if: ProcessInfo.processInfo.environment["CRAFT_HUB_TEST_NODE"] != nil))
  func nativeIdentityUsesTheExistingNodeEd25519Encoding() throws {
    let identity = try CloudDeviceIdentity.create()
    let child = Process()
    child.executableURL = URL(fileURLWithPath: try #require(ProcessInfo.processInfo.environment["CRAFT_HUB_TEST_NODE"]))
    child.arguments = [
      "--input-type=module", "-e",
      """
      import {sign,verify,createPublicKey} from 'node:crypto';
      let text='';for await(const chunk of process.stdin)text+=chunk;
      const key=JSON.parse(text);const data=Buffer.from('native-cloud-fixture');
      if(!verify(null,data,key.publicKey,sign(null,data,key.privateKey)))process.exitCode=1;
      if(createPublicKey(key.privateKey).export({format:'pem',type:'spki'})!==key.publicKey)process.exitCode=2;
      """,
    ]
    let input = Pipe()
    child.standardInput = input
    child.standardOutput = FileHandle.nullDevice
    child.standardError = FileHandle.nullDevice
    try child.run()
    try input.fileHandleForWriting.write(contentsOf: JSONEncoder().encode(identity))
    try input.fileHandleForWriting.close()
    let deadline = Date().addingTimeInterval(10)
    while child.isRunning, Date() < deadline { Thread.sleep(forTimeInterval: 0.01) }
    if child.isRunning { child.terminate() }
    child.waitUntilExit()
    #expect(child.terminationStatus == 0)
  }
}
