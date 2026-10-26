import Foundation
import Testing

@testable import CraftHubMacCore

@Test func applicationMaintenanceLinksOnlySelectAnApplication() throws {
  for scheme in ["craft-hub", "craft-hub-native"] {
    let parsed = try #require(
      ApplicationMaintenanceLink(url: URL(string: "\(scheme)://software?v=1&bundleId=com.example.Editor")!))
    #expect(parsed.bundleId == "com.example.Editor")
    #expect(ApplicationMaintenanceLink(url: URL(string: "\(scheme)://software?v=1")!)?.bundleId == nil)
  }
  for value in [
    "craft-hub://software?v=1&bundleId=com.example.app&path=/tmp/app",
    "craft-hub://software?v=1&bundleId=com.example.app%0A",
    "craft-hub://software?v=1&bundleId",
    "craft-hub://software?v=1&bundleId=../app",
    "craft-hub://software?v=1&bundleId=com.example.app&bundleId=com.example.other",
    "craft-hub://software?v=2", "craft-hub://software?v=1#execute", "https://software?v=1",
  ] {
    #expect(ApplicationMaintenanceLink(url: URL(string: value)!) == nil)
  }
}

@Test func applicationMaintenanceClientChecksIdentityAndDoesNotSendPaths() async throws {
  let token = String(repeating: "c", count: 64)
  let connection = try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:49218/__craft_hub_host/bootstrap?token=\(token)", "nativeApiToken": token,
    ]))
  let id = String(repeating: "a", count: 64)
  let candidate = String(repeating: "b", count: 64)
  let client = RuntimeAPIClient(connection: connection) { request in
    #expect(request.url?.path == "/api/application-maintenance/\(id)/reveal")
    let input = try JSONDecoder().decode([String: String].self, from: #require(request.httpBody))
    #expect(input == ["candidateId": candidate])
    return (
      Data(#"{"version":1,"destination":"finder"}"#.utf8),
      HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
    )
  }
  try await client.revealMaintainedApplication(id: id, candidate: candidate)
  let mismatched = RuntimeAPIClient(connection: connection) { request in
    let json: [String: Any] = [
      "version": 1,
      "application": [
        "id": "wrong", "bundleId": "com.example.app", "name": "Editor", "path": "/Applications/Editor.app",
      ],
      "candidates": [], "documentation": [], "searchUrl": "https://example.com", "incomplete": false,
    ]
    return (
      try JSONSerialization.data(withJSONObject: json),
      HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
    )
  }
  await #expect(throws: RuntimeAPIError.self) { try await mismatched.applicationUninstallGuidance(id: id) }
}
