import CraftHubMacCore
import Foundation
import Testing

@testable import CraftHubMac

@MainActor private final class ConnectionBrowserFixture {
  let bridge = ConnectionBrowserBridge()
  var requests: [URLRequest] = []
  var writable = true
  var rejectSave = false

  init() throws {
    let token = String(repeating: "a", count: 64)
    let connection = try RuntimeConnection(
      handshake: JSONSerialization.data(withJSONObject: [
        "version": 1, "url": "http://127.0.0.1:43219/__craft_hub_host/bootstrap?token=\(token)",
        "nativeApiToken": token,
      ]))
    bridge.connect(
      RuntimeAPIClient(
        connection: connection,
        transport: { [weak self] request in
          guard let self else { throw ConnectionBrowserError.unavailable }
          self.requests.append(request)
          let result: [String: Any]
          let action = request.url!.lastPathComponent
          if action == "integrations" {
            result = [
              "integrations": [
                [
                  "id": "fixture",
                  "actions": [
                    [
                      "id": "status", "title": "Status", "operation": "connection.status", "effect": "remote-read",
                      "effectiveConfirmation": "never",
                    ],
                    [
                      "id": "connect", "title": "Connect", "operation": "connection.update",
                      "effect": self.writable ? "local-write" : "remote-write", "effectiveConfirmation": "always",
                    ],
                  ],
                  "views": [
                    [
                      "id": "notes", "title": "Notes", "scope": "global",
                      "blocks": [["id": "status", "type": "connection-status", "actionId": "status"]],
                    ]
                  ],
                ]
              ], "diagnostics": [],
            ]
          } else if action == "status" {
            result = [
              "version": 1, "kind": "connection",
              "connection": [
                "connected": false, "reviewRevision": "reviewed-connection",
                "forms": [
                  [
                    "id": "cookie", "title": "Connect", "submitLabel": "Save",
                    "fields": [
                      ["id": "cookie", "label": "Cookie", "type": "password"],
                      ["id": "origin", "label": "Origin", "type": "text", "value": "https://cloud.example.com"],
                    ],
                    "browserAuthorization": [
                      "title": "Sign in", "url": "https://cloud.example.com/notes",
                      "cookieOrigin": "https://cloud.example.com",
                      "allowedOrigins": ["https://cloud.example.com", "https://login.example.com"],
                      "cookieNames": ["userId", "serviceToken"],
                      "requiredCookieGroups": [["userId"], ["serviceToken"]], "cookieField": "cookie",
                      "originField": "origin",
                    ],
                  ]
                ],
              ],
            ]
          } else {
            result =
              self.rejectSave
              ? ["error": "review changed"] : ["version": 1, "kind": "connection", "connection": ["connected": true]]
          }
          return (
            try JSONSerialization.data(withJSONObject: result),
            HTTPURLResponse(
              url: request.url!, statusCode: action == "connect" && self.rejectSave ? 409 : 200, httpVersion: nil,
              headerFields: nil)!
          )
        }))
  }

  func open() async throws -> (ConnectionBrowserBridge.Request, Task<Any, Error>) {
    let task = Task { try await bridge.open(["integrationId": "fixture", "formId": "cookie"]) }
    let deadline = Date().addingTimeInterval(3)
    while bridge.request == nil && Date() < deadline { await Task.yield() }
    return (try #require(bridge.request), task)
  }
}

@MainActor struct ConnectionBrowserBridgeTests {
  @Test func savesOnlyToTheReviewedNativeConnectionAndReturnsNoCredentialsToWebContent() async throws {
    let fixture = try ConnectionBrowserFixture()
    defer { fixture.bridge.invalidate() }
    let (request, pending) = try await fixture.open()
    #expect(await fixture.bridge.save(request, cookie: "userId=1001; serviceToken=synthetic-session"))
    let result = try await pending.value as! [String: Bool]
    #expect(result == ["connected": true])
    let sent = try #require(fixture.requests.last?.httpBody)
    let body = try JSONSerialization.jsonObject(with: sent) as! [String: Any]
    #expect(body["reviewedConnection"] as? String == "reviewed-connection")
    #expect(body["confirmed"] as? Bool == true)
    #expect((body["input"] as? [String: String])?["cookie"] == "userId=1001; serviceToken=synthetic-session")
    #expect(fixture.bridge.request == nil)
  }

  @Test func cancellationResolvesTheCallerAndRejectsAnyLateCookieSubmission() async throws {
    let fixture = try ConnectionBrowserFixture()
    let (request, pending) = try await fixture.open()
    fixture.bridge.invalidate()
    #expect(try await pending.value as! [String: Bool] == ["connected": false])
    #expect(!(await fixture.bridge.save(request, cookie: "must-not-send")))
    #expect(!fixture.requests.contains(where: { $0.url?.lastPathComponent == "connect" }))
  }

  @Test func changedReviewsKeepTheWindowOpenAndInvalidActionsCannotStartSignIn() async throws {
    let fixture = try ConnectionBrowserFixture()
    defer { fixture.bridge.invalidate() }
    let (request, pending) = try await fixture.open()
    fixture.rejectSave = true
    #expect(!(await fixture.bridge.save(request, cookie: "synthetic-session")))
    #expect(fixture.bridge.request?.id == request.id)
    fixture.bridge.invalidate()
    _ = try await pending.value
    fixture.writable = false
    await #expect(throws: ConnectionBrowserError.self) {
      try await fixture.bridge.open(["integrationId": "fixture", "formId": "cookie"])
    }
    await #expect(throws: ConnectionBrowserError.self) {
      try await fixture.bridge.open([
        "integrationId": "fixture", "formId": "cookie", "cookieOrigin": "https://evil.example",
      ])
    }
  }
}
