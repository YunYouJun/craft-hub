import Foundation
import Testing

@testable import CraftHubMacCore

@Test func privateWriterHandlesBrokenPipesWithoutSIGPIPEAndNeverReusesAClosedDescriptor() async throws {
  let pipe = Pipe()
  let writer = try NativePipeWriter(handle: pipe.fileHandleForWriting)
  try pipe.fileHandleForReading.close()
  await #expect(throws: NativeHostChannelError.self) { try await writer.send(Data("fixture\n".utf8)) }
  await writer.close()
  let other = Pipe()
  await #expect(throws: NativeHostChannelError.self) { try await writer.send(Data("must-not-write\n".utf8)) }
  try other.fileHandleForWriting.close()
  #expect(other.fileHandleForReading.availableData.isEmpty)
}

@Test func privateWriterBoundsStalledReadersAndPreservesFrameOrder() async throws {
  let pipe = Pipe()
  let writer = try NativePipeWriter(handle: pipe.fileHandleForWriting)
  try await writer.send(Data("first\n".utf8))
  try await writer.send(Data("second\n".utf8))
  #expect(pipe.fileHandleForReading.availableData == Data("first\nsecond\n".utf8))
  let started = ContinuousClock.now
  var failed = false
  // A reader that stops consuming cannot block the actor or main thread indefinitely.
  for _ in 0..<128 {
    do { try await writer.send(Data(repeating: 1, count: 16384)) } catch {
      failed = true
      break
    }
  }
  #expect(failed && started.duration(to: .now) < .seconds(5))
  await writer.close()
}

@Test func nativeCloudConfigurationForwardsOnlyCanonicalOrigins() throws {
  #expect(try NativeCloudConfiguration.resolve([:]) == nil)
  let config = try #require(
    try NativeCloudConfiguration.resolve([
      "CRAFT_HUB_CLOUD_ENDPOINT": "https://API.example.com:443/", "CRAFT_HUB_CLOUD_ORIGIN": "http://127.0.0.1:4321/",
    ]))
  #expect(config.endpoint.absoluteString == "https://api.example.com")
  #expect(config.webOrigin.absoluteString == "http://127.0.0.1:4321")
  for value in [
    "http://example.com", "https://user:secret@example.com", "https://example.com/path",
    "https://example.com?key=secret", "https://example.com\\path", "https://example.com\n",
  ] {
    #expect(throws: DeviceVaultError.self) {
      try NativeCloudConfiguration.resolve([
        "CRAFT_HUB_CLOUD_ENDPOINT": value, "CRAFT_HUB_CLOUD_ORIGIN": "https://example.com",
      ])
    }
  }
}
