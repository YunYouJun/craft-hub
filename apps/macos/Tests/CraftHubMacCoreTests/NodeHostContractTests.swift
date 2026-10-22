import Foundation
import Testing
@testable import CraftHubMacCore

private struct NodeHostContract: Decodable {
  struct Version: Decodable { let value: String; let supported: Bool }
  struct Search: Decodable {
    let name: String
    let home: String
    let environment: [String: String]
    let directories: [String: [String]]
    let expected: [String]
  }
  let versions: [Version]
  let searches: [Search]

  static func load() throws -> Self {
    // Read the exact fixture used by Vitest; do not maintain a second copy in the Swift package.
    var root = URL(fileURLWithPath: #filePath)
    for _ in 0..<5 { root.deleteLastPathComponent() }
    let data = try Data(contentsOf: root.appendingPathComponent("apps/desktop/test/fixtures/node-host-contract.json"))
    return try JSONDecoder().decode(Self.self, from: data)
  }
}

@Test func nativeNodeCompatibilityMatchesThePublishedRuntimeRange() throws {
  for entry in try NodeHostContract.load().versions {
    #expect((NodeVersion(entry.value)?.isSupportedByRuntime ?? false) == entry.supported, "\(entry.value)")
  }
}

@Test func nativeGUISearchMatchesTheElectronFixtures() throws {
  for entry in try NodeHostContract.load().searches {
    let locator = NodeLocator(home: entry.home, environment: entry.environment,
      listDirectory: { entry.directories[$0] ?? [] }, isExecutable: { _ in false }, readVersion: { _ in nil })
    #expect(locator.candidateDirectories() == entry.expected, "\(entry.name)")
  }
}
