import Foundation
import Security
import Testing

@testable import CraftHubMacCore

struct ResourceBrowserImportTests {
  private func declaration(_ patch: [String: Any] = [:]) throws -> IntegrationResourcePage.BrowserImport {
    var data: [String: Any] = [
      "id": "example", "title": "Import Accounts", "url": "https://accounts.example.com/list",
      "allowedOrigins": ["https://accounts.example.com", "https://login.example.com"], "formId": "import",
      "request": ["path": "/api/accounts", "operatorGlobal": "currentUser", "operatorParameter": "user"],
      "response": ["recordsPath": ["payload", "accounts"], "successField": "code", "successValue": 0],
      "credentials": [
        "keyField": "username", "secretField": "password", "availableField": "status",
        "publicFields": ["username", "id", "status"],
      ],
    ]
    data.merge(patch) { _, next in next }
    return try JSONDecoder().decode(
      IntegrationResourcePage.BrowserImport.self, from: JSONSerialization.data(withJSONObject: data))
  }

  @Test func separatesPasswordsFromRuntimeAndRejectsMalformedOrDuplicateRecords() throws {
    let source = try declaration()
    let batch = try source.prepare([
      [
        "username": "account-one", "id": "1000000001", "status": 1, "password": "synthetic-password",
        "token": "not-public",
      ],
      ["username": "account-two", "id": "1000000002", "status": 0, "password": "inactive-password"],
    ])
    #expect(batch.count == 2)
    #expect(batch.credentials == ["account-one": "synthetic-password"])
    #expect(!batch.metadataJSON.contains("password"))
    #expect(!batch.metadataJSON.contains("not-public"))
    #expect(throws: ResourceCredentialError.self) { try source.prepare([["username": "one", "status": true]]) }
    #expect(throws: ResourceCredentialError.self) {
      try source.prepare([["username": "one", "status": 1], ["username": "ONE", "status": 1]])
    }
    #expect(throws: ResourceCredentialError.self) {
      try source.prepare(Array(repeating: ["username": "one", "status": 1], count: 501))
    }
  }

  @Test func restrictsOriginsRequestsAndSecretProjection() throws {
    let source = try declaration()
    try source.validate()
    #expect(source.allows(URL(string: "https://login.example.com/auth")!))
    #expect(!source.allows(URL(string: "https://accounts.example.com.evil.test/list")!))
    #expect(!source.allows(URL(string: "http://accounts.example.com/list")!))
    #expect(!source.allows(URL(string: "https://accounts.example.com:8443/list")!))
    #expect(!source.isAccountPage(URL(string: "https://accounts.example.com/login")!))
    let bad = try declaration([
      "request": ["path": "//other.example.com/api", "operatorGlobal": "user", "operatorParameter": "user"]
    ])
    #expect(throws: ResourceCredentialError.self) { try bad.validate() }
    let exposed = try declaration([
      "credentials": [
        "keyField": "username", "secretField": "password", "availableField": "status",
        "publicFields": ["username", "status", "password"],
      ]
    ])
    #expect(throws: ResourceCredentialError.self) { try exposed.validate() }
    let duplicate = try declaration([
      "credentials": [
        "keyField": "username", "secretField": "password", "availableField": "status",
        "publicFields": ["username", "status", "status"],
      ]
    ])
    #expect(throws: ResourceCredentialError.self) { try duplicate.validate() }
  }

  @Test func credentialsStayInKeychainAndAreScopedAndExplicitlyRemovable() async throws {
    let fixture = try FixtureKeychain()
    let vault = ResourceCredentialVault(profile: fixture.root, scope: "example:accounts", keychain: fixture.keychain)
    #expect(await !vault.contains("one"))
    try await vault.save("synthetic-password", key: "one")
    #expect(await vault.contains("one"))
    #expect(try await vault.read("one") == "synthetic-password")
    let other = ResourceCredentialVault(profile: fixture.root, scope: "other:accounts", keychain: fixture.keychain)
    #expect(await !other.contains("one"))
    let otherProfile = ResourceCredentialVault(
      profile: fixture.root.appendingPathComponent("other"), scope: "example:accounts", keychain: fixture.keychain)
    #expect(await !otherProfile.contains("one"))
    #expect(SecKeychainLock(fixture.keychain) == errSecSuccess)
    let start = ContinuousClock.now
    #expect(await !vault.contains("one"))
    #expect(start.duration(to: .now) < .seconds(2))
    try fixture.unlock()
    try await vault.remove("one")
    #expect(await !vault.contains("one"))
  }
}
