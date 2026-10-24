import Darwin
import Foundation
import Testing

@testable import CraftHubMacCore

private func withProbeScript<T>(_ body: String, _ run: (String) throws -> T) throws -> T {
  let directory = FileManager.default.temporaryDirectory.appendingPathComponent("craft-hub-probe-\(UUID().uuidString)")
  try FileManager.default.createDirectory(
    at: directory, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
  defer { try? FileManager.default.removeItem(at: directory) }
  let script = directory.appendingPathComponent("node")
  try Data(("#!/bin/sh\n" + body).utf8).write(to: script)
  try FileManager.default.setAttributes([.posixPermissions: 0o700], ofItemAtPath: script.path)
  return try run(script.path)
}

@Test func nodeProbeReadsVersionAndArchitectureWithTheFixedArgumentsAndEnvironment() throws {
  try withProbeScript(
    """
    [ "$1" = '--eval' ] || exit 1
    [ "$PATH" = '/usr/bin:/bin' ] || exit 2
    [ -z "$NODE_OPTIONS$NODE_PATH$HOME" ] || exit 3
    printf '{"version":"v24.11.0","arch":"arm64"}'
    """
  ) { path in
    #expect(
      NodeRuntimeInfo.inspect(path)
        == .success(NodeRuntimeInfo(version: NodeVersion("v24.11.0")!, architecture: "arm64")))
  }
}

@Test func nodeProbeRejectsNonzeroExitEvenWhenItsOutputLooksValid() throws {
  try withProbeScript("printf '{\"version\":\"v24.11.0\",\"arch\":\"arm64\"}'; exit 7") { path in
    #expect(NodeRuntimeInfo.inspect(path) == .failure(.unsuccessfulExit))
  }
}

@Test func nodeProbeKillsAndReapsAnExecutableThatIgnoresTermination() throws {
  try withProbeScript("printf '%s' \"$$\" > \"$0.pid\"\ntrap '' TERM\nwhile :; do :; done") { path in
    let start = ProcessInfo.processInfo.systemUptime
    #expect(NodeRuntimeInfo.inspect(path, timeout: 2) == .failure(.timedOut))
    #expect(ProcessInfo.processInfo.systemUptime - start < 5)
    let pid = try #require(pid_t(String(contentsOfFile: path + ".pid", encoding: .utf8)))
    #expect(kill(pid, 0) == -1 && errno == ESRCH)
    var status: Int32 = 0
    #expect(waitpid(pid, &status, WNOHANG) == -1 && errno == ECHILD)
  }
}

@Test func nodeProbeBoundsFloodedOutputAndCleansUpTheWriter() throws {
  try withProbeScript("printf '%s' \"$$\" > \"$0.pid\"\nwhile :; do printf '0123456789'; done") { path in
    #expect(NodeRuntimeInfo.inspect(path) == .failure(.outputLimit))
    let pid = try #require(pid_t(String(contentsOfFile: path + ".pid", encoding: .utf8)))
    #expect(kill(pid, 0) == -1 && errno == ESRCH)
  }
}

@Test func nodeProbeDoesNotWaitForADescendantToCloseItsOutputPipe() throws {
  try withProbeScript(
    """
    /bin/sleep 30 &
    printf '%s' "$!" > "$0.child"
    printf '{"version":"v26.0.0","arch":"x64"}'
    """
  ) { path in
    let start = ProcessInfo.processInfo.systemUptime
    #expect(
      NodeRuntimeInfo.inspect(path) == .success(NodeRuntimeInfo(version: NodeVersion("v26.0.0")!, architecture: "x64")))
    // The probe allows 3 seconds, including cold process startup under concurrent test load.
    // Returning successfully within this bound proves it did not wait for the inherited 30-second pipe.
    #expect(ProcessInfo.processInfo.systemUptime - start < 5)
    let pid = try #require(pid_t(String(contentsOfFile: path + ".child", encoding: .utf8)))
    let deadline = ProcessInfo.processInfo.systemUptime + 1
    while kill(pid, 0) == 0 && ProcessInfo.processInfo.systemUptime < deadline { usleep(10_000) }
    #expect(kill(pid, 0) == -1 && errno == ESRCH)
  }
}

@Test func nodeProbeRejectsInvalidJSONAndNonAbsolutePaths() throws {
  #expect(NodeRuntimeInfo.inspect("node") == .failure(.invalidInput))
  try withProbeScript("printf 'unexpected output'") { path in
    #expect(NodeRuntimeInfo.inspect(path) == .failure(.invalidResponse))
  }
}

@Test func nodeSelectionRejectsArchitectureMismatchAndExplainsItsFallback() {
  var inspected: [String] = []
  let locator = NodeLocator(
    home: "/Users/developer", environment: ["PATH": "/wrong:/right"], listDirectory: { _ in [] },
    isExecutable: { ["/wrong/node", "/right/node"].contains($0) }, architecture: "arm64",
    inspect: { path in
      inspected.append(path)
      return .success(
        NodeRuntimeInfo(version: NodeVersion("v24.11.0")!, architecture: path == "/wrong/node" ? "x64" : "arm64"))
    })
  let result = locator.resolveWithDiagnostics(explicitPath: "/wrong/node")
  #expect(result.node?.path == "/right/node")
  #expect(result.node?.architecture == "arm64")
  #expect(result.rejectedPreference?.reason == .architectureMismatch(found: "x64", expected: "arm64"))
  #expect(inspected == ["/wrong/node", "/right/node"])
}

@Test func nodeSelectionExplainsMissingUnsupportedAndFailedPreferences() {
  let version = NodeVersion("v20.19.0")!
  let locator = NodeLocator(
    home: "/Users/developer", environment: [:], listDirectory: { _ in [] },
    isExecutable: { ["/old/node", "/stalled/node"].contains($0) },
    inspect: { path in
      path == "/old/node" ? .success(NodeRuntimeInfo(version: version)) : .failure(.timedOut)
    })
  #expect(locator.resolveWithDiagnostics(explicitPath: "relative/node").rejectedPreference?.reason == .invalidPath)
  #expect(
    locator.resolveWithDiagnostics(explicitPath: "/deleted/node").rejectedPreference?.reason == .missingExecutable)
  #expect(
    locator.resolveWithDiagnostics(explicitPath: "/old/node").rejectedPreference?.reason
      == .unsupportedVersion("v20.19.0"))
  #expect(locator.resolveWithDiagnostics(explicitPath: "/stalled/node").rejectedPreference?.reason == .probe(.timedOut))
}

@Test(.enabled(if: ProcessInfo.processInfo.environment["CRAFT_HUB_TEST_NODE"] != nil))
func nodeProbeInspectsARealNodeExecutable() throws {
  let path = try #require(ProcessInfo.processInfo.environment["CRAFT_HUB_TEST_NODE"])
  let info = try NodeRuntimeInfo.inspect(path).get()
  #expect(info.version.isSupportedByRuntime)
  #expect(info.architecture == NodeRuntimeInfo.hostArchitecture)
}
