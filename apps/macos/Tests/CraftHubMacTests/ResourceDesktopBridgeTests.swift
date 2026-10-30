import AppKit
import CraftHubMacCore
import Foundation
import Security
import Testing

@testable import CraftHubMac

@MainActor private final class ResourceBridgeFixture {
  var requests: [URLRequest] = []
  var readable = true
  var rowPresent = true
  var changedSource = false
  var scopes: [String] = []
  let root = FileManager.default.temporaryDirectory.appendingPathComponent("resource-bridge-\(UUID())")
  let keychain: SecKeychain
  let vault: ResourceCredentialVault
  let bridge: ResourceDesktopBridge
  let context: [String: Any] = ["integrationId": "fixture", "viewId": "accounts", "blockId": "records", "input": [:]]

  init() throws {
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
    var keychain: SecKeychain?
    let password = Array(UUID().uuidString.utf8)
    let keychainPath = root.appendingPathComponent("fixture.keychain").path
    let status = password.withUnsafeBytes {
      SecKeychainCreate(
        keychainPath, UInt32($0.count), $0.baseAddress, false, nil, &keychain)
    }
    guard status == errSecSuccess, let keychain else { throw ResourceCredentialError.unavailable }
    self.keychain = keychain
    vault = ResourceCredentialVault(profile: root, scope: "fixture", keychain: keychain)
    let vault = vault
    bridge = ResourceDesktopBridge(profile: root, makeVault: { _ in vault })
    bridge.isActive = { true }
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
          guard let self else { throw ResourceCredentialError.unavailable }
          return try await self.response(request)
        }))
  }

  func close() {
    bridge.connect(nil)
    SecKeychainDelete(keychain)
    try? FileManager.default.removeItem(at: root)
  }

  func open() async throws -> String {
    let value = try await bridge.perform("open-resource-session", input: context) as! [String: Any]
    return try #require(value["sessionId"] as? String)
  }

  func response(_ request: URLRequest) throws -> (Data, URLResponse) {
    requests.append(request)
    let operation = request.url!.lastPathComponent
    let result: [String: Any]
    if operation == "integrations" {
      result = [
        "integrations": [
          [
            "id": "fixture",
            "actions": [
              [
                "id": "read", "title": "Read", "operation": readable ? "resources.read" : "resources.execute",
                "effect": readable ? "remote-read" : "remote-write",
                "effectiveConfirmation": readable ? "never" : "always",
              ]
            ],
            "views": [
              [
                "id": "accounts", "title": "Accounts", "scope": "global", "rendering": "web",
                "blocks": [["id": "records", "type": "resource-browser", "actionId": "read"]],
              ]
            ],
          ]
        ], "diagnostics": [],
      ]
    } else if operation == "prepare" {
      result = [
        "version": 1, "planId": "reviewed-import", "title": "Import", "effect": "local-write",
        "operation": "resources.update", "requiresConfirmation": true, "expiresAt": "2099-01-01T00:00:00Z",
        "fields": [],
      ]
    } else {
      result = [
        "version": 1, "kind": "resources",
        "resources": [
          "title": "Accounts", "input": ["revision": "fresh"],
          "collection": [
            "columns": [],
            "rows": rowPresent
              ? [["id": "one", "cells": [:], "copyValue": "1000000001", "credentialKey": "account-one"]] : [],
            "selectedIds": [], "selectionInput": "selectedIds", "filterFormId": "filter", "hiddenFormIds": [],
            "hiddenDocumentIds": [],
          ],
          "forms": [["id": "import", "title": "Import", "effect": "update", "fields": []]],
          "browserImport": [
            "id": "accounts", "title": "Import Accounts",
            "url": changedSource ? "https://other.example.com/list" : "https://accounts.example.com/list",
            "allowedOrigins": ["https://accounts.example.com"], "formId": "import",
            "request": ["path": "/api/accounts", "operatorGlobal": "currentUser", "operatorParameter": "user"],
            "response": ["recordsPath": ["accounts"], "successField": "code", "successValue": 0],
            "credentials": [
              "keyField": "username", "secretField": "password", "availableField": "status",
              "publicFields": ["username", "status"],
            ],
          ],
        ],
      ]
    }
    return (
      try JSONSerialization.data(withJSONObject: result),
      HTTPURLResponse(url: request.url!, statusCode: 200, httpVersion: nil, headerFields: nil)!
    )
  }
}

@MainActor @Suite(.serialized) struct ResourceDesktopBridgeTests {
  @Test func grantsOnlyResolvedRowsAndKeepsSecretsOutOfAvailabilityAndRuntimeRequests() async throws {
    let fixture = try ResourceBridgeFixture()
    defer { fixture.close() }
    try await fixture.vault.save("synthetic-password", key: "account-one")
    let grant = try await fixture.bridge.perform("open-resource-session", input: fixture.context) as! [String: Any]
    #expect(grant["availableRowIds"] as? [String] == ["one"])
    #expect(!String(describing: grant).contains("synthetic-password"))
    let id = try #require(grant["sessionId"] as? String)
    let shown =
      try await fixture.bridge.perform(
        "resource-credential", input: ["sessionId": id, "rowId": "one", "operation": "show"]) as! [String: String]
    #expect(shown["value"] == "synthetic-password")
    #expect(
      fixture.requests.allSatisfy {
        !String(decoding: $0.httpBody ?? Data(), as: UTF8.self).contains("synthetic-password")
      })
    await #expect(throws: ResourceCredentialError.self) {
      try await fixture.bridge.perform(
        "resource-credential", input: ["sessionId": id, "rowId": "other", "operation": "show"])
    }
    fixture.rowPresent = false
    await #expect(throws: ResourceCredentialError.self) {
      try await fixture.bridge.perform(
        "resource-credential", input: ["sessionId": id, "rowId": "one", "operation": "show"])
    }
  }

  @Test func rejectsChangedSourcesWriteActionsArbitraryKeysAndExpiredSessions() async throws {
    let fixture = try ResourceBridgeFixture()
    defer { fixture.close() }
    let id = try await fixture.open()
    fixture.changedSource = true
    await #expect(throws: ResourceCredentialError.self) {
      try await fixture.bridge.perform(
        "resource-credential", input: ["sessionId": id, "rowId": "one", "operation": "copy"])
    }
    fixture.changedSource = false
    fixture.bridge.isActive = { false }
    await #expect(throws: ResourceCredentialError.self) {
      try await fixture.bridge.perform(
        "resource-credential", input: ["sessionId": id, "rowId": "one", "operation": "show"])
    }
    fixture.bridge.isActive = { true }
    fixture.bridge.invalidate()
    await #expect(throws: ResourceCredentialError.self) {
      try await fixture.bridge.perform("import-resource-accounts", input: ["sessionId": id])
    }
    fixture.readable = false
    await #expect(throws: ResourceCredentialError.self) { try await fixture.open() }
    fixture.readable = true
    var forged = fixture.context
    forged["credentialKey"] = "arbitrary"
    await #expect(throws: ResourceCredentialError.self) {
      try await fixture.bridge.perform("open-resource-session", input: forged)
    }
  }

  @Test func removingACredentialDeletesOnlyTheResolvedLocalRow() async throws {
    let fixture = try ResourceBridgeFixture()
    defer { fixture.close() }
    try await fixture.vault.save("synthetic-password", key: "account-one")
    try await fixture.vault.save("unrelated-password", key: "unrelated")
    let id = try await fixture.open()
    let result =
      try await fixture.bridge.perform(
        "resource-credential", input: ["sessionId": id, "rowId": "one", "operation": "remove"]) as? [String: Bool]
    #expect(result?["removed"] == true)
    #expect(!(await fixture.vault.contains("account-one")))
    #expect(await fixture.vault.contains("unrelated"))
    #expect(!fixture.requests.contains { ["prepare", "execute"].contains($0.url?.lastPathComponent ?? "") })
  }

  @Test func importsOnlyAfterTheNativeWindowSubmitsAndResumesOnCancellation() async throws {
    let fixture = try ResourceBridgeFixture()
    defer { fixture.close() }
    let id = try await fixture.open()
    let pending = Task { try await fixture.bridge.perform("import-resource-accounts", input: ["sessionId": id]) }
    for _ in 0..<100 where fixture.bridge.importRequest == nil { try await Task.sleep(for: .milliseconds(5)) }
    let request = try #require(fixture.bridge.importRequest)
    #expect(!fixture.requests.contains { $0.url?.lastPathComponent == "execute" })
    #expect(await fixture.bridge.saveImport(request, metadata: "{\"records\":[]}"))
    fixture.bridge.closeImport()
    #expect((try await pending.value as? [String: Bool])?["imported"] == true)
    let execute = try #require(fixture.requests.first { $0.url?.lastPathComponent == "execute" })
    let body = try JSONSerialization.jsonObject(with: execute.httpBody!) as! [String: Any]
    #expect(body["confirmed"] as? Bool == true)
    let cancelled = Task { try await fixture.bridge.perform("import-resource-accounts", input: ["sessionId": id]) }
    for _ in 0..<100 where fixture.bridge.importRequest == nil { try await Task.sleep(for: .milliseconds(5)) }
    fixture.bridge.invalidate()
    #expect((try await cancelled.value as? [String: Bool])?["imported"] == false)
  }
}
