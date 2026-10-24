import Foundation
import Testing

@testable import CraftHubMacCore

@Test(.enabled(if: ProcessInfo.processInfo.environment["CRAFT_HUB_TEST_CLOUD_SIDECAR"] != nil))
func packagedSidecarConnectsSyncsAndRevokesThroughTheProductionPipeAndIsolatedKeychain() async throws {
  let fixture = try FixtureKeychain()
  let child = Process()
  child.executableURL = URL(fileURLWithPath: try #require(ProcessInfo.processInfo.environment["CRAFT_HUB_TEST_NODE"]))
  let apps = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().deletingLastPathComponent()
  child.arguments = [apps.appendingPathComponent("desktop/test/fixtures/native-cloud-sidecar.ts").path]
  child.environment = [
    "HOME": fixture.root.path, "PATH": "/usr/bin:/bin",
    "CRAFT_HUB_TEST_CLOUD_SIDECAR": try #require(ProcessInfo.processInfo.environment["CRAFT_HUB_TEST_CLOUD_SIDECAR"]),
  ]
  let input = Pipe()
  let output = Pipe()
  child.standardInput = input
  child.standardOutput = output
  child.standardError = FileHandle.nullDevice
  try child.run()
  let timeout = DispatchWorkItem { if child.isRunning { kill(child.processIdentifier, SIGKILL) } }
  DispatchQueue.global().asyncAfter(deadline: .now() + 30, execute: timeout)
  defer {
    timeout.cancel()
    try? input.fileHandleForWriting.close()
    try? output.fileHandleForReading.close()
    if child.isRunning { kill(child.processIdentifier, SIGKILL) }
    child.waitUntilExit()
  }
  var prelude = Data()
  while !prelude.contains(10) {
    let bytes = output.fileHandleForReading.availableData
    guard !bytes.isEmpty, prelude.count + bytes.count <= 4096 else { throw NativeHostChannelError.invalidFrame }
    prelude.append(bytes)
  }
  struct Prelude: Decodable { let fixtureOrigin: URL }
  let origin = try JSONDecoder().decode(Prelude.self, from: prelude).fixtureOrigin
  let profile = fixture.root.appendingPathComponent("profile")
  let vault = try KeychainDeviceVault(profile: profile, endpoint: origin, webOrigin: origin, keychain: fixture.keychain)
  let identity = try await vault.loadOrCreate()
  _ = try await vault.register(expected: identity, deviceId: "packaged-fixture")
  let channel = try NativeRuntimeChannel(input: input.fileHandleForWriting, vault: vault) {
    if child.isRunning { kill(child.processIdentifier, SIGKILL) }
  }
  try input.fileHandleForWriting.write(
    contentsOf: JSONSerialization.data(withJSONObject: ["publicKey": identity.publicKey]) + Data([10]))
  var connections = 0
  while true {
    let bytes = output.fileHandleForReading.availableData
    if bytes.isEmpty { break }
    if try channel.accept(bytes) != nil { connections += 1 }
  }
  child.waitUntilExit()
  await channel.close()
  #expect(child.terminationStatus == 0 && connections == 1)
  #expect(try await vault.load() == nil)
  #expect(
    !FileManager.default.fileExists(atPath: profile.appendingPathComponent("runtime/personal-cloud-device.json").path))
  let files = FileManager.default.enumerator(at: profile, includingPropertiesForKeys: [.isRegularFileKey])
  var leaked = false
  while let file = files?.nextObject() as? URL {
    if (try? file.resourceValues(forKeys: [.isRegularFileKey]).isRegularFile) == true,
      let data = try? Data(contentsOf: file), data.range(of: Data(identity.privateKey.utf8)) != nil
    {
      leaked = true
    }
  }
  #expect(!leaked)
}
