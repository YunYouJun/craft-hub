import Testing

@testable import CraftHubMacCore

@Test func parsesNodeVersionsAndMatchesTheRuntimeRange() {
  #expect(NodeVersion("v24.11.0\n") == NodeVersion(major: 24, minor: 11, patch: 0))
  #expect(NodeVersion("24.11.0") == nil)
  #expect(NodeVersion("v24.11") == nil)
  let supported = ["v22.18.0", "v24.11.0", "v24.18.0", "v26.0.0"]
  let unsupported = ["v20.19.0", "v22.17.9", "v23.11.0", "v24.10.0", "v25.2.1", "v27.1.0"]
  #expect(supported.allSatisfy { NodeVersion($0)!.isSupportedByRuntime })
  #expect(unsupported.allSatisfy { !NodeVersion($0)!.isSupportedByRuntime })
}

@Test func searchesPathCommonDirectoriesAndFnmLikeTheElectronHost() {
  let locator = NodeLocator(
    home: "/Users/me",
    environment: ["PATH": "/custom/bin:relative/bin:/usr/bin", "FNM_DIR": "/opt/fnm"],
    listDirectory: { path in path == "/opt/fnm/node-versions" ? ["v22.18.0", "v24.11.0", "notes"] : [] },
    isExecutable: { _ in false },
    inspect: { _ in .failure(.invalidResponse) }
  )
  #expect(
    locator.candidateDirectories() == [
      "/custom/bin",
      "/usr/bin",
      "/Users/me/.local/bin",
      "/opt/homebrew/bin",
      "/usr/local/bin",
      "/bin",
      "/Users/me/Library/pnpm",
      "/opt/fnm/aliases/default/bin",
      "/opt/fnm/node-versions/v24.11.0/installation/bin",
      "/opt/fnm/node-versions/v22.18.0/installation/bin",
      "/Users/me/Library/Application Support/fnm/aliases/default/bin",
      "/Users/me/.local/share/fnm/aliases/default/bin",
      "/Users/me/.fnm/aliases/default/bin",
    ])
}

@Test func prefersACompatibleExplicitPathAndSkipsIncompatibleNodes() {
  let versions = [
    "/chosen/node": "v24.12.0",
    "/old/node": "v20.19.0",
    "/opt/homebrew/bin/node": "v23.0.0",
    "/usr/local/bin/node": "v22.20.0",
  ]
  let locator = NodeLocator(
    home: "/Users/me",
    environment: [:],
    listDirectory: { _ in [] },
    isExecutable: { versions[$0] != nil },
    inspect: { path in
      versions[path].flatMap(NodeVersion.init).map { .success(NodeRuntimeInfo(version: $0)) }
        ?? .failure(.invalidResponse)
    }
  )
  #expect(
    locator.resolve(explicitPath: "/chosen/node")
      == ResolvedNode(path: "/chosen/node", version: NodeVersion(major: 24, minor: 12, patch: 0), explicit: true))
  // An incompatible explicit choice falls back to the machine search, which skips Node 23.
  #expect(
    locator.resolve(explicitPath: "/old/node")
      == ResolvedNode(
        path: "/usr/local/bin/node", version: NodeVersion(major: 22, minor: 20, patch: 0), explicit: false))
}

@Test func reportsNoNodeWhenNothingCompatibleExists() {
  let locator = NodeLocator(
    home: "/Users/me", environment: [:], listDirectory: { _ in [] }, isExecutable: { _ in true },
    inspect: { _ in .success(NodeRuntimeInfo(version: NodeVersion(major: 20, minor: 0, patch: 0))) })
  #expect(locator.resolve(explicitPath: nil) == nil)
}
