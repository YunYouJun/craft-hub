import Foundation
import Testing

@testable import CraftHubMacCore

private actor DetailsContractFixture {
  var requests: [String] = []
  var registered = true
  var duplicate = false
  var missingDiagnostics = false
  let projectID: String
  init(_ projectID: String = "fixture") { self.projectID = projectID }
  func unregister() { registered = false }
  func duplicateIDs() { duplicate = true }
  func omitDiagnostics() { missingDiagnostics = true }
  func receive(_ request: URLRequest) throws -> (Data, URLResponse) {
    #expect(request.httpMethod == nil || request.httpMethod == "GET")
    #expect(request.httpBody == nil && request.value(forHTTPHeaderField: "Cookie") == nil)
    #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer \(String(repeating: "b", count: 64))")
    let path = URLComponents(url: request.url!, resolvingAgainstBaseURL: false)!.percentEncodedPath
    requests.append(path)
    let value: [String: Any]
    if path == "/api/projects" {
      value = [
        "projects": registered ? [["id": projectID, "name": "Fixture", "path": "/fixture", "trust": "untrusted"]] : [],
        "diagnostics": [],
      ]
    } else {
      #expect(path == "/api/projects/\(try RuntimeAPIClient.segment(projectID))/capability-discovery")
      let package: [String: Any] = [
        "relativePath": ".", "root": true, "name": "Fixture", "description": "Plugin-backed project",
      ]
      var body: [String: Any] = [
        "capabilities": [
          [
            "id": "plugin:inspect", "kind": "command", "name": "Inspect", "source": "fixture-plugin",
            "package": package, "invocation": ["command": "fixture", "args": [], "cwd": "/fixture", "requiredEnv": []],
          ],
          [
            "id": duplicate ? "plugin:inspect" : "future:view", "kind": "future-kind", "name": "Future",
            "source": "future-plugin",
          ],
        ],
        "packages": [package],
      ]
      if !missingDiagnostics {
        body["diagnostics"] = [
          ["source": "plugin", "path": "/fixture/.craft-hub/project.jsonc", "message": "One provider unavailable"]
        ]
      }
      value = body
    }
    return (
      try JSONSerialization.data(withJSONObject: value),
      HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
    )
  }
}

private func detailsConnection() throws -> RuntimeConnection {
  try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1,
      "url": "http://127.0.0.1:49218/__craft_hub_host/bootstrap?token=\(String(repeating: "a", count: 64))",
      "nativeApiToken": String(repeating: "b", count: 64),
    ]))
}

@Test func nativeProjectDetailsUsePublicReadsAndPreservePluginDataWithoutTrustOrExecution() async throws {
  let fixture = DetailsContractFixture("project one/child")
  let client = RuntimeAPIClient(connection: try detailsConnection(), transport: { try await fixture.receive($0) })
  let value = try await client.projectDetails(projectID: "project one/child")
  #expect(value.project.trust == "untrusted")
  #expect(value.discovery.capabilities.first?.source == "fixture-plugin")
  #expect(value.discovery.capabilities.first?.packagePath == ".")
  #expect(value.discovery.capabilities.first?.supportsReview == true)
  #expect(value.discovery.capabilities.last?.kind == "future-kind")
  #expect(value.discovery.capabilities.last?.supportsReview == false)
  #expect(value.discovery.diagnostics.first?.message == "One provider unavailable")
  #expect(value.discovery.packages.first?.description == "Plugin-backed project")
  #expect(await fixture.requests == ["/api/projects", "/api/projects/project%20one%2Fchild/capability-discovery"])
}

@Test func removedProjectsAndInvalidSelectorsNeverStartDiscovery() async throws {
  let fixture = DetailsContractFixture()
  let client = RuntimeAPIClient(connection: try detailsConnection(), transport: { try await fixture.receive($0) })
  for id in ["", ".", ".."] {
    await #expect(throws: RuntimeAPIError.self) { try await client.projectDetails(projectID: id) }
  }
  #expect(await fixture.requests.isEmpty)
  await fixture.unregister()
  await #expect(throws: RuntimeAPIError.self) { try await client.projectDetails(projectID: "fixture") }
  #expect(await fixture.requests == ["/api/projects"])
}

@Test func malformedDiscoveryNeverBecomesAnEmptySuccessfulProject() async throws {
  for duplicate in [true, false] {
    let fixture = DetailsContractFixture()
    if duplicate { await fixture.duplicateIDs() } else { await fixture.omitDiagnostics() }
    let client = RuntimeAPIClient(connection: try detailsConnection(), transport: { try await fixture.receive($0) })
    await #expect(throws: (any Error).self) { try await client.projectDetails(projectID: "fixture") }
  }
}
