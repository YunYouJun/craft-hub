import Foundation
import Testing

@testable import CraftHubMacCore

private let secret = String(repeating: "a", count: 64)
private let nativeToken = String(repeating: "b", count: 64)
private let base = "http://127.0.0.1:49218"

private func connection(url: String? = nil, token: String = nativeToken, version: Int = 1) throws -> RuntimeConnection {
  try RuntimeConnection(
    handshake: JSONSerialization.data(withJSONObject: [
      "version": version, "url": url ?? "\(base)/__craft_hub_host/bootstrap?token=\(secret)", "nativeApiToken": token,
    ]))
}

private func response(_ request: URLRequest, _ json: String, status: Int = 200) -> (Data, URLResponse) {
  (Data(json.utf8), HTTPURLResponse(url: request.url!, statusCode: status, httpVersion: nil, headerFields: nil)!)
}

@Test func validatesHandshakeVersionAddressAndCredentials() throws {
  #expect(try connection().origin.absoluteString == base)
  for address in [
    "https://127.0.0.1:49218", "http://localhost:49218", "http://example.com:49218",
    "http://user:pass@127.0.0.1:49218", "http://127.0.0.1", "http://127.0.0.1:0",
  ] {
    #expect(throws: (any Error).self) { try connection(url: "\(address)/__craft_hub_host/bootstrap?token=\(secret)") }
  }
  #expect(throws: (any Error).self) { try connection(version: 2) }
  #expect(throws: (any Error).self) { try connection(token: "invalid\r\nHeader: injected") }
  #expect(throws: (any Error).self) { try connection(url: "\(base)/api/environment?token=\(secret)") }
  #expect(throws: (any Error).self) {
    try connection(url: "\(base)/__craft_hub_host/bootstrap?token=\(secret)&extra=1")
  }
}

@Test func nativeRequestsCarryBearerCredentialsOnlyOnAPIEndpoints() throws {
  let connection = try connection()
  let request = try connection.request(path: "/api/environment")
  #expect(request.url?.absoluteString == "\(base)/api/environment")
  #expect(request.value(forHTTPHeaderField: "Authorization") == "Bearer \(nativeToken)")
  #expect(request.value(forHTTPHeaderField: "Origin") == base)
  #expect(request.value(forHTTPHeaderField: "Cookie") == nil)
  for path in [
    "//evil.example/api/environment", "https://evil.example/api/environment", "/overview", "/api/../overview",
    "/api/environment?command=exec",
  ] {
    #expect(throws: (any Error).self) { try connection.request(path: path) }
  }
}

@Test func decodesRuntimeEnvironmentWithoutRequiringOptionalToolFields() async throws {
  let client = RuntimeAPIClient(connection: try connection()) { request in
    #expect(request.url?.path == "/api/environment")
    return response(
      request,
      #"{"schemaVersion":1,"checkedAt":"2026-10-22T00:00:00Z","host":{"platform":"darwin","arch":"arm64","osRelease":"25.0"},"runtime":{"version":"v24.11.0","executablePath":"/opt/homebrew/bin/node","arch":"arm64"},"searchDirectories":["/usr/bin"],"tools":[{"id":"git","name":"Git","status":"missing"}]}"#
    )
  }
  let snapshot = try await client.environment()
  #expect(snapshot.tools.first?.executablePath == nil)
  #expect(snapshot.tools.first?.status == "missing")
}

@Test func nativeSettingsProjectionRejectsUnsupportedThemeAndLocale() async throws {
  for json in [
    #"{"settings":{"workbench.theme":"sepia","workbench.locale":"en"}}"#,
    #"{"settings":{"workbench.theme":"system","workbench.locale":"unknown"}}"#,
    #"{"settings":{}}"#,
  ] {
    let client = RuntimeAPIClient(connection: try connection()) { request in response(request, json) }
    await #expect(throws: (any Error).self) { try await client.preferences() }
  }
}

@Test func nativePinsRequireTheRequestedProjectAndOnlyReadTheRuntimeSnapshot() async throws {
  for project in ["p", "another-project"] {
    let client = RuntimeAPIClient(connection: try connection()) { request in
      #expect(request.httpMethod == "GET")
      #expect(request.url?.path == "/api/projects/p/pins")
      return response(request, "{\"projectId\":\"\(project)\",\"capabilityIds\":[\"build\",\"build\",\"skill\"]}")
    }
    if project == "p" {
      #expect(try await client.capabilityPins(projectID: "p") == Set(["build", "skill"]))
    } else {
      await #expect(throws: RuntimeAPIError.self) { try await client.capabilityPins(projectID: "p") }
    }
  }
}

@Test func nativeProjectCatalogKeepsDiagnosticsAndRegistrationUsesOnlyTheRuntimePathContract() async throws {
  let client = RuntimeAPIClient(connection: try connection()) { request in
    #expect(request.url?.path == "/api/projects")
    if request.httpMethod == "POST" {
      let input = try JSONDecoder().decode([String: String].self, from: request.httpBody!)
      #expect(input == ["path": "/project"])
      return response(request, #"{"id":"p","name":"Project","path":"/project","trust":"untrusted"}"#, status: 201)
    }
    return response(
      request,
      #"{"projects":[],"diagnostics":[{"projectId":"p","source":"project","path":"/project","message":"Folder missing"}]}"#
    )
  }
  #expect(try await client.projectCatalog().diagnostics.first?.message == "Folder missing")
  #expect(try await client.addProject(path: "/project").trust == "untrusted")
  for path in ["relative", "", "/bad\0path"] {
    await #expect(throws: (any Error).self) { try await client.addProject(path: path) }
  }
}

@Test func nativeTodayRejectsUnknownProjectionVersions() async throws {
  let client = RuntimeAPIClient(connection: try connection()) { request in
    #expect(request.url?.path == "/api/workbench/today")
    #expect(request.url?.query == "locale=zh-CN")
    return response(
      request, #"{"version":2,"checkedAt":"now","sourceCount":0,"total":0,"sources":[],"items":[],"candidates":[]}"#)
  }
  await #expect(throws: RuntimeAPIError.self) { try await client.todayFocus(locale: "zh-CN") }
}

@Test func unknownSoftwareNeverBecomesAMissingOrLaunchableApplication() async throws {
  let client = RuntimeAPIClient(connection: try connection()) { request in
    response(
      request,
      #"{"version":1,"sources":[{"id":"catalog","title":"Catalog","canManage":true,"items":[{"id":"editor","title":{"en":"Editor"},"group":{"id":"tools","title":{"en":"Tools"}},"url":"https://example.com","status":"unknown","canOpen":true}]}]}"#
    )
  }
  let snapshot = try await client.software()
  let source = try #require(snapshot.sources.first)
  let item = try #require(source.items.first)
  #expect(item.status == "unknown")
  #expect(item.title.localized(chinese: true) == "Editor")
  #expect(!source.canOpen(item))
}

@Test func respectsProviderOpenCapabilityAndUnavailableSources() throws {
  for report in [
    #""operationSupport":{"state":"unavailable","operations":{"open":{"supported":true}}},"#,
    #""operationSupport":{"state":"available","operations":{"open":{"supported":false}}},"#,
    #""error":"unavailable","#,
  ] {
    let json = """
      {"id":"catalog","title":"Catalog","canManage":true,\(report)"items":[{"id":"editor","title":{"en":"Editor"},"group":{"id":"tools","title":{"en":"Tools"}},"url":"https://example.com","status":"detected","canOpen":true}]}
      """
    let source = try JSONDecoder().decode(SoftwareSnapshot.Source.self, from: Data(json.utf8))
    #expect(!source.canOpen(source.items[0]))
  }
}

@Test func opensOnlyByCatalogIDsAndValidatesTheAcknowledgement() async throws {
  let client = RuntimeAPIClient(connection: try connection()) { request in
    #expect(request.url?.absoluteString == "\(base)/api/software/acme%2Ftools/open")
    #expect(request.httpMethod == "POST")
    #expect(request.value(forHTTPHeaderField: "Content-Type") == "application/json")
    let body = try JSONDecoder().decode([String: String].self, from: request.httpBody!)
    #expect(body == ["softwareId": "editor"])
    return response(request, #"{"version":1,"softwareId":"editor","destination":"application"}"#)
  }
  try await client.openApplication(sourceID: "acme/tools", softwareID: "editor")
  await #expect(throws: (any Error).self) { try await client.openApplication(sourceID: "..", softwareID: "editor") }
}

@Test func reportsDeniedRequestsInvalidJSONAndFutureVersions() async throws {
  for (status, body) in [
    (403, #"{"error":"Application is no longer detected"}"#), (200, "<html>"), (200, #"{"version":2,"sources":[]}"#),
  ] {
    let client = RuntimeAPIClient(connection: try connection()) { request in response(request, body, status: status) }
    await #expect(throws: (any Error).self) { try await client.software() }
  }
}

@Test func nativePaletteUsesReadOnlyDiscoveryAndLocalizedPluginRoutes() async throws {
  let client = RuntimeAPIClient(connection: try connection()) { request in
    #expect(request.httpMethod == "GET")
    #expect(request.httpBody == nil)
    switch request.url!.path {
    case "/api/projects":
      return response(
        request,
        #"{"projects":[{"id":"sample","name":"Sample","path":"/tmp/sample","trust":"untrusted"}],"diagnostics":[]}"#)
    case "/api/projects/sample/capability-discovery":
      return response(request, #"{"capabilities":[{"id":"build","name":"build","kind":"command"}]}"#)
    case "/api/integrations":
      return response(
        request,
        #"{"integrations":[{"id":"example","views":[{"id":"tasks","title":"tasks.title","placement":"primary-sidebar"}],"translations":{"zh-CN":{"tasks.title":"待办"}}}]}"#
      )
    case "/api/workbenches":
      #expect(
        URLComponents(url: request.url!, resolvingAgainstBaseURL: false)?.queryItems == [
          URLQueryItem(name: "locale", value: "zh-CN")
        ])
      return response(request, #"[{"id":"work","pluginId":"example/plugin","title":"工作"}]"#)
    default: throw RuntimeAPIError.invalidEndpoint
    }
  }
  #expect(try await client.projects().first?.trust == "untrusted")
  #expect(try await client.capabilities(projectID: "sample").first?.id == "build")
  let pages = try await client.palettePages(locale: "zh-CN")
  #expect(pages.map(\.title) == ["待办", "工作"])
  #expect(pages.last?.path == "/workbenches/example%2Fplugin/work")
}

@Test func deliberateRestartRefusesActiveCommandsOrAgentsAndFailsClosed() async throws {
  for (runs, agents, allowed) in [(0, "done", true), (1, "done", false), (0, "running", false)] {
    let client = RuntimeAPIClient(connection: try connection()) { request in
      switch request.url!.path {
      case "/api/runs/summary": response(request, "[{\"running\":\(runs)}]")
      case "/api/agent-tasks": response(request, "[{\"status\":\"\(agents)\"}]")
      case "/api/environment/sources": response(request, #"{"connections":[]}"#)
      case "/api/software": response(request, #"{"version":1,"sources":[]}"#)
      default: throw RuntimeAPIError.invalidEndpoint
      }
    }
    if allowed {
      try await client.requireIdleRuntime()
    } else {
      await #expect(throws: (any Error).self) { try await client.requireIdleRuntime() }
    }
  }
  let unavailable = RuntimeAPIClient(connection: try connection()) { request in response(request, "{}", status: 503) }
  await #expect(throws: (any Error).self) { try await unavailable.requireIdleRuntime() }
}

@Test func deliberateRestartAlsoChecksSoftwareAndConfigurationConnectionsReadOnly() async throws {
  for (job, run, allowed) in [
    ("connected", "completed", true), ("connecting", "completed", false),
    ("authentication-required", "completed", false), ("connected", "running", false),
    ("connected", "cancelling", false),
  ] {
    let client = RuntimeAPIClient(connection: try connection()) { request in
      #expect(request.httpMethod == "GET" && request.httpBody == nil)
      switch request.url!.path {
      case "/api/runs/summary", "/api/agent-tasks": return response(request, "[]")
      case "/api/environment/sources": return response(request, "{\"connections\":[{\"state\":\"\(job)\"}]}")
      case "/api/software":
        return response(
          request, #"{"version":1,"sources":[{"id":"fixture","title":"Fixture","canManage":true,"items":[]}]}"#)
      case "/api/software/fixture/runs":
        return response(
          request,
          """
          {"version":1,"runs":[{"version":1,"id":"run","sourceId":"fixture","planId":"plan","createdAt":"2026-10-23T00:00:00Z","updatedAt":"2026-10-23T00:00:00Z","state":"\(run)","items":[]}]}
          """)
      default: throw RuntimeAPIError.invalidEndpoint
      }
    }
    if allowed {
      try await client.requireIdleRuntime()
    } else {
      await #expect(throws: (any Error).self) { try await client.requireIdleRuntime() }
    }
  }
}

@Test func deliberateRestartCannotTreatUnavailableSoftwareHistoryAsIdle() async throws {
  let client = RuntimeAPIClient(connection: try connection()) { request in
    switch request.url!.path {
    case "/api/runs/summary", "/api/agent-tasks": return response(request, "[]")
    case "/api/environment/sources": return response(request, #"{"connections":[]}"#)
    case "/api/software":
      return response(
        request,
        #"{"version":1,"sources":[{"id":"fixture","title":"Fixture","canManage":true,"error":"unavailable","items":[]}]}"#
      )
    default: throw RuntimeAPIError.invalidEndpoint
    }
  }
  await #expect(throws: (any Error).self) { try await client.requireIdleRuntime() }
}
