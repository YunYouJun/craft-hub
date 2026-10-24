import Foundation
import Testing

@testable import CraftHubMacCore

private func requestFrame(_ method: String = "vault.load", id: String = UUID().uuidString, payload: [String: Any] = [:])
  throws -> Data
{
  try JSONSerialization.data(withJSONObject: ["hostBridge": 1, "id": id, "method": method, "payload": payload])
}

private func handshakeFrame() throws -> Data {
  try JSONSerialization.data(withJSONObject: [
    "version": 1,
    "url": "http://127.0.0.1:49218/__craft_hub_host/bootstrap?token=\(String(repeating: "a", count: 64))",
    "nativeApiToken": String(repeating: "b", count: 64),
  ])
}

@Suite struct NativeHostChannelTests {
  @Test func decodesFragmentedHandshakeAndCoalescedFramesWithoutReplacingTheConnection() throws {
    var decoder = NativeHostOutputDecoder()
    let handshake = try handshakeFrame()
    #expect(try decoder.append(handshake.prefix(11)).isEmpty)
    let messages = try decoder.append(handshake.dropFirst(11) + Data([10]) + requestFrame() + Data([10]))
    #expect(messages.count == 2)
    guard case .connection(let connection) = messages[0], case .vault(let request) = messages[1] else {
      Issue.record("Expected one handshake and one vault request")
      return
    }
    #expect(connection.origin.absoluteString == "http://127.0.0.1:49218")
    if case .load = request.operation {} else { Issue.record("Expected load") }
    #expect(throws: NativeHostChannelError.self) { try decoder.append(handshake + Data([10])) }
    #expect(throws: NativeHostChannelError.self) { try decoder.append(requestFrame() + Data([10])) }
  }

  @Test func rejectsInvalidMethodsExtraPayloadFieldsVersionsAndOversizeFrames() throws {
    for frame in [
      try requestFrame("exec"), try requestFrame(payload: ["interactive": true]),
      try requestFrame(id: "invalid"), try requestFrame("vault.clear"),
      Data(#"{"hostBridge":true,"id":"00000000-0000-0000-0000-000000000000","method":"vault.load","payload":{}}"#.utf8),
      Data(#"{"hostBridge":2,"id":"00000000-0000-0000-0000-000000000000","method":"vault.load","payload":{}}"#.utf8),
      Data("private-fixture-invalid".utf8), Data(repeating: 120, count: 16 * 1024 + 1),
    ] {
      #expect(throws: NativeHostChannelError.self) { try NativeVaultRequest(frame: frame) }
    }
    var decoder = NativeHostOutputDecoder()
    #expect(throws: NativeHostChannelError.self) { try decoder.append(Data(repeating: 120, count: 16 * 1024 + 1)) }
    var flooding = NativeHostOutputDecoder()
    let frames = try (0..<33).reduce(try handshakeFrame() + Data([10])) { value, _ in
      value + (try requestFrame()) + Data([10])
    }
    #expect(throws: NativeHostChannelError.self) { try flooding.append(frames) }
  }

  @Test func unconfiguredVaultFailsClosedAndRejectsReplayAndClosedGeneration() async throws {
    let server = NativeVaultServer(vault: nil)
    let request = try NativeVaultRequest(frame: requestFrame("vault.create"))
    let reply = try await server.reply(to: request)
    let value = try #require(JSONSerialization.jsonObject(with: reply) as? [String: Any])
    #expect(value["error"] as? String == "unconfigured")
    #expect(value["ok"] as? Bool == false)
    #expect(value["value"] == nil)
    await #expect(throws: NativeHostChannelError.self) { try await server.reply(to: request) }
    await server.close()
    await #expect(throws: NativeHostChannelError.self) {
      try await server.reply(to: NativeVaultRequest(frame: requestFrame()))
    }
  }

  @Test(.enabled(if: ProcessInfo.processInfo.environment["CRAFT_HUB_TEST_NODE"] != nil))
  func realNodeClientExchangesIdentityOnlyOverPrivatePipesWithAnIsolatedKeychain() async throws {
    let fixture = try FixtureKeychain()
    let profile = fixture.root.appendingPathComponent("profile")
    let vault = try KeychainDeviceVault(
      profile: profile, endpoint: URL(string: "https://api.example.com")!,
      webOrigin: URL(string: "https://cloud.example.com")!, keychain: fixture.keychain)
    let child = Process()
    child.executableURL = URL(fileURLWithPath: try #require(ProcessInfo.processInfo.environment["CRAFT_HUB_TEST_NODE"]))
    let apps = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
      .deletingLastPathComponent().deletingLastPathComponent()
    let module = apps.appendingPathComponent("desktop/src/native-host-channel.ts")
    child.environment = [
      "PATH": "/usr/bin:/bin", "HOME": fixture.root.path,
      "CRAFT_HUB_CHANNEL_FIXTURE_MODULE": module.absoluteString,
      "CRAFT_HUB_CLOUD_FIXTURE_MODULE": apps.appendingPathComponent("desktop/test/fixtures/native-cloud-pipe.ts")
        .absoluteString,
      "CRAFT_HUB_CLOUD_FIXTURE_PROFILE": profile.path,
    ]
    child.arguments = [
      "--input-type=module", "-e",
      """
      import {sign,verify} from 'node:crypto';
      const token='a'.repeat(64);
      process.stdout.write(JSON.stringify({version:1,url:`http://127.0.0.1:43219/__craft_hub_host/bootstrap?token=${token}`,nativeApiToken:token})+'\\n');
      const {NativeHostChannel,NativeDeviceVault}=await import(process.env.CRAFT_HUB_CHANNEL_FIXTURE_MODULE);
      const channel=new NativeHostChannel(process.stdin,process.stdout,5000);
      try {
        const vault=new NativeDeviceVault(channel);
        if(await vault.load()!==undefined)throw Error();
        const identity=await vault.loadOrCreate();
        const data=Buffer.from('native-pipe-fixture');
        if(!verify(null,data,identity.publicKey,sign(null,data,identity.privateKey)))throw Error();
        const registered=await vault.register(identity,'fixture-device');
        if(registered.deviceId!=='fixture-device')throw Error();
        if((await vault.load())?.deviceId!=='fixture-device')throw Error();
        await vault.clear();
        if(await vault.load()!==undefined)throw Error();
        const {existsSync}=await import('node:fs');
        if(existsSync(process.env.CRAFT_HUB_CLOUD_FIXTURE_PROFILE))throw Error();
        const {verifyNativeCloudPipeline}=await import(process.env.CRAFT_HUB_CLOUD_FIXTURE_MODULE);
        await verifyNativeCloudPipeline(vault,process.env.CRAFT_HUB_CLOUD_FIXTURE_PROFILE);
      } catch { process.exitCode=1; }
      finally {channel.close();process.stdin.pause();}
      """,
    ]
    let input = Pipe()
    let output = Pipe()
    child.standardInput = input
    child.standardOutput = output
    child.standardError = FileHandle.nullDevice
    let channel = try NativeRuntimeChannel(input: input.fileHandleForWriting, vault: vault) {
      if child.isRunning { kill(child.processIdentifier, SIGKILL) }
    }
    try child.run()
    let timeout = DispatchWorkItem { if child.isRunning { kill(child.processIdentifier, SIGKILL) } }
    DispatchQueue.global().asyncAfter(deadline: .now() + 15, execute: timeout)
    defer {
      timeout.cancel()
      try? input.fileHandleForWriting.close()
      try? output.fileHandleForReading.close()
      if child.isRunning { kill(child.processIdentifier, SIGKILL) }
      child.waitUntilExit()
    }
    var connections = 0
    while true {
      let bytes = await readFixturePipe(output.fileHandleForReading)
      if bytes.isEmpty { break }
      if try channel.accept(bytes) != nil { connections += 1 }
    }
    try await waitForFixtureProcess(child)
    #expect(child.terminationStatus == 0)
    #expect(connections == 1)
    #expect(try await vault.load() == nil)
    #expect(FileManager.default.fileExists(atPath: profile.appendingPathComponent("runtime/projects.json").path))
    await channel.close()
  }
}
