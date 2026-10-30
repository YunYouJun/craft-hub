import Foundation
import Testing

@testable import CraftHubMacCore

private actor ProjectTerminalContractFixture {
  var requests: [URLRequest] = []
  var applications = ["Terminal", "Ghostty", "iTerm"]
  var version = 1
  var wrongReceipt = false
  func configure(applications: [String], version: Int = 1) {
    self.applications = applications
    self.version = version
  }
  func mismatchReceipt() { wrongReceipt = true }
  func receive(_ request: URLRequest) throws -> (Data, URLResponse) {
    requests.append(request)
    #expect(request.value(forHTTPHeaderField: "Cookie") == nil)
    #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer \(String(repeating: "b", count: 64))")
    let value: [String: Any]
    if request.url!.path == "/api/native-host/terminal-applications" {
      #expect((request.httpMethod ?? "GET") == "GET" && request.httpBody == nil)
      value = ["version": version, "applications": applications]
    } else {
      #expect(request.url!.path == "/api/native-host/open-project-terminal" && request.httpMethod == "POST")
      let body = try JSONSerialization.jsonObject(with: request.httpBody!) as! [String: String]
      value = [
        "version": version, "destination": "terminal", "application": wrongReceipt ? "Wrong" : body["application"]!,
      ]
    }
    return (
      try JSONSerialization.data(withJSONObject: value),
      HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
    )
  }
}

private func projectTerminalClient(_ fixture: ProjectTerminalContractFixture) throws -> RuntimeAPIClient {
  let secret = String(repeating: "b", count: 64)
  let connection = try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:49218/__craft_hub_host/bootstrap?token=\(secret)",
      "nativeApiToken": secret,
    ]))
  return RuntimeAPIClient(connection: connection, transport: { try await fixture.receive($0) })
}

@Test func externalTerminalUsesAuthenticatedNativeContractsAndOnlyRegisteredIdentifiers() async throws {
  let fixture = ProjectTerminalContractFixture()
  let client = try projectTerminalClient(fixture)
  #expect(try await client.projectTerminalApplications() == ["Terminal", "Ghostty", "iTerm"])
  _ = try await client.openProjectTerminal(projectID: "project one/child", application: "Ghostty")
  _ = try await client.openProjectTerminal(
    projectID: "project one/child", application: "iTerm", capabilityID: "package:build")
  let requests = await fixture.requests
  let rootBody = try JSONSerialization.jsonObject(with: requests[1].httpBody!) as! [String: String]
  let commandBody = try JSONSerialization.jsonObject(with: requests[2].httpBody!) as! [String: String]
  #expect(rootBody == ["projectId": "project one/child", "application": "Ghostty"])
  #expect(commandBody == ["projectId": "project one/child", "application": "iTerm", "capabilityId": "package:build"])
  #expect(requests.allSatisfy { $0.url!.path.hasPrefix("/api/native-host/") && $0.url!.query == nil })
}

@Test func externalTerminalRejectsMalformedCatalogsAndMismatchedReceipts() async throws {
  for (applications, version) in [(["Terminal", "Terminal"], 1), (["Terminal\n"], 1), ([""], 1), (["Terminal"], 2)] {
    let fixture = ProjectTerminalContractFixture()
    await fixture.configure(applications: applications, version: version)
    let client = try projectTerminalClient(fixture)
    await #expect(throws: RuntimeAPIError.self) { try await client.projectTerminalApplications() }
  }
  let fixture = ProjectTerminalContractFixture()
  await fixture.mismatchReceipt()
  let client = try projectTerminalClient(fixture)
  await #expect(throws: RuntimeAPIError.self) {
    try await client.openProjectTerminal(projectID: "fixture", application: "Terminal")
  }
}

@Test func externalTerminalInvalidSelectorsNeverMakeAnOpenRequest() async throws {
  let fixture = ProjectTerminalContractFixture()
  let client = try projectTerminalClient(fixture)
  for (project, application, capability) in [
    ("", "Terminal", nil), ("fixture", "", nil), ("fixture", "Terminal\0", nil), ("fixture", "Terminal", ""),
  ] {
    await #expect(throws: RuntimeAPIError.self) {
      try await client.openProjectTerminal(projectID: project, application: application, capabilityID: capability)
    }
  }
  #expect(await fixture.requests.isEmpty)
}
