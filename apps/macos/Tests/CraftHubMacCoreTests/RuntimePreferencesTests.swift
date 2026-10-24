import Foundation
import Testing

@testable import CraftHubMacCore

private func preferenceConnection() throws -> RuntimeConnection {
  let token = String(repeating: "a", count: 64)
  return try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": 1, "url": "http://127.0.0.1:41234/__craft_hub_host/bootstrap?token=\(token)", "nativeApiToken": token,
    ]))
}

@Test func nativePreferenceEditsCarryTheCurrentRevisionAndOnlyTheSelectedField() async throws {
  var requests: [URLRequest] = []
  let client = RuntimeAPIClient(connection: try preferenceConnection()) { request in
    requests.append(request)
    return (
      Data(
        #"{"revision":"r1","settings":{"workbench.theme":"dark","workbench.locale":"en","private":"ignored"}}"#.utf8),
      HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
    )
  }
  let result = try await client.updatePreferences(theme: .dark)
  #expect(result.theme == .dark)
  #expect(requests.map(\.httpMethod) == ["GET", "PATCH"])
  #expect(requests.allSatisfy { $0.url?.path == "/api/settings" && $0.value(forHTTPHeaderField: "Cookie") == nil })
  let body = try #require(try JSONSerialization.jsonObject(with: requests[1].httpBody!) as? [String: Any])
  #expect(body["revision"] as? String == "r1")
  #expect(body["settings"] as? [String: String] == ["workbench.theme": "dark"])
}

@Test func nativePreferenceRevisionConflictDoesNotRetryOrOverwriteOtherSettings() async throws {
  var writes = 0
  let client = RuntimeAPIClient(connection: try preferenceConnection()) { request in
    let writing = request.httpMethod == "PATCH"
    if writing { writes += 1 }
    return (
      Data(
        (writing
          ? #"{"error":"Settings changed; reload before saving"}"#
          : #"{"revision":"r1","settings":{"workbench.theme":"system","workbench.locale":"en"}}"#).utf8),
      HTTPURLResponse(url: request.url!, statusCode: writing ? 409 : 200, httpVersion: nil, headerFields: nil)!
    )
  }
  do {
    _ = try await client.updatePreferences(language: .chinese)
    Issue.record("A stale settings revision was accepted")
  } catch RuntimeAPIError.rejected(let status, _) { #expect(status == 409) }
  #expect(writes == 1)
}
