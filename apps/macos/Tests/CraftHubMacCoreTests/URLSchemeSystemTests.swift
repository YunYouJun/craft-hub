import AppKit
import CoreServices
import Foundation
import Testing

@testable import CraftHubMacCore

private func linkSystemCommand(_ executable: String, _ arguments: [String]) throws {
  let process = Process()
  process.executableURL = URL(fileURLWithPath: executable)
  process.arguments = arguments
  process.standardOutput = FileHandle.nullDevice
  process.standardError = FileHandle.nullDevice
  try process.run()
  process.waitUntilExit()
  guard process.terminationStatus == 0 else { throw LinkHandoverError.invalidApplication }
}

/// Only private, unique fixture schemes are registered. Never changes or opens the public Craft Hub URL.
@MainActor @Test(.enabled(if: ProcessInfo.processInfo.environment["CRAFT_HUB_TEST_LINK_HANDOVER"] == "1"))
func privateSchemeSystemHandoverAndRollback() async throws {
  let workspace = NSWorkspace.shared
  let publicURL = URL(string: "craft-hub://open")!
  let publicBefore = workspace.urlForApplication(toOpen: publicURL)
  let id = UUID().uuidString.lowercased()
  let scheme = "craft-hub-test-\(id)"
  // Launch Services marks bundles under temporary directories as launch-disabled and ignores them
  // as default handlers. Use a unique build fixture, never an installed application directory.
  let root = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent()
    .deletingLastPathComponent().appendingPathComponent("build/\(scheme)")
  let applications = ["Previous", "Candidate"].map { root.appendingPathComponent("\($0).app") }
  try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
  let fixtureSource = root.appendingPathComponent("fixture.c")
  try Data("int main(void) { return 0; }\n".utf8).write(to: fixtureSource)
  let unregister =
    "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
  defer {
    for application in applications { try? linkSystemCommand(unregister, ["-u", application.path]) }
    try? FileManager.default.removeItem(at: root)
    #expect(workspace.urlForApplication(toOpen: publicURL) == publicBefore)
  }
  for (index, application) in applications.enumerated() {
    let binary = application.appendingPathComponent("Contents/MacOS/Fixture")
    try FileManager.default.createDirectory(at: binary.deletingLastPathComponent(), withIntermediateDirectories: true)
    try linkSystemCommand("/usr/bin/clang", ["-mmacosx-version-min=15.0", fixtureSource.path, "-o", binary.path])
    let info: [String: Any] = [
      "CFBundleIdentifier": "dev.craft-hub.link-test.\(id).\(index)",
      "CFBundleName": "Link Fixture \(index)", "CFBundleExecutable": "Fixture", "CFBundlePackageType": "APPL",
      "CFBundleVersion": "1", "CFBundleURLTypes": [["CFBundleURLSchemes": [scheme], "CFBundleTypeRole": "Viewer"]],
    ]
    try PropertyListSerialization.data(fromPropertyList: info, format: .xml, options: 0)
      .write(to: application.appendingPathComponent("Contents/Info.plist"))
    try linkSystemCommand("/usr/bin/codesign", ["--force", "--sign", "-", application.path])
    #expect(LSRegisterURL(application as CFURL, true) == noErr)
  }
  let registry = WorkspaceURLSchemeRegistry()
  let previous = try registry.inspect(applications[0], scheme: scheme)
  try await registry.set(previous, scheme: scheme)
  // Registration of newly created fixture bundles is asynchronous in Launch Services.
  for _ in 0..<50 {
    if try registry.current(scheme) == previous { break }
    try await Task.sleep(for: .milliseconds(100))
  }
  #expect(try registry.current(scheme) == previous)
  let service = URLSchemeHandover(
    scheme: scheme, application: applications[1],
    store: LinkHandoverStore(root: root.appendingPathComponent("receipt")),
    enabled: true, registry: registry)
  let review = try service.review(.adopt)
  #expect(review.current == previous && review.desired.path == applications[1].path)
  try await service.apply(review)
  #expect(try registry.current(scheme) == review.desired)
  try await service.apply(service.review(.restore))
  #expect(try registry.current(scheme) == previous)
  #expect(workspace.urlForApplication(toOpen: publicURL) == publicBefore)
}
